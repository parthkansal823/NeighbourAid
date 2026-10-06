from fastapi import APIRouter
from ..services.advisories import fetch_advisories

router = APIRouter(prefix="/api/advisories", tags=["advisories"])


@router.get("/")
async def official_advisories():
    """Limited SACHET snapshot; empty results never mean an area is safe."""
    return await fetch_advisories()
