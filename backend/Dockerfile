FROM python:3.13-slim

WORKDIR /app

# The local AI model is opt-in, and the default is *off*.
#
# This used to be inverted (SKIP_MODEL_DOWNLOAD=0 by default), so every build
# pulled ~2.5 GB of torch wheels plus a 1.6 GB model — enough to blow the disk
# and build timeout on the free tiers this image targets — for a feature the
# app degrades from cleanly. Build with `--build-arg WITH_AI=1` when you
# actually want local inference.
ARG WITH_AI=0

COPY requirements.txt requirements-ai.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Install the model stack and bake the weights into the image, so runtime
# never needs network for a request. Both steps are skipped by default.
RUN if [ "$WITH_AI" = "1" ]; then \
      pip install --no-cache-dir -r requirements-ai.txt && \
      python -c "from transformers import pipeline; pipeline('zero-shot-classification', model='facebook/bart-large-mnli')"; \
    else \
      echo "Building without the local AI model (WITH_AI=$WITH_AI) — app/services/ai.py uses its keyword heuristic."; \
    fi

# No NA_DISABLE_AI_MODEL default is baked in on purpose. When the model is
# absent, app/services/ai.py catches the ImportError on first triage, logs it
# once and latches to the heuristic — so the flag is an optimisation, not a
# requirement, and hard-coding it here would silently override an operator
# who set it themselves.

COPY ./app ./app

# Honour $PORT so the same image runs on:
#   * Render (PORT=10000)
#   * HuggingFace Spaces Docker SDK (PORT=7860)
#   * Railway (PORT=...)
#   * Bare uvicorn (PORT=8000 default, kept for backwards-compat)
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
