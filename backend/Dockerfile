FROM python:3.13-slim

WORKDIR /app

# Triage is a local keyword classifier (app/services/vocab.py) — no model
# weights, no API client, so the image stays small and the build needs no
# GPU or multi-GB download.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY ./app ./app

# Honour $PORT so the same image runs on:
#   * Render (PORT=10000)
#   * HuggingFace Spaces Docker SDK (PORT=7860)
#   * Railway (PORT=...)
#   * Bare uvicorn (PORT=8000 default, kept for backwards-compat)
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
