from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

from bson import ObjectId
import pytest
from pydantic import ValidationError

from app.core.security import create_token
from app.routes.medical_review import ReviewRequest, ReviewResponse, _serialize

REQUESTER, DOCTOR, OTHER = ObjectId(), ObjectId(), ObjectId()


def headers(user=REQUESTER, role="reporter"):
    return {"Authorization": "Bearer " + create_token({"sub": str(user), "role": role})}


def document(**extra):
    now = datetime.now(timezone.utc)
    return {"_id": ObjectId(), "requester_id": REQUESTER, "question": "How can I arrange an in-person assessment?", "status": "pending", "created_at": now, "expires_at": now + timedelta(hours=72), **extra}


def clinician():
    return {"_id": DOCTOR, "name": "Test Clinician", "council": "Test Council", "registration": "TEST-ONLY", "active": True, "valid_until": datetime.now(timezone.utc) + timedelta(days=1)}


class Cursor:
    def __init__(self, rows): self.rows = rows
    def sort(self, *_): return self
    def limit(self, *_): return self
    def __aiter__(self):
        async def rows():
            for row in self.rows: yield row
        return rows()


def prepare(db, approved=False):
    db.users.find_one = AsyncMock(return_value={"_id": REQUESTER})
    db.clinicians.find_one = AsyncMock(return_value=clinician() if approved else None)
    db.medical_reviews.insert_one = AsyncMock()
    db.medical_reviews.count_documents = AsyncMock(return_value=0)
    db.medical_reviews.find_one_and_update = AsyncMock(return_value=None)
    db.medical_reviews.delete_one = AsyncMock(return_value=MagicMock(deleted_count=0))


@pytest.mark.parametrize("field", ["consent", "adult_self", "not_emergency"])
@pytest.mark.parametrize("value", [False, None, 1, "true"])
def test_requires_explicit_confirmations(field, value):
    data = {"question": "This is a non-urgent question", "consent": True, "adult_self": True, "not_emergency": True, field: value}
    with pytest.raises(ValidationError): ReviewRequest(**data)


@pytest.mark.parametrize("model,key", [(ReviewRequest, "question"), (ReviewResponse, "note")])
def test_rejects_blank_or_overlong_text(model, key):
    base = {"consent": True, "adult_self": True, "not_emergency": True} if model is ReviewRequest else {"disposition": "in_person"}
    for text in (" " * 10, "x" * 1201):
        with pytest.raises(ValidationError): model(**base, **{key: text})


def test_serializer_does_not_leak_credential_evidence_or_internal_ids():
    doc = document(assigned_to=DOCTOR, approved_by="operator", phone="private", consent_version="private", response={"note": "Follow up locally", "disposition": "in_person", "private_evidence": "must not leak"})
    result = _serialize(doc)
    assert set(result) == {"id", "question", "status", "created_at", "expires_at", "response"}
    assert "private_evidence" not in result["response"]


@pytest.mark.asyncio
async def test_disabled_roster_rejects_questions_without_storing_them(client):
    c, db = client; prepare(db)
    assert (await c.get('/api/medical-review/status')).json()["accepting_requests"] is False
    r = await c.post('/api/medical-review/requests', headers=headers(), json={"question": "A non-urgent review question", "consent": True, "adult_self": True, "not_emergency": True})
    assert r.status_code == 503
    db.medical_reviews.insert_one.assert_not_awaited()


@pytest.mark.asyncio
async def test_request_is_private_pending_consented_and_expires(client):
    c, db = client; prepare(db, True)
    r = await c.post('/api/medical-review/requests', headers=headers(), json={"question": " A non-urgent review question ", "consent": True, "adult_self": True, "not_emergency": True})
    assert r.status_code == 201
    doc = db.medical_reviews.insert_one.call_args.args[0]
    assert doc["requester_id"] == REQUESTER
    assert doc["status"] == "pending" and "response" not in doc
    assert doc["consent_at"] == doc["created_at"]
    assert doc["expires_at"] - doc["created_at"] == timedelta(hours=72)
    assert "requester_id" not in r.json()


