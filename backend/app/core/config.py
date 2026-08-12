import logging
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

log = logging.getLogger(__name__)

# Resolved from this file, not from the process working directory.
#
# `env_file=".env"` alone is relative to wherever you happened to launch
# from, so `uvicorn` started in backend/ read backend/.env while the same
# command from the repo root read a different file. Split your settings
# across the two — MONGO_URL in one, JWT_SECRET in the other — and half of
# them silently vanish depending on which directory you were standing in.
# JWT_SECRET vanishing is the dangerous one: it falls back to the public
# dev secret below and the app boots anyway.
_BACKEND_DIR = Path(__file__).resolve().parents[2]
_REPO_ROOT = _BACKEND_DIR.parent

# Later entries win, so the search runs general → specific → explicit:
# repo root, then backend/, then whatever the current directory offers
# (which is what a `docker run --env-file` or a one-off shell expects).
_ENV_FILES = (_REPO_ROOT / ".env", _BACKEND_DIR / ".env", Path(".env"))

# The value JWT_SECRET falls back to when the env var is unset. Anyone
# reading this repo knows it, so a deployment still using it can have
# tokens forged for any user and any role.
#
# Padded past 32 bytes deliberately: RFC 7518 §3.2 requires an HMAC key at
# least as long as the hash output (32 bytes for SHA-256), and PyJWT emits
# an InsecureKeyLengthWarning below that. The old 31-byte value tripped it.
DEV_JWT_SECRET = "dev-secret-change-in-production-0"

# Shortest HMAC key accepted for HS256, per RFC 7518 §3.2.
MIN_JWT_SECRET_BYTES = 32


class Settings(BaseSettings):
    MONGO_URL: str = "mongodb://localhost:27017/neighbouraid"
    JWT_SECRET: str = DEV_JWT_SECRET
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 24

    # Set ENVIRONMENT=production on any real deploy. It turns the
    # "you're using the public dev JWT secret" warning below into a
    # hard startup failure, so the mistake surfaces at deploy time
    # rather than as a silent authentication bypass in production.
    ENVIRONMENT: str = "development"

    # Claude powers alert triage (app/services/ai.py). Leave the key empty and
    # the app still works — triage falls back to a keyword heuristic covering
    # English, Hindi and Hinglish, which is what CI and the tests exercise.
    ANTHROPIC_API_KEY: str = ""
    AI_MODEL: str = "claude-opus-5"

    # Alert creation awaits triage, so this is a user-facing latency budget,
    # not a generic network timeout. The SDK's own default is 10 minutes —
    # far too long for a reporter staring at a spinner mid-emergency. On
    # timeout the heuristic answers instead, so a low ceiling is safe.
    AI_TIMEOUT_SECONDS: float = 8.0

    # Optional outbound webhook fired on every new alert. Designed for n8n /
    # Zapier / Make / custom cron runners — point this at a webhook trigger
    # and the automation can fan out to Slack, WhatsApp Business, email,
    # SMS, or anywhere else. Leave empty to disable. Fire-and-forget; the
    # alert creation request never blocks on the webhook.
    ALERT_WEBHOOK_URL: str = ""
    ALERT_WEBHOOK_TIMEOUT_SECONDS: float = 4.0

    # Shared secret for the inbound WhatsApp webhook. Anything posting to
    # /api/inbound/whatsapp must include this in the `X-Inbound-Token`
    # header. Empty string disables the route entirely (default).
    INBOUND_TOKEN: str = ""

    model_config = SettingsConfigDict(env_file=_ENV_FILES, extra="ignore")

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT.strip().lower() in ("production", "prod")


settings = Settings()


if settings.JWT_SECRET == DEV_JWT_SECRET:
    if settings.is_production:
        raise RuntimeError(
            "JWT_SECRET is still the public development default. Set a strong, "
            "random JWT_SECRET (e.g. `python -c \"import secrets; "
            "print(secrets.token_urlsafe(48))\"`) before running in production — "
            "otherwise anyone can mint a token for any user or role."
        )
    log.warning(
        "JWT_SECRET is the public development default — fine locally, but set a "
        "real secret before deploying. ENVIRONMENT=production makes this fatal."
    )
elif len(settings.JWT_SECRET.encode("utf-8")) < MIN_JWT_SECRET_BYTES:
    # A custom-but-short secret is the more dangerous case: it looks
    # configured, so nobody revisits it, while HS256 quietly gets less
    # entropy than the algorithm assumes.
    message = (
        f"JWT_SECRET is only {len(settings.JWT_SECRET.encode('utf-8'))} bytes. "
        f"HS256 needs at least {MIN_JWT_SECRET_BYTES} (RFC 7518 §3.2). Generate "
        'one with: python -c "import secrets; print(secrets.token_urlsafe(48))"'
    )
    if settings.is_production:
        raise RuntimeError(message)
    log.warning(message)
