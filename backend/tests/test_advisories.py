"""Synthetic CAP fixtures: these are never posted as real community alerts."""
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock
import asyncio
import httpx
import pytest
from app.services import advisories as service

NOW = datetime(2026, 10, 6, 10, tzinfo=timezone.utc)
LINK = service.PORTAL + "cap_public_website/FetchXMLFile?identifier=42"


def cap(*, identifier="42", kind="Alert", status="Actual", scope="Public", expires=None, references="", effective=None):
    expires = expires or (NOW + timedelta(hours=2)).isoformat()
    effective = effective or NOW.isoformat()
    return f'''<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
      <identifier>{identifier}</identifier><sender>Test authority</sender><sent>{NOW.isoformat()}</sent>
      <status>{status}</status><msgType>{kind}</msgType><scope>{scope}</scope><references>{references}</references>
      <info><language>en-IN</language><event>Flood</event><urgency>Expected</urgency><severity>Severe</severity><certainty>Possible</certainty>
      <effective>{effective}</effective><expires>{expires}</expires><headline>Test flood warning</headline><instruction>Test instruction</instruction>
      <area><areaDesc>Test district</areaDesc></area></info></alert>'''.encode()


@pytest.fixture(autouse=True)
def reset_state(monkeypatch):
    for key, value in {"_rss_bytes": b"", "_rss_etag": "", "_xml_cache": {}, "_items": [], "_attempt": 0.0,
                       "_checked": None, "_status": "unavailable", "_partial": False, "_task": None}.items():
        monkeypatch.setattr(service, key, value)


def test_original_wording_uncertainty_area_and_times_are_preserved():
    item = service.parse_cap(cap(), LINK, NOW)["items"][0]
    assert item["certainty"] == "Possible"  # not upgraded to observed/certain
    assert item["instruction"] == "Test instruction"
    assert item["area"] == "Test district"
    assert item["link"] == LINK


@pytest.mark.parametrize("changes", [{"status": "Test"}, {"status": "Exercise"}, {"scope": "Private"}, {"scope": "Restricted"},
                                    {"expires": NOW.isoformat()}, {"expires": "bad date"}, {"expires": "2026-10-06T12:00:00"}])
def test_practice_private_and_expired_warnings_are_not_shown(changes):
    assert not service.parse_cap(cap(**changes), LINK, NOW)["items"]


def test_future_effective_warning_is_an_early_warning_not_rejected():
    assert service.parse_cap(cap(effective=(NOW + timedelta(minutes=30)).isoformat()), LINK, NOW)["items"]


def test_missing_area_does_not_invent_a_locality():
    raw = cap().replace(b"<areaDesc>Test district</areaDesc>", b"")
    assert not service.parse_cap(raw, LINK, NOW)["items"]


def test_cancel_and_update_reference_the_older_warning():
    reference = f"authority,41,{NOW.isoformat()}"
    cancelled = service.parse_cap(cap(kind="Cancel", references=reference), LINK, NOW)
    assert cancelled == {"items": [], "supersedes": ["41", "42"]}
    assert service.parse_cap(cap(kind="Update", references=reference), LINK, NOW)["supersedes"] == ["41"]


@pytest.mark.parametrize("url", ["http://sachet.ndma.gov.in/x", "https://sachet.ndma.gov.in.evil.test/x",
    "https://user@sachet.ndma.gov.in/cap_public_website/FetchXMLFile?identifier=42", LINK + "&redirect=x", LINK + "#x", LINK.replace("42", "../../x")])
def test_feed_links_cannot_trigger_arbitrary_network_requests(url):
    assert service.cap_url(url) is None


@pytest.mark.parametrize("encoding", ["utf-8", "utf-16", "utf-32"])
def test_entity_declarations_are_rejected_in_other_encodings_too(encoding):
    with pytest.raises(ValueError):
        service._xml('<!DOCTYPE alert [<!ENTITY x "expanded">]><alert>&x;</alert>'.encode(encoding))


async def test_first_request_fetches_even_on_a_recently_booted_machine(monkeypatch):
    refresh = AsyncMock()
    monkeypatch.setattr(service, "_refresh", refresh)
    monkeypatch.setattr(service.time, "monotonic", lambda: 12.0)
    await asyncio.gather(service.fetch_advisories(), service.fetch_advisories())
    assert refresh.await_count == 1


async def test_etags_reuse_xml_and_failed_refresh_is_not_all_clear(monkeypatch):
    future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    rss = f'<rss><channel><item><link>{LINK}</link></item></channel></rss>'.encode()
    calls = []
    phase = [1]
    def respond(request):
        calls.append(request)
        if phase[0] == 3: return httpx.Response(503)
        if phase[0] == 2: return httpx.Response(304)
        return httpx.Response(200, content=rss if str(request.url) == service.RSS else cap(expires=future), headers={"etag": '"cached"'})
    client_class = httpx.AsyncClient
    monkeypatch.setattr(service.httpx, "AsyncClient", lambda **kwargs: client_class(transport=httpx.MockTransport(respond), **kwargs))
    await service._refresh()
    assert service.current_snapshot()["status"] == "available"
    assert len(service.current_snapshot()["items"]) == 1
    phase[0] = 2
    await service._refresh()
    assert len(service.current_snapshot()["items"]) == 1
    assert all(request.headers["If-None-Match"] == '"cached"' for request in calls[-2:])
    phase[0] = 3
    await service._refresh()
    assert service.current_snapshot()["status"] == "stale"
    assert service.current_snapshot()["location_matched"] is False


def test_expired_cached_warning_is_not_returned(monkeypatch):
    monkeypatch.setattr(service, "_items", service.parse_cap(cap(), LINK, NOW)["items"])
    assert not service.current_snapshot()["items"]


async def test_advisory_route_returns_source_metadata(client, monkeypatch):
    from app.routes import advisories
    fetch = AsyncMock(return_value={"items": [], "status": "unavailable", "location_matched": False, "source_url": service.PORTAL})
    monkeypatch.setattr(advisories, "fetch_advisories", fetch)
    http, _ = client
    response = await http.get("/api/advisories/")
    assert response.status_code == 200
    assert response.json()["status"] == "unavailable"
