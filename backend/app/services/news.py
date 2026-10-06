"""Cached, attributed publisher headlines; not independent fact-checking.

No full-article scraping. Curated HTTPS links, dates, short plain-text excerpts
and keyword relevance are checked. The legacy authenticity_score field is a
source/metadata heuristic, never a truth probability. Publishers' RSS terms
must be reviewed before any commercial distribution (see docs/12).
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx

log = logging.getLogger(__name__)

try:
    import feedparser  # type: ignore
except ImportError:  # noqa: F401
    feedparser = None  # type: ignore


# Feeds we pull from. Each entry carries:
#   - `url`: the RSS endpoint
#   - `source`: human label the UI renders
#   - `domain`: canonical publisher domain used for link-sanity checks
#   - `trust_base`: 0..70 starting authenticity score for items from this feed.
FEEDS: list[dict[str, Any]] = [
    {
        "source": "The Hindu · National",
        "url": "https://www.thehindu.com/news/national/feeder/default.rss",
        "domain": "thehindu.com",
        "trust_base": 65,
    },
    {
        "source": "NDTV · India",
        "url": "https://feeds.feedburner.com/ndtvnews-top-stories",
        "domain": "ndtv.com",
        "trust_base": 60,
    },
    {
        "source": "Hindustan Times · India",
        "url": "https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml",
        "domain": "hindustantimes.com",
        "trust_base": 60,
    },
    {
        "source": "Times of India · India",
        "url": "https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms",
        "domain": "timesofindia.indiatimes.com",
        "trust_base": 55,
    },
    {
        "source": "BBC News · India",
        "url": "https://feeds.bbci.co.uk/news/world/asia/india/rss.xml",
        "domain": "bbc.com",
        "domains": ("bbc.com", "bbc.co.uk"),
        "trust_base": 60,
    },
    {
        "source": "India Today · Nation",
        "url": "https://www.indiatoday.in/rss/1206578",
        "domain": "indiatoday.in",
        "trust_base": 60,
    },
]


_cache: list[dict[str, Any]] = []
_cache_ts: float = 0.0
_TTL_SECONDS = 300
_refresh_lock = asyncio.Lock()
_feed_status: dict[str, dict] = {}
_MAX_AGE = timedelta(days=7)


class _TextOnly(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.skip += 1

    def handle_endtag(self, tag):
        if tag in {"script", "style"}:
            self.skip = max(0, self.skip - 1)
        elif tag in {"p", "br", "div"}:
            self.parts.append(" ")

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def _plain(text: str) -> str:
    parser = _TextOnly()
    parser.feed(text or "")
    return " ".join("".join(parser.parts).split())


def _published_at(value: str) -> datetime | None:
    try:
        dt = parsedate_to_datetime(value)
    except (TypeError, ValueError, OverflowError):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except (AttributeError, TypeError, ValueError):
            return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _canonical_link(link: str) -> str:
    url = urlsplit(link)
    query = [(k, v) for k, v in parse_qsl(url.query, keep_blank_values=True)
             if not k.lower().startswith("utm_") and k.lower() not in {"fbclid", "gclid"}]
    return urlunsplit((url.scheme, url.netloc.lower(), url.path, urlencode(query), ""))


def news_status() -> dict:
    return {"fetched_at": datetime.fromtimestamp(_cache_ts, timezone.utc).isoformat() if _cache_ts else None,
            "sources": [{"source": f["source"], **_feed_status.get(f["source"], {"available": False})} for f in FEEDS],
            "fact_checked": False}

_CRISIS_KEYWORDS = (
    "flood", "fire", "accident", "rescue", "earthquake", "cyclone", "storm",
    "landslide", "outage", "blackout", "collapse", "stampede", "emergency",
    "crash", "ambulance", "ndrf", "injured", "killed", "evacuat", "heat wave",
    "heatwave", "missing",
)

# Topic buckets. First match wins, so order = priority. Lets the UI render
# a coloured chip per item ("Fire", "Flood", etc.) without needing the
# client to pattern-match on the title itself.
_TOPIC_MAP: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("fire", ("fire", "arson", "blaze")),
    ("flood", ("flood", "inundat", "waterlog", "cyclone", "storm", "heavy rain")),
    ("earthquake", ("earthquake", "tremor", "landslide")),
    ("accident", ("accident", "crash", "collision", "stampede", "collapse")),
    ("medical", ("ambulance", "injured", "killed", "medical", "hospital", "heat wave", "heatwave")),
    ("power", ("outage", "blackout", "power cut", "grid")),
    ("missing", ("missing",)),
    ("rescue", ("rescue", "ndrf", "evacuat")),
)


def _topic_for(title: str, summary: str) -> str:
    blob = f"{title} {summary}".lower()
    for topic, keys in _TOPIC_MAP:
        if any(_keyword_matches(k, blob) for k in keys):
            return topic
    return "other"


# Minimum score for an item to be served — below this it's too low-signal
# to show in a crisis-response UI. Tune down if the feed gets too sparse.
_MIN_AUTHENTICITY_SCORE = 55

# Crude clickbait / screamer patterns. A title matching these drops a few
# points off its authenticity score.
_CLICKBAIT_PATTERNS = (
    re.compile(r"[!?]{2,}"),              # "BREAKING!!" or "???"
    re.compile(r"\b(SHOCKING|UNBELIEVABLE|YOU WON'T BELIEVE|WATCH)\b"),
    re.compile(r"[A-Z]{6,}"),             # long ALL-CAPS run
)


def _is_relevant(title: str, summary: str) -> bool:
    blob = f"{title} {summary}".lower()
    if re.search(r"\b(stock|stocks|market|share|shares|bitcoin|crypto)\b.*\bcrash", blob) and not re.search(r"\b(accident|injured|ambulance|collision)\b", blob):
        return False
    return any(_keyword_matches(k, blob) for k in _CRISIS_KEYWORDS)


def _keyword_matches(key: str, blob: str) -> bool:
    # Prefixes deliberately cover flooding/evacuation, not fired/fireworks.
    suffix = r"\w*" if key in {"flood", "evacuat", "inundat", "waterlog"} else r"(?:s)?\b"
    return bool(re.search(r"\b" + re.escape(key) + suffix, blob))


def _link_matches_source(link: str, domain: str) -> bool:
    if not link or not domain:
        return False
    try:
        url = urlsplit(link)
        if url.scheme != "https" or url.username or url.password or url.port not in {None, 443}:
            return False
        host = (url.hostname or "").lower()
    except ValueError:
        return False
    return host == domain or host.endswith("." + domain)


def _is_clickbait(title: str) -> bool:
    return any(p.search(title) for p in _CLICKBAIT_PATTERNS)


def _score_item(
    feed: dict[str, Any],
    title: str,
    summary: str,
    link: str,
    published: str,
) -> tuple[int, str]:
    """Return (authenticity_score_0_100, label)."""
    score = int(feed.get("trust_base", 40))
    if any(_link_matches_source(link, domain) for domain in feed.get("domains", (feed.get("domain", ""),))):
        score += 20
    if _published_at(published):
        score += 5
    if summary and summary.strip() and summary.strip().lower() != title.strip().lower():
        score += 5
    if _is_clickbait(title):
        score -= 15
    score = max(0, min(100, score))
    if score >= 85:
        label = "source-matched"
    elif score >= 60:
        label = "reputable"
    elif score >= 35:
        label = "unverified"
    else:
        label = "low-trust"
    return score, label


async def _fetch_feed(
    client: httpx.AsyncClient, feed: dict[str, Any]
) -> list[dict[str, Any]]:
    _feed_status[feed["source"]] = {"available": False}
    if feedparser is None:
        return []
    try:
        r = await client.get(feed["url"], timeout=5.0, follow_redirects=True)
        if r.status_code != 200 or not r.text:
            return []
        parsed = feedparser.parse(r.text)
        _feed_status[feed["source"]] = {"available": bool(parsed.entries)}
    except (httpx.HTTPError, asyncio.TimeoutError) as exc:
        log.info("news feed %s skipped: %s", feed["source"], exc)
        return []

    items: list[dict[str, Any]] = []
    now = datetime.now(timezone.utc)
    for entry in parsed.entries[:50]:
        title = _plain(entry.get("title") or "")
        link = (entry.get("link") or "").strip()
        summary = _plain(entry.get("summary") or entry.get("description") or "")
        published = entry.get("published") or entry.get("updated") or ""
        if not title or not link:
            continue
        domains = feed.get("domains") or (feed.get("domain", ""),)
        if not any(_link_matches_source(link, domain) for domain in domains):
            continue  # publisher attribution cannot rescue an unsafe/off-domain URL
        published_at = _published_at(published)
        if not published_at or now - published_at > _MAX_AGE or published_at - now > timedelta(minutes=15):
            continue
        link = _canonical_link(link)
        if not _is_relevant(title, summary):
            continue
        score, label = _score_item(feed, title, summary, link, published)
        if score < _MIN_AUTHENTICITY_SCORE:
            # Drop low-trust items entirely — the feed is supposed to be the
            # "safe" side of the app, so we'd rather serve fewer items than
            # suspect ones.
            continue
        domain_match = True
        items.append(
            {
                "source": feed["source"],
                "title": title,
                "link": link,
                "summary": summary[:280],
                "published": published,
                "published_at": published_at.isoformat(),
                "fact_checked": False,
                "trust": label,
                "authenticity_score": score,
                "topic": _topic_for(title, summary),
                "domain": feed.get("domain"),
                "domain_match": domain_match,
            }
        )
    return items


async def fetch_news(force: bool = False) -> list[dict[str, Any]]:
    # Shared refresh: opening many clients cannot fan out one fetch per user.
    async with _refresh_lock:
        return await _fetch_news_locked(force)


async def _fetch_news_locked(force: bool = False) -> list[dict[str, Any]]:
    """Return crisis-relevant news items, refreshing at most every 5 minutes."""
    global _cache, _cache_ts
    now = time.time()
    if not force and _cache_ts and (now - _cache_ts) < _TTL_SECONDS:
        return _cache

    if feedparser is None:
        log.info("feedparser not installed — /api/news returns empty list")
        _cache, _cache_ts = [], now
        return _cache

    async with httpx.AsyncClient(headers={"User-Agent": "NeighbourAid/1.0"}) as client:
        results = await asyncio.gather(
            *[_fetch_feed(client, f) for f in FEEDS], return_exceptions=True
        )

    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    for group in results:
        if isinstance(group, Exception):
            continue
        for item in group:
            if item["link"] in seen:
                continue
            seen.add(item["link"])
            merged.append(item)

    # Sort by authenticity_score descending so the highest-trust items surface first
    merged.sort(key=lambda i: (i.get("published_at", ""), i.get("authenticity_score", 0)), reverse=True)

    # Always record the attempt, even when nothing came back. Leaving
    # `_cache_ts` untouched on an empty result means every subsequent request
    # re-fetches all four feeds — exactly when the feeds are already failing
    # or rate-limiting us. The last known-good list is kept rather than
    # blanked so a transient outage degrades to slightly stale news instead
    # of an empty page.
    _cache_ts = now
    if merged:
        _cache = merged[:40]
    else:
        oldest = datetime.now(timezone.utc) - _MAX_AGE
        _cache = [item for item in _cache if (_published_at(item.get("published_at", "")) or datetime.min.replace(tzinfo=timezone.utc)) >= oldest]
    return _cache
