import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.models.alert import AlertCreate
from app.routes.alerts import create_anonymous_alert


@pytest.mark.asyncio
async def test_anonymous_drill_cannot_be_silently_published_as_a_real_emergency():
    alert = AlertCreate(
        category="medical",
        description="This is an explicitly selected practice drill.",
        location={"type": "Point", "coordinates": [76.7794, 30.7333]},
        is_drill=True,
    )
    with pytest.raises(HTTPException) as failure:
        await create_anonymous_alert(alert, Request({"type": "http", "headers": []}))
    assert failure.value.status_code == 403
    assert "signed-in" in failure.value.detail
