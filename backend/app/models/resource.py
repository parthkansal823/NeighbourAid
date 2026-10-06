"""Community-pinned resources during a crisis: shelters, food, blood banks,
oxygen, water, medical camps. The resource map is the "WhatsApp group of
useful things" gap NeighbourAid is trying to close.

Each resource carries a `kind`, location, contact, and an `expires_at`
deadline so stale entries (closed shelters, depleted oxygen) drop off
automatically — analogous to how `safety_checkins` work."""

from enum import Enum
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator


class ResourceKind(str, Enum):
    shelter = "shelter"
    food = "food"
    blood = "blood"
    oxygen = "oxygen"
    water = "water"
    medical_camp = "medical_camp"
    other = "other"


class GeoPoint(BaseModel):
    type: Literal["Point"] = Field(default="Point")
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


class ResourceCreate(BaseModel):
    kind: ResourceKind
    name: str = Field(min_length=2, max_length=120)
    location: GeoPoint
    contact: Optional[str] = Field(default=None, max_length=120)
    capacity: Optional[int] = Field(default=None, ge=0, le=100000)
    notes: Optional[str] = Field(default=None, max_length=500)
    # How long this listing should be considered current. Caller can omit
    # to use the route default (24 h). A shelter that's only open for 6 h
    # should override.
    valid_for_hours: int = Field(default=24, ge=1, le=24 * 14)

    @field_validator("name")
    @classmethod
    def strip_name(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 2:
            raise ValueError("name must be at least 2 characters after trimming")
        return v

    @field_validator("contact", "notes")
    @classmethod
    def strip(cls, v):
        if v is None:
            return v
        v = v.strip()
        return v or None
