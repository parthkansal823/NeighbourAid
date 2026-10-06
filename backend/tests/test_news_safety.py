from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock
import asyncio
import pytest

from app.services import news


@pytest.mark.parametrize("link", [
    "javascript:alert(1)", "https://example.com@evil.com/x",
    "https://example.com.evil.com/x", "https://user@example.com/x", "http://example.com/x",
])
def test_only_https_publisher_links_are_accepted(link):
    assert not news._link_matches_source(link, "example.com")


@pytest.mark.parametrize("title", ["Manager fired today", "Fireworks light up the city", "Stock market crash today"])
def test_keywords_do_not_promote_unrelated_stories(title):
    assert not news._is_relevant(title, "")


def test_html_and_tracking_are_removed_not_rendered():
    assert news._plain('<p>Fire &amp; rescue</p><script>malicious()</script>') == "Fire & rescue"
    assert news._canonical_link("https://example.com/news?id=1&utm_source=rss#top") == "https://example.com/news?id=1"
    assert news._score_item({"domain": "example.com", "trust_base": 60}, "Fire", "Summary", "https://example.com/x", "not a date")[0] == 85


async def test_stale_future_and_off_domain_articles_are_dropped():
    now = datetime.now(timezone.utc)
    dates = [now, now - timedelta(days=8), now + timedelta(hours=1), now]
    entries = "".join(f'<item><title>Fire near warehouse</title><link>https://{domain}/news/{i}</link><description>&lt;p&gt;Rescue underway&lt;/p&gt;</description><pubDate>{dt.strftime("%a, %d %b %Y %H:%M:%S %z")}</pubDate></item>'
                      for i, (dt, domain) in enumerate(zip(dates, ["example.com"] * 3 + ["evil.com"])))
    client = MagicMock()
    client.get = AsyncMock(return_value=MagicMock(status_code=200, text=f'<rss version="2.0"><channel>{entries}</channel></rss>'))
    items = await news._fetch_feed(client, {"source": "Example", "domain": "example.com", "url": "https://example.com/rss", "trust_base": 60})
    assert len(items) == 1
    assert items[0]["summary"] == "Rescue underway"
    assert items[0]["fact_checked"] is False


async def test_empty_results_are_cached_and_parallel_requests_share_refresh(monkeypatch):
    monkeypatch.setattr(news, "_cache", [])
    monkeypatch.setattr(news, "_cache_ts", 0)
    monkeypatch.setattr(news, "_refresh_lock", asyncio.Lock())
    fetch = AsyncMock(return_value=[])
    monkeypatch.setattr(news, "_fetch_feed", fetch)
    await asyncio.gather(news.fetch_news(), news.fetch_news(), news.fetch_news())
    assert fetch.await_count == len(news.FEEDS)
