import logging

from pydantic_settings import BaseSettings, SettingsConfigDict

log = logging.getLogger(__name__)

# The value JWT_SECRET falls back to when the env var is unset. Anyone
# reading this repo knows it, so a deployment still using it can have
# tokens forged for any user and any role.
DEV_JWT_SECRET = "dev-secret-change-in-production"


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

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

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
