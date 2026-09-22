"""Startup config guards.

These exist so a missing environment variable fails in one readable line
instead of as a symptom 30 seconds later. The MONGO_URL guard was added after
an unset variable on a real deploy produced a 40-line PyMongo
ServerSelectionTimeoutError, which reads like a network fault and sends you
to check firewalls and IP allow-lists rather than the one variable that was
actually wrong.
"""

import pytest

from app.core.config import _points_at_localhost


@pytest.mark.parametrize(
    "url",
    [
        "mongodb://localhost:27017/neighbouraid",
        "mongodb://127.0.0.1:27017/neighbouraid",
        "mongodb://0.0.0.0:27017/",
        "mongodb://user:pass@localhost:27017/neighbouraid",
    ],
)
def test_detects_local_mongo_urls(url):
    assert _points_at_localhost(url) is True


@pytest.mark.parametrize(
    "url",
    [
        # The real shape people paste from Atlas. A false positive here would
        # refuse to boot a correctly-configured production deploy, which is a
        # far worse failure than the confusing traceback this guard replaces.
        "mongodb+srv://u:p@cluster0.abcde.mongodb.net/neighbouraid?retryWrites=true&w=majority",
        "mongodb://u:p@cluster0-shard-00-00.abcde.mongodb.net:27017/neighbouraid",
        "mongodb+srv://u:p@my-localhost-cluster.abcde.mongodb.net/neighbouraid",
        "mongodb://mongo:27017/neighbouraid",
    ],
)
def test_does_not_flag_real_remote_urls(url):
    assert _points_at_localhost(url) is False


def test_environment_defaults_to_production():
    """The default has to be the safe one.

    A deploy that sets nothing must still get the strict startup checks.
    Defaulting to development meant a forgotten ENVIRONMENT variable silently
    downgraded the JWT-secret and MONGO_URL guards to log warnings that
    nobody reads, and the app booted anyway with a signing key published in
    this repo. Tests and local dev opt out explicitly instead.
    """
    from app.core.config import Settings

    # Build a fresh Settings ignoring both the ambient environment and the
    # repo's .env files, which is exactly the situation on a bare deploy:
    # push-gradio-space.sh strips .env out of the Space tree.
    bare = Settings.model_construct()
    assert Settings.model_fields["ENVIRONMENT"].default == "production"
    assert bare.ENVIRONMENT == "production"


def test_a_bare_deploy_is_rejected_rather_than_booted():
    """Defaults alone must not produce a runnable production config."""
    from app.core.config import DEV_JWT_SECRET, Settings, _points_at_localhost

    bare = Settings.model_construct()
    assert bare.is_production
    # Both guards in config.py fire on these, so import would raise.
    assert bare.JWT_SECRET == DEV_JWT_SECRET
    assert _points_at_localhost(bare.MONGO_URL)


class TestMultiWorkerWarning:
    """The app keeps WebSocket connections and rate-limit buckets in plain
    process-local dicts. With a second worker both break quietly: a share of
    volunteers stop receiving broadcasts, and the abuse limits get N times
    looser. `heroku.yml` pins `--workers 1`, but that pin lives in one deploy
    file the next person to scale up will not read."""

    def test_silent_on_a_single_worker(self, caplog):
        import app.main as main

        caplog.clear()
        with caplog.at_level("WARNING"):
            main._warn_if_multi_worker()
        assert not [r for r in caplog.records if "workers" in r.getMessage()]

    def test_warns_when_web_concurrency_is_raised(self, monkeypatch, caplog):
        import app.main as main

        monkeypatch.setenv("WEB_CONCURRENCY", "4")
        caplog.clear()
        with caplog.at_level("WARNING"):
            main._warn_if_multi_worker()
        messages = [r.getMessage() for r in caplog.records]
        assert any("4 workers" in m for m in messages), messages

    def test_reads_the_uvicorn_variable_too(self, monkeypatch, caplog):
        import app.main as main

        monkeypatch.setenv("UVICORN_WORKERS", "2")
        caplog.clear()
        with caplog.at_level("WARNING"):
            main._warn_if_multi_worker()
        assert any("2 workers" in r.getMessage() for r in caplog.records)

    def test_a_garbage_value_does_not_crash_startup(self, monkeypatch, caplog):
        # A warning must never be the thing that stops the app booting.
        import app.main as main

        monkeypatch.setenv("WEB_CONCURRENCY", "not-a-number")
        with caplog.at_level("WARNING"):
            main._warn_if_multi_worker()
