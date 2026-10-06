"""RSS-based web scraper for Indian crisis-relevant news.

Pulls from public RSS feeds (Times of India, NDTV, Hindustan Times, The Hindu)
every few minutes, filters for crisis keywords (fire, flood, accident,
rescue, earthquake, cyclone, power outage, etc.), deduplicates, computes an
authenticity score per item, and serves a normalised list.

Authenticity score (0..100):
    - base trust tier from the feed                                  up to 70
    - +20 if the article link's domain matches the feed's domain     (catches
      mirrors / redirect farms)
    - +5 if the article has a parseable `published` timestamp
    - +5 if the summary is non-trivial (not just a title duplicate)
    - -15 if the title has clickbait / screamer signals              (all-caps
      clusters, excess punctuation, etc.)

We deliberately stop short of LLM-based fact-checking — we don't want to
promise "verification" we can't deliver. The score is an editorial-quality
proxy, not a truth assessment.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from typing import Any

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
]


_cache: list[dict[str, Any]] = []
_cache_ts: float = 0.0
_TTL_SECONDS = 300

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
        if any(k in blob for k in keys):
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
    return any(k in blob for k in _CRISIS_KEYWORDS)


def _link_matches_source(link: str, domain: str) -> bool:
    if not link or not domain:
        return False
    try:
        host = re.sub(r"^https?://", "", link).split("/", 1)[0].lower()
    except Exception:  # noqa: BLE001
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
    if _link_matches_source(link, feed.get("domain", "")):
        score += 20
    if published:
        score += 5
    if summary and summary.strip() and summary.strip().lower() != title.strip().lower():
        score += 5
    if _is_clickbait(title):
        score -= 15
    score = max(0, min(100, score))
    if score >= 85:
        label = "verified"
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
    if feedparser is None:
        return []
    try:
        r = await client.get(feed["url"], timeout=5.0, follow_redirects=True)
        if r.status_code != 200 or not r.text:
            return []
        parsed = feedparser.parse(r.text)
    except (httpx.HTTPError, asyncio.TimeoutError) as exc:
        log.info("news feed %s skipped: %s", feed["source"], exc)
        return []

    items: list[dict[str, Any]] = []
    for entry in parsed.entries[:20]:
        title = (entry.get("title") or "").strip()
        link = (entry.get("link") or "").strip()
        summary = (entry.get("summary") or entry.get("description") or "").strip()
        published = entry.get("published") or entry.get("updated") or ""
        if not title or not link:
            continue
        if not _is_relevant(title, summary):
            continue
        score, label = _score_item(feed, title, summary, link, published)
        if score < _MIN_AUTHENTICITY_SCORE:
            # Drop low-trust items entirely — the feed is supposed to be the
            # "safe" side of the app, so we'd rather serve fewer items than
            # suspect ones.
            continue
        domain_match = _link_matches_source(link, feed.get("domain", ""))
        items.append(
            {
                "source": feed["source"],
                "title": title,
                "link": link,
                "summary": summary[:280],
                "published": published,
                "trust": label,
                "authenticity_score": score,
                "topic": _topic_for(title, summary),
                "domain": feed.get("domain"),
                "domain_match": domain_match,
            }
        )
    return items


async def fetch_news(force: bool = False) -> list[dict[str, Any]]:
    """Return crisis-relevant news items, refreshing at most every 5 minutes."""
    global _cache, _cache_ts
    now = time.time()
    if not force and _cache and (now - _cache_ts) < _TTL_SECONDS:
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
    merged.sort(key=lambda i: i.get("authenticity_score", 0), reverse=True)

    # Always record the attempt, even when nothing came back. Leaving
    # `_cache_ts` untouched on an empty result means every subsequent request
    # re-fetches all four feeds — exactly when the feeds are already failing
    # or rate-limiting us. The last known-good list is kept rather than
    # blanked so a transient outage degrades to slightly stale news instead
    # of an empty page.
    _cache_ts = now
    if merged:
        _cache = merged[:40]
    return _cache
