import pytest
from unittest.mock import AsyncMock, MagicMock
from bson import ObjectId


@pytest.mark.asyncio
async def test_register_success(client):
    c, db = client
    db.users.find_one = AsyncMock(return_value=None)
    db.users.insert_one = AsyncMock(
        return_value=MagicMock(inserted_id=ObjectId())
    )
    payload = {
        "name": "Test User",
        "email": "test@example.com",
        "password": "secret123",
        "role": "reporter",
        "location": {"type": "Point", "coordinates": [76.7794, 30.7333]},
    }
    resp = await c.post("/api/auth/register", json=payload)
    assert resp.status_code == 201
    assert "token" in resp.json()


@pytest.mark.asyncio
async def test_register_duplicate_email(client):
    c, db = client
    db.users.find_one = AsyncMock(return_value={"email": "test@example.com"})
    payload = {
        "name": "Test User",
        "email": "test@example.com",
        "password": "secret123",
        "role": "reporter",
        "location": {"type": "Point", "coordinates": [76.7794, 30.7333]},
    }
    resp = await c.post("/api/auth/register", json=payload)
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_login_invalid_credentials(client):
    c, db = client
    db.users.find_one = AsyncMock(return_value=None)
    resp = await c.post(
        "/api/auth/login",
        json={"email": "nobody@example.com", "password": "wrong"},
    )
    assert resp.status_code == 401
