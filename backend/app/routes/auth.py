from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pymongo.errors import DuplicateKeyError
from ..db.client import get_db
from ..models.user import UserCreate, UserLogin
from ..core.security import hash_password, verify_password, create_token
from ..core.limits import limit_login, limit_register

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", status_code=201, dependencies=[Depends(limit_register)])
async def register(user: UserCreate):
    db = get_db()
    if await db.users.find_one({"email": user.email}):
        raise HTTPException(400, "Email already registered")
    doc = {
        "name": user.name,
        "email": user.email,
        "password_hash": hash_password(user.password),
        "role": user.role.value,
        "location": user.location.model_dump(),
        "skills": [s.value for s in user.skills],
        "has_vehicle": user.has_vehicle,
        "emergency_contacts": [c.model_dump() for c in user.emergency_contacts],
        "created_at": datetime.now(timezone.utc),
    }
    # The find_one above is a friendly fast path, not a guarantee — two
    # signups racing on the same address both pass it. The unique index on
    # `email` is the real check, so translate its error into the same 400
    # rather than letting it surface as a 500.
    try:
        result = await db.users.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(400, "Email already registered")
    token = create_token({"sub": str(result.inserted_id), "role": user.role.value})
    return {"token": token, "role": user.role.value, "name": user.name}


@router.post("/login", dependencies=[Depends(limit_login)])
async def login(creds: UserLogin):
    db = get_db()
    user = await db.users.find_one({"email": creds.email})
    if not user or not verify_password(creds.password, user["password_hash"]):
        raise HTTPException(401, "Invalid credentials")
    token = create_token({"sub": str(user["_id"]), "role": user["role"]})
    return {"token": token, "role": user["role"], "name": user["name"]}
