"""One preference/skill/radius policy for live alerts and opted-in web push."""
import math

from ..models.user import NotificationPreferences
from .dispatch import radius_km_for

CATEGORY_PREFERRED_SKILLS = {
    "medical": ["medical", "cpr", "elderly_care", "child_care"],
    "fire": ["medical", "driver"], "flood": ["swim", "driver"],
    "accident": ["medical", "cpr", "driver"], "missing": ["driver"],
    # This does not qualify somebody to enter a violent or hazardous scene.
    "violence": ["medical"], "animal": [], "gas": ["driver"],
    "power": ["electrician"], "water": [], "structure": ["medical", "driver"],
    "other": [],
}


def preferences(raw=None):
    return NotificationPreferences.model_validate(raw or {}).model_dump(mode="json")


def matching(alert, *, distance_km, skills=None, has_vehicle=False, raw_preferences=None, base_radius=5):
    pref = preferences(raw_preferences)
    category = alert.get("category", "other")
    skill_match = bool(pref["skill_matching"] and set(skills or []).intersection(CATEGORY_PREFERRED_SKILLS.get(category, [])))
    radius = min(pref["radius_km"], max(base_radius, radius_km_for(has_vehicle, skill_match)))
    eligible = bool(
        pref["enabled"] and (not pref["categories"] or category in pref["categories"])
        and math.isfinite(distance_km) and 0 <= distance_km <= radius
    )
    return eligible, skill_match, pref


def distance_km(alert, user):
    try:
        lng1, lat1 = alert["location"]["coordinates"]
        lng2, lat2 = user["location"]["coordinates"]
        dlat, dlng = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
        value = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
        return 6371 * 2 * math.asin(math.sqrt(min(1, max(0, value))))
    except (KeyError, TypeError, ValueError):
        return math.inf
