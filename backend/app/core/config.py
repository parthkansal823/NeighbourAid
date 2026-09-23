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

    # Defaults to production, so a deploy that sets nothing still gets the
    # strict checks below rather than silently running with the public dev
    # signing key. Local development and the test suite opt out explicitly
    # (see backend/.env and tests/conftest.py) — that way the unsafe
    # configuration is the one you have to ask for.
    ENVIRONMENT: str = "production"

    # Optional outbound webhook fired on every new alert. Designed for n8n /
    # Zapier / Make / custom cron runners — point this at a webhook trigger
    # and the automation can fan out to Slack, WhatsApp Business, email,
    # SMS, or anywhere else. Leave empty to disable. Fire-and-forget; the
    # alert creation request never blocks on the webhook.
    ALERT_WEBHOOK_URL: str = ""
    ALERT_WEBHOOK_TIMEOUT_SECONDS: float = 4.0

    # ---- Optional local LLM (see app/services/llm.py) ----
    #
    # Off unless LLM_MODEL_PATH points at a real GGUF file. The keyword
    # classifier is the floor and must keep working on a 512 MB host, so this
    # is strictly additive: no path, no llama-cpp-python, or a failed load all
    # degrade to today's behaviour.
    LLM_MODEL_PATH: str = ""
    # Generous, because nothing waits on it — inference happens in the
    # background enrichment task after the alert has already been broadcast.
    LLM_TIMEOUT_SECONDS: float = 20.0
    LLM_THREADS: int = 4
    # 0 = CPU only. Raise on a machine with a GPU; llama.cpp offloads that
    # many layers.
    LLM_GPU_LAYERS: int = 0

    # ---- Optional vision model (see app/services/vision.py) ----
    #
    # Separate from LLM_MODEL_PATH on purpose: this is a different model with
    # a different job, and most deployments will want the text one without
    # paying for this. Both paths must be set — a multimodal GGUF is useless
    # without its projector, which is the file that turns pixels into tokens.
    #
    # Off unless both point at real files. When off, photo evidence keeps
    # scoring exactly as it does today.
    LLM_VISION_MODEL_PATH: str = ""
    LLM_VISION_MMPROJ_PATH: str = ""
    # Image encoding dominates the time here, so this is roomier than the
    # text timeout. Nothing waits on it: it runs in background enrichment.
    LLM_VISION_TIMEOUT_SECONDS: float = 45.0

    # Shared secret for the inbound WhatsApp webhook. Anything posting to
    # /api/inbound/whatsapp must include this in the `X-Inbound-Token`
    # header. Empty string disables the route entirely (default).
    INBOUND_TOKEN: str = ""

    # ---- Web push (see app/services/push.py) ----
    #
    # Off unless both keys are set. Generate a pair once, per deployment:
    #
    #     python -c "from py_vapid import Vapid02; v=Vapid02(); v.generate_keys(); \
    #                v.save_key('vapid.pem'); print(v.public_key_urlsafe_base64())"
    #
    # The private key signs the JWT that proves to a push service the message
    # came from this server. It is a credential: treat it like JWT_SECRET.
    # Rotating it invalidates every existing subscription, because browsers
    # bind a subscription to the public key it was created with.
    VAPID_PUBLIC_KEY: str = ""
    VAPID_PRIVATE_KEY: str = ""
    # RFC 8292 requires a contact the push service can reach if this server
    # starts misbehaving. `mailto:` or an https URL.
    VAPID_SUBJECT: str = "mailto:ops@neighbouraid.local"

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


# A MONGO_URL still pointing at localhost is almost always an unset
# environment variable rather than a deliberate choice — nobody runs a
# database on localhost inside a Space, a container, or a PaaS dyno.
#
# Left unchecked it surfaces 30 seconds later as a 40-line PyMongo
# ServerSelectionTimeoutError traceback, which reads like a network fault and
# sends people to check firewalls and Atlas IP allow-lists. Naming it here
# turns that into one line that says which variable to set and where.
_LOCAL_MONGO_HOSTS = ("localhost", "127.0.0.1", "::1", "0.0.0.0")


def _points_at_localhost(url: str) -> bool:
    # Deliberately string-based rather than urlparse: mongodb+srv:// URIs and
    # multi-host seed lists both parse awkwardly, and a false negative here
    # only costs us the nicer error message.
    host_part = url.split("//", 1)[-1].split("/", 1)[0].split("@")[-1]
    return any(host_part.startswith(h) or f"@{h}" in url for h in _LOCAL_MONGO_HOSTS)


if settings.is_production and _points_at_localhost(settings.MONGO_URL):
    raise RuntimeError(
        "MONGO_URL points at localhost, which cannot be right in production - "
        "the environment variable is almost certainly unset. On Hugging Face "
        "Spaces set it under Settings -> Variables and secrets; elsewhere set "
        "it in the host's environment. Expected a MongoDB Atlas connection "
        "string like: mongodb+srv://USER:PASSWORD@cluster.xxxxx.mongodb.net/"
        "neighbouraid?retryWrites=true&w=majority"
    )
