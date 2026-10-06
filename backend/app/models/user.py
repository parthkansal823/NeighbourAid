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
    # Optional, and released to exactly one other person at a time: see
    # `contact_phone_for` in routes/alerts.py. Not the same thing as an
    # emergency contact below — that is someone the user would ping, this is
    # how the person on the other end of one accepted alert reaches them.
    phone: Optional[str] = Field(default=None, max_length=32)
    # Volunteer-only optional fields. Ignored for reporters.
    skills: List[VolunteerSkill] = Field(default_factory=list)
    has_vehicle: bool = False
    emergency_contacts: List[EmergencyContact] = Field(default_factory=list, max_length=5)

    @field_validator("phone")
    @classmethod
    def strip_phone(cls, v: Optional[str]) -> Optional[str]:
        # "" and "   " both mean "I did not give one". Storing them as empty
        # strings would make the release check below think a number exists
        # and render a dead tel: link on a call button someone taps in an
        # emergency.
        if v is None:
            return v
        return v.strip() or None

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


class Availability(BaseModel):
    """When a volunteer is willing to have their phone buzz.

    Hours are local and carry their own IANA zone, because "ten at night"
    is meaningless without knowing whose ten. The browser reports the zone
    (`Intl.DateTimeFormat().resolvedOptions().timeZone`); the server
    compares with it. Defaults are all-hours, so this only ever narrows.

    Only push is affected — see services/availability.py.
    """

    timezone: str = Field(default="Asia/Kolkata", max_length=64)
    from_hour: int = Field(default=0, ge=0, le=23)
    to_hour: int = Field(default=24, ge=0, le=24)
    # A CRITICAL alert is someone not breathing. Left on by default, and
    # switching it off is a decision the volunteer has to make deliberately.
    critical_always: bool = True
    # "Not right now" — driving, in surgery, at a funeral. Absolute rather
    # than a duration so a server restart cannot extend it.
    busy_until: Optional[datetime] = None


class ProfileUpdate(BaseModel):
    """Partial update for fields a user can change post-registration. Any
    None field is left untouched."""

    skills: Optional[List[VolunteerSkill]] = None
    has_vehicle: Optional[bool] = None
    emergency_contacts: Optional[List[EmergencyContact]] = Field(default=None, max_length=5)
    # Empty string is meaningful here and None is not: None means "leave my
    # number alone", "" means "delete it". A partial update with no way to
    # clear a field is a field you can only ever add.
    phone: Optional[str] = Field(default=None, max_length=32)
    availability: Optional[Availability] = None

    @field_validator("phone")
    @classmethod
    def strip_phone(cls, v: Optional[str]) -> Optional[str]:
        return v.strip() if v is not None else None


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