@pytest.mark.asyncio
async def test_request_caps_pending_cases_and_checks_existing_account(client):
    c, db = client; prepare(db, True)
    body = {"question": "A non-urgent review question", "consent": True, "adult_self": True, "not_emergency": True}
    db.medical_reviews.count_documents.return_value = 3
    assert (await c.post('/api/medical-review/requests', headers=headers(), json=body)).status_code == 409
    db.users.find_one.return_value = None
    assert (await c.post('/api/medical-review/requests', headers=headers(), json=body)).status_code == 401
    db.medical_reviews.insert_one.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["reporter", "volunteer", "doctor", "admin"])
async def test_roles_and_tokens_cannot_self_approve_a_doctor(client, role):
    c, db = client; prepare(db)
    r = await c.get('/api/medical-review/queue', headers=headers(OTHER, role))
    assert r.status_code == 403
    query = db.clinicians.find_one.call_args.args[0]
    assert query["_id"] == OTHER and query["active"] is True
    assert query["valid_until"]["$gt"].tzinfo is not None
    assert query["approved_at"] == {"$exists": True}


@pytest.mark.asyncio
async def test_mine_filters_owner_and_expiry_and_withdraw_requires_owner(client):
    c, db = client; prepare(db)
    doc = document()
    db.medical_reviews.find.return_value = Cursor([doc])
    r = await c.get('/api/medical-review/mine', headers=headers())
    assert r.status_code == 200
    query = db.medical_reviews.find.call_args.args[0]
    assert query["requester_id"] == REQUESTER and "$gt" in query["expires_at"]
    r = await c.delete(f'/api/medical-review/requests/{doc["_id"]}', headers=headers(OTHER))
    assert r.status_code == 404
    assert db.medical_reviews.delete_one.call_args.args[0]["requester_id"] == OTHER


@pytest.mark.asyncio
async def test_queue_does_not_expose_unassigned_health_text(client):
    c, db = client; prepare(db, True)
    doc = document(question="secret medical text")
    db.medical_reviews.find.side_effect = [Cursor([doc]), Cursor([])]
    r = await c.get('/api/medical-review/queue', headers=headers(DOCTOR))
    assert r.status_code == 200
    assert set(r.json()["pending"][0]) == {"id", "created_at", "expires_at"}
    assert "secret medical text" not in r.text
    assigned_query = db.medical_reviews.find.call_args_list[1].args[0]
    assert assigned_query["assigned_to"] == DOCTOR


@pytest.mark.asyncio
async def test_claim_and_response_are_atomic_and_bound_to_assigned_doctor(client):
    c, db = client; prepare(db, True)
    doc = document(status="claimed", assigned_to=DOCTOR)
    db.medical_reviews.find_one_and_update.return_value = doc
    r = await c.post(f'/api/medical-review/requests/{doc["_id"]}/claim', headers=headers(DOCTOR))
    assert r.status_code == 200
    query = db.medical_reviews.find_one_and_update.call_args.args[0]
    assert query["status"] == "pending" and query["requester_id"] == {"$ne": DOCTOR}
    assert "$gt" in query["expires_at"]
    r = await c.post(f'/api/medical-review/requests/{doc["_id"]}/response', headers=headers(DOCTOR), json={"disposition": "in_person", "note": "Please arrange an in-person assessment."})
    assert r.status_code == 200
    query, update = db.medical_reviews.find_one_and_update.call_args.args
    assert query["status"] == "claimed" and query["assigned_to"] == DOCTOR
    response = update["$set"]["response"]
    assert response["clinician_name"] == "Test Clinician" and response["registration"] == "TEST-ONLY"
    db.medical_reviews.find_one_and_update.return_value = None
    assert (await c.post(f'/api/medical-review/requests/{doc["_id"]}/response', headers=headers(DOCTOR), json={"disposition": "in_person", "note": "Cannot overwrite or review a withdrawn case."})).status_code == 409


@pytest.mark.asyncio
async def test_revoked_access_is_checked_again_on_every_write(client):
    c, db = client; prepare(db)
    r = await c.post(f'/api/medical-review/requests/{ObjectId()}/response', headers=headers(DOCTOR), json={"disposition": "emergency", "note": "Call emergency services now."})
    assert r.status_code == 403
    db.medical_reviews.find_one_and_update.assert_not_awaited()
