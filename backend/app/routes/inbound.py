"""Inbound webhooks for third-party messaging gateways.

Currently supports a single shape: a JSON POST from a WhatsApp gateway
(Twilio sandbox, n8n WhatsApp Cloud node, Gupshup, etc.). The gateway is
responsible for normalising whatever the carrier shipped into our
schema; we don't try to parse 17 different vendor payloads.

Auth model: a single shared secret in the `X-Inbound-Token` header,
configured via the `INBOUND_TOKEN` env var. Empty value disables the
endpoint entirely (returns 503).

Why this exists: a huge fraction of the target audience won't install
another app. A WhatsApp message + shared location → an alert in the
NeighbourAid feed unlocks reach you can't get any other way.
"""

from __future__ import annotations

import asyncio
import secrets
from datetime import datetime, timezone
from typing import Any, Optional

from bson import ObjectId
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from ..core.config import settings
from ..db.client import get_db
from ..models.alert import AlertCategory, GeoPoint
from ..services.ai import generate_headline, triage as ai_triage
from ..services.geocode import reverse_geocode
from ..services.verification import (
    compute_verified_score,
    filter_corroborating,
    find_corroborating_alerts,
)
from ..services.weather import current_weather, supports_category
from ..services.webhook import fire_alert_created
from ..services.websocket import manager

router = APIRouter(prefix="/api/inbound", tags=["inbound"])


class WhatsAppMessage(BaseModel):
    """Shape we expect from the gateway. Senders must include lat/lng —
    parsing free-text "where are you" is not a problem we want here."""

    sender: str = Field(min_length=1, max_length=80)
    body: str = Field(min_length=10, max_length=2000)
    location: GeoPoint
    category: AlertCategory = AlertCategory.other


def _serialize_min(doc: dict) -> dict:
    """Tiny serialiser — the inbound caller doesn't need the whole alert
    schema, just enough to confirm it was accepted."""
    return {
        "id": str(doc["_id"]),
        "category": doc["category"],
        "urgency": doc["urgency"],
        "verified_score": doc["verified_score"],
    }


def _check_auth(token: Optional[str]) -> None:
    expected = (settings.INBOUND_TOKEN or "").strip()
    if not expected:
        raise HTTPException(503, "Inbound webhook is disabled")
    # compare_digest, not `!=`: a plain string compare short-circuits on the
    # first differing byte, which leaks the shared secret one character at a
    # time to anyone who can time the responses.
    if not token or not secrets.compare_digest(token.strip(), expected):
        raise HTTPException(401, "Invalid inbound token")


@router.post("/whatsapp", status_code=201)
async def whatsapp_inbound(
    msg: WhatsAppMessage,
    x_inbound_token: Optional[str] = Header(default=None),
) -> dict[str, Any]:
    """Convert a normalised WhatsApp message into a standard NeighbourAid
    alert. Same triage / verification / broadcast pipeline as the regular
    POST /api/alerts/, just kicked off from a different transport."""
    _check_auth(x_inbound_token)

    db = get_db()
    lng, lat = msg.location.coordinates[0], msg.location.coordinates[1]

    t = ai_triage(msg.body)
    address, weather, corroborating = await asyncio.gather(
        reverse_geocode(lat, lng),
        current_weather(lat, lng),
        find_corroborating_alerts(db, msg.category.value, [lng, lat]),
        return_exceptions=False,
    )
    weather_match = supports_category(msg.category.value, weather)
    corroborating = filter_corroborating(msg.body, corroborating)
    verified_score = compute_verified_score(
        witnesses=1,
        corroborating_alerts=len(corroborating),
        weather_match=weather_match,
    )
    # Inbound messages get a small trust penalty until we have a way to
    # verify the WhatsApp sender's identity (PIN-back, opt-in registry).
    verified_score = max(0, min(100, verified_score - 5))

    headline = generate_headline(msg.body)
    doc = {
        "reporter_id": ObjectId(),
        "is_anonymous": True,
        "via": "whatsapp",
        "via_sender": msg.sender,
        "category": msg.category.value,
        "description": msg.body,
        "headline": headline,
        "urgency": t.urgency,
        "urgency_reason": t.urgency_reason + " · via WhatsApp",
        "urgency_confidence": t.urgency_confidence,
        "vulnerability": t.vulnerability,
        "time_sensitivity": t.time_sensitivity,
        "language": t.language,
        "triggers": t.triggers,
        "priority_score": t.priority_score,
        "location": msg.location.model_dump(),
        "status": "open",
        "accepted_by": None,
        "created_at": datetime.now(timezone.utc),
        "resolved_at": None,
        "address": address,
        "weather": weather,
        "weather_match": weather_match,
        "witnesses": 1,
        "witnessed_by": [],
        "corroborating_ids": [str(c["_id"]) for c in corroborating],
        "verified_score": verified_score,
        "photos": [],
        "photo_count": 0,
        "photo_evidence_score": 0,
        "photo_confidence": 0.0,
        "photo_findings": "",
        "eta_minutes": None,
        "eta_set_at": None,
        "flags": 0,
        "flagged_by": [],
    }
    result = await db.alerts.insert_one(doc)
    doc["_id"] = result.inserted_id

    # Reuse the websocket fan-out so volunteers see the WA-sourced alert
    # exactly like an in-app one.
    broadcast_payload = {
        "id": str(doc["_id"]),
        "reporter_id": str(doc["reporter_id"]),
        "category": doc["category"],
        "description": doc["description"],
        "urgency": doc["urgency"],
        "urgency_reason": doc["urgency_reason"],
        "location": doc["location"],
        "status": doc["status"],
        "accepted_by": None,
        "created_at": doc["created_at"],
        "resolved_at": None,
        "is_anonymous": True,
        "via": "whatsapp",
    }
    await manager.broadcast_nearby(broadcast_payload)
    fire_alert_created(broadcast_payload)
    return _serialize_min(doc)
