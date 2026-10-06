"""Public crisis-news feed, built on cached RSS scraping."""

from fastapi import APIRouter

from ..services.news import fetch_news

router = APIRouter(prefix="/api/news", tags=["news"])


@router.get("/recent")
async def recent():
    """Return the latest crisis-relevant Indian news items.
    Scraping is cached for 5 minutes so the endpoint is always fast.
    """
    items = await fetch_news()
    return {"count": len(items), "items": items}
