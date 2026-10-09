FROM python:3.13-slim AS base

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Triage is a local keyword classifier (app/services/vocab.py) — no model
# weights, no API client, so the image stays small and the build needs no
# GPU or multi-GB download.
COPY requirements.txt requirements-llm.txt ./
RUN pip install --no-cache-dir -r requirements.txt

RUN useradd --system --uid 10001 --create-home appuser
COPY --chown=appuser:appuser ./app ./app
COPY --chown=appuser:appuser ./scripts ./scripts

# Local laptop API container. Compose connects cloudflared to port 8000;
# neither the API nor MongoDB publishes a host/LAN port.
ENV PORT=8000
EXPOSE 8000

# Opt-in target for the local, offline two-stage AI path. It adds llama.cpp's
# CPU wheel but deliberately does not copy or download model weights: the AI
# Compose override mounts a local, gitignored models/ directory read-only.
# Keeping this separate preserves the small default image for ordinary runs.
FROM base AS ai
RUN pip install --no-cache-dir -r requirements-llm.txt \
    --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu
USER appuser
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --no-proxy-headers"]

# The final/default target intentionally contains no optional llama runtime or
# model weights. Use the explicit `ai` target only through the AI Compose
# override, never by changing the normal server commands.
FROM base AS runtime
USER appuser
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --no-proxy-headers"]
