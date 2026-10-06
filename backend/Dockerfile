FROM python:3.13-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Triage is a local keyword classifier (app/services/vocab.py) — no model
# weights, no API client, so the image stays small and the build needs no
# GPU or multi-GB download.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

RUN useradd --system --uid 10001 --create-home appuser
COPY --chown=appuser:appuser ./app ./app
USER appuser

# Honour $PORT so the same image runs on:
#   * Render (PORT=10000)
#   * HuggingFace Spaces Docker SDK (PORT=7860)
#   * Railway (PORT=...)
#   * Bare uvicorn (PORT=8000 default, kept for backwards-compat)
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --no-proxy-headers"]
