"""Messaging-gateway sender identifiers are internal, even on shared alerts."""

import json

import pytest
from bson import ObjectId
from fastapi.encoders import jsonable_encoder

from app.routes.alerts import _serialize


@pytest.mark.parametrize("include_photos", [True, False])
@pytest.mark.parametrize("anonymous", [True, False])
def test_public_alert_payload_never_contains_gateway_sender(include_photos, anonymous):
    sender = "whatsapp:private-test-sender"
    doc = {
        "_id": ObjectId(),
        "reporter_id": ObjectId(),
        "description": "Test alert body without private contact information",
        "via": "whatsapp",
        "via_sender": sender,
        "is_anonymous": anonymous,
        "anonymous_ip_hash": "internal-test-hash",
        "photos": [],
    }
    result = _serialize(doc, include_photos=include_photos)
    assert "via_sender" not in result
    assert sender not in json.dumps(jsonable_encoder(result))
    assert "anonymous_ip_hash" not in result
    assert result["via"] == "whatsapp"
    assert result["is_anonymous"] is anonymous
    assert result["description"] == "Test alert body without private contact information"
