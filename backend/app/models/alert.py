from datetime import datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


class AlertCategory(str, Enum):
    """Report categories.

    Additive only. Existing alerts carry the old values, and a removed member
    would make every historical alert fail validation on read.

    Category drives volunteer routing (see CATEGORY_PREFERRED_SKILLS in
    services/websocket.py), so a new member should be added there too or it
    silently gets the default radius and no skill matching.
    """

    medical = "medical"
    fire = "fire"
    flood = "flood"
    accident = "accident"
    missing = "missing"
    violence = "violence"
    animal = "animal"
    gas = "gas"
    power = "power"
    water = "water"
    structure = "structure"
    other = "other"


class UrgencyLevel(str, Enum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class AlertStatus(str, Enum):
    open = "open"
    accepted = "accepted"
    resolved = "resolved"


class VolunteerSkill(str, Enum):
    medical = "medical"
    cpr = "cpr"
    swim = "swim"
    driver = "driver"
    electrician = "electrician"
    translator = "translator"
    elderly_care = "elderly_care"
    child_care = "child_care"


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


# Photos are stored inline as data URLs. We intentionally cap byte size so
# one user can't blow up the document quota. The frontend compresses +
# resizes before upload, so 300 KB per photo × 3 photos is plenty.
_MAX_PHOTO_BYTES = 300_000
_MAX_PHOTOS = 3


def _validate_photos(v: list[str]) -> list[str]:
    if len(v) > _MAX_PHOTOS:
        raise ValueError(f"max {_MAX_PHOTOS} photos per alert")
    for i, p in enumerate(v):
        if not isinstance(p, str):
            raise ValueError(f"photo {i} must be a string")
        if not p.startswith("data:image/"):
            raise ValueError(f"photo {i} must be a data:image/... URL")
        if len(p) > _MAX_PHOTO_BYTES:
            raise ValueError(
                f"photo {i} too large ({len(p)} bytes) — max {_MAX_PHOTO_BYTES}"
            )
    return v


class AlertCreate(BaseModel):
    category: AlertCategory
    description: str = Field(min_length=10, max_length=2000)
    location: GeoPoint
    photos: List[str] = Field(default_factory=list)

    @field_validator("description")
    @classmethod
    def strip_description(cls, v: str) -> str:
        stripped = v.strip()
        if len(stripped) < 10:
            raise ValueError("description must be at least 10 non-space characters")
        return stripped

    @field_validator("photos")
    @classmethod
    def validate_photos(cls, v: list[str]) -> list[str]:
        return _validate_photos(v)


class ETAUpdate(BaseModel):
    """Volunteer-provided estimated time of arrival, in minutes."""

    eta_minutes: int = Field(ge=0, le=240)


class AlertUpdateCreate(BaseModel):
    """A short situational update posted against an alert.

    Previously the route took a bare `dict` and hand-rolled the length check,
    so a non-string `body` (say `{"body": {"$ne": null}}`) reached `.strip()`
    and raised a 500 instead of a 422, and the field never appeared in the
    OpenAPI schema.
    """

    body: str = Field(min_length=3, max_length=500)

    @field_validator("body")
    @classmethod
    def strip_body(cls, v: str) -> str:
        stripped = v.strip()
        if len(stripped) < 3:
            raise ValueError("update must be at least 3 non-space characters")
        return stripped


class AlertOut(BaseModel):
    id: str
    reporter_id: str
    category: AlertCategory
    description: str
    urgency: UrgencyLevel
    urgency_reason: str
    location: GeoPoint
    status: AlertStatus
    accepted_by: Optional[str]
    photos: List[str] = Field(default_factory=list)
    photo_count: int = 0
    eta_minutes: Optional[int] = None
    eta_set_at: Optional[datetime] = None
    flags: int = 0
    created_at: datetime
    resolved_at: Optional[datetime]
