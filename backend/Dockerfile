FROM python:3.13-slim

WORKDIR /app

# Triage runs on Claude via the Anthropic API — no local model weights, so the
# image stays small and the build needs no GPU or multi-GB download. Set
# ANTHROPIC_API_KEY at runtime to enable it; without a key the app falls back
# to the keyword heuristic in app/services/ai.py and still works.
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
