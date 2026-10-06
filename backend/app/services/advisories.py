"""NDMA SACHET CAP advisories, kept separate from community/news reports.

Fixed HTTPS endpoints, ETag caching and strict Actual/Public CAP validation.
This is a limited, on-demand feed snapshot, not a forecasting engine, an
all-clear signal or guaranteed emergency notification delivery.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import re
import time
from urllib.parse import parse_qs, urlsplit
from xml.etree import ElementTree as ET

import httpx

PORTAL = "https://sachet.ndma.gov.in/"
RSS = PORTAL + "cap_public_website/rss/rss_india.xml"
TTL = 120
MAX_ALERTS = 24
_CAP = "{urn:oasis:names:tc:emergency:cap:1.2}"
_rss_bytes = b""
_rss_etag = ""
_xml_cache: dict[str, tuple[str, bytes]] = {}
_items: list[dict] = []
_attempt = 0.0
_checked: str | None = None
_status = "unavailable"
_partial = False
_task: asyncio.Task | None = None


def _xml(raw: bytes):
    # Normalize UTF-16/32 NULs too, so the declaration guard cannot be
    # bypassed just by changing the feed's character encoding.
    declarations = raw.replace(b"\x00", b"").upper()
    if len(raw) > 2_000_000 or b"<!DOCTYPE" in declarations or b"<!ENTITY" in declarations:
        raise ValueError("Unsupported XML")
    return ET.fromstring(raw)


def _date(raw: str) -> datetime | None:
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return dt.astimezone(timezone.utc) if dt.tzinfo else None
    except (TypeError, ValueError, AttributeError):
        return None


def _text(node, key: str) -> str:
    return (node.findtext(_CAP + key) or "").strip()


def cap_url(raw: str) -> str | None:
    try:
        url = urlsplit(raw)
        query = parse_qs(url.query)
        identifier = query.get("identifier", [""])
        if (url.scheme == "https" and url.hostname == "sachet.ndma.gov.in"
                and not url.username and not url.password and url.port in {None, 443}
                and url.path == "/cap_public_website/FetchXMLFile"
                and set(query) == {"identifier"} and len(identifier) == 1
                and re.fullmatch(r"[0-9]{1,24}", identifier[0]) and not url.fragment):
            return PORTAL + "cap_public_website/FetchXMLFile?identifier=" + identifier[0]
    except ValueError:
        pass
    return None


def parse_cap(raw: bytes, link: str, now: datetime | None = None) -> dict:
    """Keep original authority wording, timings and uncertainty intact."""
    now = now or datetime.now(timezone.utc)
    root = _xml(raw)
    empty = {"items": [], "supersedes": []}
    if root.tag != _CAP + "alert" or not cap_url(link):
        return empty
    if _text(root, "status") != "Actual" or _text(root, "scope") != "Public":
        return empty
    sent = _date(_text(root, "sent"))
    identifier = _text(root, "identifier")
    kind = _text(root, "msgType")
    if not identifier or not sent or sent > now + timedelta(minutes=15) or kind not in {"Alert", "Update", "Cancel"}:
        return empty
    references = [part.split(",")[1] for part in _text(root, "references").split() if len(part.split(",")) == 3]
    if kind == "Cancel":
        return {"items": [], "supersedes": references + [identifier]}
    items = []
    for info in root.findall(_CAP + "info"):
        expires = _date(_text(info, "expires"))
        starts = _date(_text(info, "effective")) or sent
        if not expires or expires <= now or expires <= starts:
            continue
        area = "; ".join(text for node in info.findall(_CAP + "area") if (text := _text(node, "areaDesc")))
        if not area:
            continue  # never invent locality from a point/centroid
        language = _text(info, "language") or "unknown"
        items.append({
            "id": identifier + ":" + language, "cap_identifier": identifier,
            "source": _text(root, "sender"), "event": _text(info, "event"),
            "headline": _text(info, "headline"), "description": _text(info, "description"),
            "instruction": _text(info, "instruction"), "area": area, "language": language,
            "severity": _text(info, "severity"), "certainty": _text(info, "certainty"),
            "urgency": _text(info, "urgency"), "issued_at": sent.isoformat(),
            "effective_at": starts.isoformat(), "expires_at": expires.isoformat(), "link": cap_url(link),
        })
    return {"items": items, "supersedes": references if kind == "Update" and items else []}


def current_snapshot() -> dict:
    now = datetime.now(timezone.utc)
    items = [item for item in _items if (_date(item["expires_at"]) or now) > now]
    items.sort(key=lambda item: ({"Extreme": 0, "Severe": 1, "Moderate": 2}.get(item["severity"], 3),
                                 -(_date(item["issued_at"]) or now).timestamp()))
    return {"items": items, "status": _status, "checked_at": _checked, "partial": _partial,
            "source_url": PORTAL, "location_matched": False}


async def _refresh() -> None:
    global _rss_bytes, _rss_etag, _xml_cache, _items, _checked, _status, _partial
    _status = "checking"
    try:
        async with httpx.AsyncClient(timeout=5, follow_redirects=False, headers={"User-Agent": "NeighbourAid-Advisories/1.0"}) as client:
            response = await client.get(RSS, headers={"If-None-Match": _rss_etag} if _rss_etag else {})
            if response.status_code == 200:
                root = _xml(response.content)
                if root.tag != "rss" or root.find("channel") is None:
                    raise ValueError("Not an RSS feed")
                _rss_bytes, _rss_etag = response.content, response.headers.get("etag", "")
            elif response.status_code != 304 or not _rss_bytes:
                raise ValueError("Official feed unavailable")
            root = _xml(_rss_bytes)
            links = list(dict.fromkeys(url for item in root.findall("channel/item") if (url := cap_url(item.findtext("link") or ""))))
            if root.findall("channel/item") and not links:
                raise ValueError("No usable CAP links")
            _partial = len(links) > MAX_ALERTS
            semaphore = asyncio.Semaphore(4)
            async def fetch_cap(link):
                async with semaphore:
                    etag, cached = _xml_cache.get(link, ("", b""))
                    r = await client.get(link, headers={"If-None-Match": etag} if etag else {})
                    if r.status_code == 200:
                        if _xml(r.content).tag != _CAP + "alert":
                            raise ValueError("Not a CAP alert")
                        _xml_cache[link] = (r.headers.get("etag", ""), r.content)
                        return parse_cap(r.content, link)
                    if r.status_code == 304 and cached:
                        return parse_cap(cached, link)
                    raise ValueError("CAP unavailable")
            results = await asyncio.gather(*(fetch_cap(link) for link in links[:MAX_ALERTS]), return_exceptions=True)
            failures = sum(isinstance(result, Exception) for result in results)
            if results and failures == len(results):
                raise ValueError("All CAP lookups unavailable")
            _partial = _partial or bool(failures)
            superseded = {identifier for result in results if isinstance(result, dict) for identifier in result["supersedes"]}
            merged = {item["id"]: item for result in results if isinstance(result, dict) for item in result["items"] if item["cap_identifier"] not in superseded}
            _items = list(merged.values())
            _xml_cache = {link: _xml_cache[link] for link in links[:MAX_ALERTS] if link in _xml_cache}
            _checked, _status = datetime.now(timezone.utc).isoformat(), "available"
    except Exception:
        # Keep unexpired last-known data, marked stale. Never claim all-clear.
        _status = "stale" if _items else "unavailable"


async def fetch_advisories() -> dict:
    global _task, _attempt
    if (not _task or _task.done()) and (not _attempt or time.monotonic() - _attempt >= TTL):
        _attempt = time.monotonic()
        _task = asyncio.create_task(_refresh())
    if _task and not _task.done():
        try:
            await asyncio.wait_for(asyncio.shield(_task), timeout=8)
        except asyncio.TimeoutError:
            pass
    return current_snapshot()
