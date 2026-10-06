"""Operator-only local CLI. It does NOT verify a medical licence for you.

Use only after checking identity, active council registration and consent to
review. No public approval API. Does not print credentials or patient data.
Run from backend: python -m scripts.clinician_access --help
"""
import argparse
import asyncio
from datetime import datetime, timedelta, timezone

from bson import ObjectId
from pymongo import AsyncMongoClient

from app.core.config import settings


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("action", choices=["approve", "revoke"])
    p.add_argument("--user-id", required=True)
    p.add_argument("--reviewed-by", required=True, help="Operator identity for the private audit record")
    p.add_argument("--name")
    p.add_argument("--council")
    p.add_argument("--registration")
    p.add_argument("--valid-days", type=int, default=30)
    p.add_argument("--credentials-checked", action="store_true")
    return p


async def run(args):
    if not ObjectId.is_valid(args.user_id) or not args.reviewed_by.strip():
        raise ValueError("Provide a valid existing user ID and operator identity")
    if args.action == "approve" and (not args.credentials_checked or not all((args.name, args.council, args.registration)) or not 1 <= args.valid_days <= 90):
        raise ValueError("Approval needs checked credentials, name, council, registration and 1–90 validity days")
    if args.action == "approve" and any(not value.strip() or len(value) > 120 for value in (args.name, args.council, args.registration, args.reviewed_by)):
        raise ValueError("Credential labels must be non-blank and at most 120 characters")
    client = AsyncMongoClient(settings.MONGO_URL)
    try:
        db = client.get_default_database(default="neighbouraid")
        oid = ObjectId(args.user_id)
        if not await db.users.find_one({"_id": oid}, {"_id": 1}):
            raise ValueError("Account not found")
        now = datetime.now(timezone.utc)
        if args.action == "approve":
            await db.clinicians.update_one({"_id": oid}, {"$set": {"active": True, "name": args.name.strip(), "council": args.council.strip(), "registration": args.registration.strip(), "approved_at": now, "approved_by": args.reviewed_by.strip(), "valid_until": now + timedelta(days=args.valid_days)}}, upsert=True)
        else:
            await db.clinicians.update_one({"_id": oid}, {"$set": {"active": False, "revoked_at": now, "revoked_by": args.reviewed_by.strip()}})
        print(f"Clinician access {args.action} recorded. No licence verification was performed by this command.")
    finally:
        await client.close()


if __name__ == "__main__":
    try:
        asyncio.run(run(parser().parse_args()))
    except ValueError as error:
        raise SystemExit(str(error)) from error
