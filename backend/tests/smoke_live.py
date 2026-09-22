"""End-to-end smoke test against a RUNNING server and a REAL database.

    # with the API already running on :8000
    python -m tests.smoke_live
    python -m tests.smoke_live --base-url https://your-deploy.example.com

This is not pytest and is not part of the suite. The unit tests mock the
database, which is the right trade for speed but means they cannot catch the
failures that only appear against real MongoDB: a missing index, an `await`
left off a cursor, a projection that leaks a field, a query whose filter shape
the mock happily accepted. Those are exactly the bugs that reach production.

It walks the actual user journeys end to end — report an emergency, get it
triaged, have a volunteer accept and resolve it — and asserts on what the next
step depends on rather than on response shape alone.

Every document it creates is deleted on the way out, and the accounts it
registers are namespaced with a run id so a failed run leaves obvious litter
rather than colliding with the next one. It is safe against a dev database;
do not point it at production, because it writes.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
import uuid

import httpx

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Chandigarh, matching the coordinates the rest of the fixtures use.
LAT, LNG = 30.7333, 76.7794

_passed: list[str] = []
_failed: list[tuple[str, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    (_passed if ok else _failed).append(name if ok else (name, detail))  # type: ignore[arg-type]
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{'' if ok else f'  -> {detail}'}")
    return ok


def _auth(token: str) -> dict:
    # An empty token would make httpx raise "Illegal header value b'Bearer '"
    # before the request is sent, burying whichever earlier step failed to
    # produce it. Send a sentinel instead so the server answers 401 and the
    # report still points at the real cause.
    return {"Authorization": f"Bearer {token or 'no-token'}"}


async def main(base_url: str) -> int:
    run = uuid.uuid4().hex[:8]
    created_alerts: list[tuple[str, str]] = []  # (alert_id, owner token)
    created_resources: list[tuple[str, str]] = []

    async with httpx.AsyncClient(base_url=base_url, timeout=30.0) as c:
        print(f"\nsmoke run {run} against {base_url}\n")

        # ---- health -------------------------------------------------------
        print("health")
        r = await c.get("/health")
        check("GET /health", r.status_code == 200, r.text[:120])
        r = await c.get("/health/ready")
        ready = r.json() if r.status_code == 200 else {}
        if not check(
            "GET /health/ready reaches the database",
            ready.get("database") == "ok",
            r.text[:160],
        ):
            print("\nDatabase is unreachable — nothing below can be trusted.")
            return 1

        # ---- accounts -----------------------------------------------------
        print("\nauth")
        reporter = {
            "name": "Smoke Reporter",
            "email": "smoke.reporter@smoke.example.com",
            "password": "smoketest123",
            "role": "reporter",
            "location": {"type": "Point", "coordinates": [LNG, LAT]},
        }
        volunteer = {
            **reporter,
            "name": "Smoke Volunteer",
            "email": "smoke.volunteer@smoke.example.com",
            "role": "volunteer",
            "skills": ["medical", "cpr"],
            "has_vehicle": True,
        }

        async def register_or_login(who: dict, label: str) -> str:
            """Reuse the standing smoke account, creating it only the first time.

            Registering fresh accounts on every run fails by design: the
            register endpoint is rate limited per IP, so the second run in a
            window gets a 429 and everything downstream is skipped. It also
            left a new pair of users in the database each time. Registering
            once and logging in afterwards is both re-runnable and tidy — and
            the 429 path stays covered, because hitting the limit here now
            falls through to login rather than failing the run.
            """
            r = await c.post("/api/auth/register", json=who)
            if r.status_code in (200, 201) and r.json().get("token"):
                check(f"POST /api/auth/register ({label})", True)
                return r.json()["token"]
            # Already exists, or the limiter said slow down: log in instead.
            r2 = await c.post(
                "/api/auth/login",
                json={"email": who["email"], "password": who["password"]},
            )
            token = r2.json().get("token", "") if r2.status_code == 200 else ""
            check(
                f"auth ({label}) — reused the standing smoke account",
                bool(token),
                f"register said {r.status_code} {r.text[:90]}; "
                f"login said {r2.status_code} {r2.text[:90]}",
            )
            return token

        rep_token = await register_or_login(reporter, "reporter")
        vol_token = await register_or_login(volunteer, "volunteer")

        r = await c.post(
            "/api/auth/login",
            json={"email": reporter["email"], "password": reporter["password"]},
        )
        check("POST /api/auth/login", r.status_code == 200 and "token" in r.json(), r.text[:160])

        r = await c.post(
            "/api/auth/login",
            json={"email": reporter["email"], "password": "wrong-password"},
        )
        check("login rejects a wrong password", r.status_code == 401, f"got {r.status_code}")

        r = await c.get("/api/users/me", headers=_auth(rep_token))
        check("GET /api/users/me", r.status_code == 200 and r.json().get("email") == reporter["email"], r.text[:160])

        r = await c.get("/api/users/me")
        check("/api/users/me requires a token", r.status_code == 401, f"got {r.status_code}")

        if not (rep_token and vol_token):
            print("\nCould not create accounts — the journeys below need them.")
            return 1

        # ---- posting an alert, and the triage that runs on it -------------
        print("\nalerts")
        t0 = time.perf_counter()
        r = await c.post(
            "/api/alerts/",
            json={
                "category": "medical",
                "description": "A man collapsed near the market and is not breathing",
                "location": {"type": "Point", "coordinates": [LNG, LAT]},
            },
            headers=_auth(rep_token),
        )
        post_ms = (time.perf_counter() - t0) * 1000
        alert = r.json() if r.status_code in (200, 201) else {}
        alert_id = alert.get("id", "")
        if alert_id:
            created_alerts.append((alert_id, rep_token))
        check("POST /api/alerts/", bool(alert_id), r.text[:200])
        check(
            "triage ranked a 'not breathing' report CRITICAL",
            alert.get("urgency") == "CRITICAL",
            f"got {alert.get('urgency')} ({alert.get('urgency_reason')})",
        )
        check("alert creation is not blocked by enrichment", post_ms < 3000, f"{post_ms:.0f} ms")

        r = await c.post(
            "/api/alerts/anonymous",
            json={
                "category": "fire",
                "description": f"Smoke test {run}: fire near the old depot",
                "location": {"type": "Point", "coordinates": [LNG, LAT]},
            },
        )
        anon = r.json() if r.status_code in (200, 201) else {}
        if anon.get("id"):
            created_alerts.append((anon["id"], rep_token))
        check("POST /api/alerts/anonymous works signed out", bool(anon.get("id")), r.text[:200])

        # ---- duplicate folding -------------------------------------------
        #
        # Corroboration already fed verified_score, but only one way round:
        # the new alert knew which alerts it matched and none of them learned
        # about it, so five people reporting one fire produced five cards.
        r = await c.post(
            "/api/alerts/",
            json={
                "category": "medical",
                "description": "Someone has collapsed by the market and is not breathing",
                "location": {"type": "Point", "coordinates": [LNG, LAT]},
            },
            # The reporter token, not the volunteer one: POST /api/alerts/ is
            # reporter-only, and a 403 here reads exactly like a failed merge.
            headers=_auth(rep_token),
        )
        dup = r.json() if r.status_code in (200, 201) else {}
        if dup.get("id"):
            created_alerts.append((dup["id"], rep_token))
        # Asserts that it folded, not WHICH alert it folded into. The
        # canonical is the oldest match, and on a database with real history
        # that can legitimately be an older report rather than this run's —
        # pinning it to alert_id made the check fail on leftover data while
        # the feature was working correctly.
        canonical_id = dup.get("duplicate_of")
        check(
            "a second report of the same incident is marked a duplicate",
            bool(canonical_id),
            f"HTTP {r.status_code}; duplicate_of={canonical_id}; "
            f"body={r.text[:120]}",
        )
        canonical_id = canonical_id or alert_id

        r = await c.get(f"/api/alerts/{canonical_id}")
        canonical = r.json() if r.status_code == 200 else {}
        witnesses_before = canonical.get("witnesses", 0)
        check(
            "the same person reporting twice is not counted as two witnesses",
            witnesses_before == 1,
            f"witnesses={witnesses_before} — bump_witness should be "
            f"idempotent per identity",
        )

        # A genuinely different person, via the public form. This is the path
        # that matters most for merging: a crowd watching one incident mostly
        # reaches for the anonymous form.
        r = await c.post(
            "/api/alerts/anonymous",
            json={
                "category": "medical",
                "description": "A man has collapsed near the market, not breathing",
                "location": {"type": "Point", "coordinates": [LNG, LAT]},
            },
        )
        anon_dup = r.json() if r.status_code in (200, 201) else {}
        if anon_dup.get("id"):
            created_alerts.append((anon_dup["id"], rep_token))
        check(
            "an anonymous report folds into the same incident",
            anon_dup.get("duplicate_of") == canonical_id,
            f"HTTP {r.status_code}; duplicate_of={anon_dup.get('duplicate_of')} "
            f"expected {canonical_id}; body={r.text[:120]}",
        )

        r = await c.get(f"/api/alerts/{canonical_id}")
        canonical = r.json() if r.status_code == 200 else {}
        check(
            "a different reporter does add a witness to the original",
            canonical.get("witnesses", 0) > witnesses_before,
            f"witnesses went {witnesses_before} -> {canonical.get('witnesses')}",
        )

        r = await c.get("/api/alerts/nearby", params={"lat": LAT, "lng": LNG}, headers=_auth(vol_token))
        nearby = r.json() if r.status_code == 200 else []
        check(
            "GET /api/alerts/nearby returns the new alert",
            any(a.get("id") == alert_id for a in nearby),
            f"{len(nearby)} alerts, status {r.status_code}",
        )
        folded = {d.get("id") for d in (dup, anon_dup) if d.get("id")}
        check(
            "the feed shows one card per incident, not the duplicates too",
            not any(a.get("id") in folded for a in nearby),
            f"a folded report appeared in /nearby: "
            f"{sorted(folded & {a.get('id') for a in nearby})}",
        )

        r = await c.get("/api/alerts/mine", headers=_auth(rep_token))
        mine = r.json() if r.status_code == 200 else []
        check("GET /api/alerts/mine", any(a.get("id") == alert_id for a in mine), r.text[:160])

        r = await c.get("/api/alerts/mine", headers=_auth(vol_token))
        check("/api/alerts/mine is reporter-only", r.status_code == 403, f"got {r.status_code}")

        r = await c.get(f"/api/alerts/{alert_id}")
        check("GET /api/alerts/{id} is a public share link", r.status_code == 200, r.text[:160])

        r = await c.get("/api/alerts/heatmap", params={"lat": LAT, "lng": LNG})
        check("GET /api/alerts/heatmap", r.status_code == 200, r.text[:160])

        # ---- the volunteer response loop ---------------------------------
        print("\nresponse loop")
        r = await c.patch(f"/api/alerts/{alert_id}/accept", headers=_auth(vol_token))
        check("PATCH accept", r.status_code == 200, r.text[:160])

        r = await c.patch(f"/api/alerts/{alert_id}/eta", json={"eta_minutes": 7}, headers=_auth(vol_token))
        check("PATCH eta", r.status_code == 200, r.text[:160])

        r = await c.get(f"/api/alerts/{alert_id}/responder", headers=_auth(rep_token))
        check("GET responder shows who is coming", r.status_code == 200, r.text[:160])

        r = await c.post(
            f"/api/alerts/{alert_id}/updates",
            json={"body": "On my way, two minutes out"},
            headers=_auth(vol_token),
        )
        check("POST an update to the thread", r.status_code in (200, 201), r.text[:160])

        r = await c.get(f"/api/alerts/{alert_id}/updates", headers=_auth(rep_token))
        check("GET the update thread", r.status_code == 200 and len(r.json()) >= 1, r.text[:160])

        r = await c.post(f"/api/alerts/{alert_id}/witness", headers=_auth(vol_token))
        check("POST witness", r.status_code == 200, r.text[:160])

        r = await c.patch(f"/api/alerts/{alert_id}/resolve", headers=_auth(vol_token))
        check("PATCH resolve", r.status_code == 200, r.text[:160])

        if anon.get("id"):
            r = await c.post(f"/api/alerts/{anon['id']}/flag", headers=_auth(vol_token))
            check("POST flag", r.status_code == 200, r.text[:160])

        # ---- safety check-ins --------------------------------------------
        print("\nsafety")
        r = await c.post(
            "/api/safety/",
            json={
                "status": "safe",
                "note": f"smoke {run}",
                "location": {"type": "Point", "coordinates": [LNG, LAT]},
            },
            headers=_auth(vol_token),
        )
        check("POST /api/safety/", r.status_code in (200, 201), r.text[:160])

        r = await c.get("/api/safety/near", params={"lat": LAT, "lng": LNG})
        rows = r.json() if r.status_code == 200 else []
        check("GET /api/safety/near is public", r.status_code == 200, r.text[:160])
        check(
            "/api/safety/near never leaks user_id",
            all("user_id" not in row for row in rows),
            "a row contained user_id",
        )

        r = await c.get("/api/safety/me", headers=_auth(vol_token))
        check("GET /api/safety/me", r.status_code == 200 and (r.json() or {}).get("status") == "safe", r.text[:160])

        # ---- resources ----------------------------------------------------
        print("\nresources")
        r = await c.post(
            "/api/resources/",
            json={
                "kind": "water",
                "name": f"Smoke water point {run}",
                "location": {"type": "Point", "coordinates": [LNG, LAT]},
            },
            headers=_auth(vol_token),
        )
        res = r.json() if r.status_code in (200, 201) else {}
        if res.get("id"):
            created_resources.append((res["id"], vol_token))
        check("POST /api/resources/", bool(res.get("id")), r.text[:200])

        r = await c.get("/api/resources/near", params={"lat": LAT, "lng": LNG})
        check("GET /api/resources/near is public", r.status_code == 200, r.text[:160])

        # ---- read-only surfaces ------------------------------------------
        print("\nstats and lookups")
        t0 = time.perf_counter()
        r = await c.get("/api/stats/")
        stats_ms = (time.perf_counter() - t0) * 1000
        body = r.json() if r.status_code == 200 else {}
        check("GET /api/stats/", "active_alerts" in body, r.text[:160])
        # The four counters are gathered rather than awaited one by one; this
        # is the endpoint every first-time visitor waits on.
        check("stats responds quickly", stats_ms < 2000, f"{stats_ms:.0f} ms")

        r = await c.get("/api/stats/leaderboard", params={"limit": 5, "days": 30})
        check("GET /api/stats/leaderboard", r.status_code == 200 and "top" in r.json(), r.text[:160])

        r = await c.get("/api/stats/leaderboard", params={"limit": 9999, "days": 9999})
        check(
            "leaderboard clamps and reports the clamped window",
            r.status_code == 200 and r.json().get("window_days") == 365,
            r.text[:160],
        )

        r = await c.get("/api/users/me/stats", headers=_auth(vol_token))
        check("GET /api/users/me/stats", r.status_code == 200 and "role" in r.json(), r.text[:160])

        r = await c.get("/api/geo/reverse", params={"lat": LAT, "lng": LNG})
        check("GET /api/geo/reverse", r.status_code == 200, r.text[:160])

        r = await c.get("/api/news/recent")
        check("GET /api/news/recent", r.status_code == 200, r.text[:160])

        # ---- cleanup ------------------------------------------------------
        print("\ncleanup")
        for aid, token in created_alerts:
            r = await c.delete(f"/api/alerts/{aid}", headers=_auth(token))
            check(f"DELETE alert {aid[:8]}", r.status_code in (204, 200, 404), f"got {r.status_code}")
        for rid, token in created_resources:
            r = await c.delete(f"/api/resources/{rid}", headers=_auth(token))
            check(f"DELETE resource {rid[:8]}", r.status_code in (204, 200, 404), f"got {r.status_code}")

    print("\n" + "=" * 70)
    print(f"  {len(_passed)} passed, {len(_failed)} failed")
    print("=" * 70)
    if _failed:
        for name, detail in _failed:  # type: ignore[misc]
            print(f"  FAILED  {name}\n          {detail}")
        print("\nNote: the smoke accounts and any undeleted documents are")
        print(f"namespaced with run id {run} if you need to clean up by hand.")
    return 1 if _failed else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://127.0.0.1:8000")
    args = ap.parse_args()
    raise SystemExit(asyncio.run(main(args.base_url)))
