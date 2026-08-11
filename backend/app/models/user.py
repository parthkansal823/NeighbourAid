from datetime import datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator

from .alert import VolunteerSkill  # shared enum


class UserRole(str, Enum):
    reporter = "reporter"
    volunteer = "volunteer"


def normalize_email(v: str) -> str:
    """Lower-case and trim so `Asha@Gmail.com` and `asha@gmail.com` are the
    same account.

    RFC 5321 does allow a case-sensitive local part, but no mailbox provider
    users are likely to have actually implements it that way — and the
    `email` unique index *is* case-sensitive. Without normalising here, a
    user who signs up on their phone (autocapitalised first letter) simply
    cannot log in from their laptop, and a second signup with the same
    address silently succeeds as a separate account.
    """
    return v.strip().lower()


class GeoPoint(BaseModel):
    type: str = Field(default="Point")
    coordinates: List[float] = Field(min_length=2, max_length=2)

    @field_validator("coordinates")
    @classmethod
    def validate_lng_lat(cls, v: list[float]) -> list[float]:
        lng, lat = v
        if not (-180 <= lng <= 180):
            raise ValueError("longitude must be between -180 and 180")
        if not (-90 <= lat <= 90):
            raise ValueError("latitude must be between -90 and 90")
        return v

    @field_validator("type")
    @classmethod
    def force_point(cls, v: str) -> str:
        if v != "Point":
            raise ValueError("GeoPoint.type must be 'Point'")
        return v


class EmergencyContact(BaseModel):
    """A trusted contact pinged client-side on SOS or "need help" check-ins.
    Kept minimal — the backend never sends SMS/email itself; the client
    opens the relevant tel:/sms:/mailto: link on tap."""

    name: str = Field(min_length=1, max_length=80)
    phone: Optional[str] = Field(default=None, max_length=32)
    email: Optional[EmailStr] = None

    @field_validator("name")
    @classmethod
    def strip_name(cls, v: str) -> str:
        return v.strip()

    @field_validator("phone")
    @classmethod
    def strip_phone(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        return v or None


class UserCreate(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    # Strengthened from 6 chars to 8 with at-least-one-letter,
    # at-least-one-digit. Doesn't force special chars (which the OWASP
    # 2024 guidance now considers an anti-pattern that drives users
    # toward `Password!1` clones), but blocks the lowest-effort
    # passwords like "123456" or "password".
    password: str = Field(min_length=8, max_length=128)
    role: UserRole
    location: GeoPoint
    # Volunteer-only optional fields. Ignored for reporters.
    skills: List[VolunteerSkill] = Field(default_factory=list)
    has_vehicle: bool = False
    emergency_contacts: List[EmergencyContact] = Field(default_factory=list, max_length=5)

    @field_validator("name")
    @classmethod
    def strip_name(cls, v: str) -> str:
        stripped = v.strip()
        if len(stripped) < 2:
            raise ValueError("name must be at least 2 non-space characters")
        return stripped

    @field_validator("email")
    @classmethod
    def lower_email(cls, v: str) -> str:
        return normalize_email(v)

    @field_validator("password")
    @classmethod
    def password_complexity(cls, v: str) -> str:
        # Require at least one letter and one digit. Avoids the worst
        # passwords without the security-theatre of mandatory specials.
        if not any(ch.isalpha() for ch in v) or not any(ch.isdigit() for ch in v):
            raise ValueError(
                "password must contain at least one letter and one digit"
            )
        return v


class UserLogin(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def lower_email(cls, v: str) -> str:
        return normalize_email(v)


class LocationUpdate(BaseModel):
    location: GeoPoint


class ProfileUpdate(BaseModel):
    """Partial update for fields a user can change post-registration. Any
    None field is left untouched."""

    skills: Optional[List[VolunteerSkill]] = None
    has_vehicle: Optional[bool] = None
    emergency_contacts: Optional[List[EmergencyContact]] = Field(default=None, max_length=5)


class UserOut(BaseModel):
    id: str
    name: str
    email: str
    role: UserRole
    location: GeoPoint
    skills: List[VolunteerSkill] = Field(default_factory=list)
    has_vehicle: bool = False
    emergency_contacts: List[EmergencyContact] = Field(default_factory=list)
    created_at: datetime
