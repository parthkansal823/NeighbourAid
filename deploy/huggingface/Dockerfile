# Hugging Face Spaces (Docker SDK) image for the NeighbourAid API.
#
# Kept separate from backend/Dockerfile because Spaces imposes three things a
# generic image should not hard-code: a fixed port (7860), a non-root UID
# 1000, and a read-only filesystem outside /tmp.
#
# Build context is the repo root — see push-space.sh, which assembles the
# Space repo — so paths below are repo-relative.

FROM python:3.13-slim

# Spaces runs containers as UID 1000. Files copied in as root are readable
# but HOME is not writable, which breaks anything that wants a cache dir
# (pip, httpx, matplotlib). Creating the user up front and owning /app is
# simpler than chasing each library's cache path later.
RUN useradd -m -u 1000 user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Dependencies first, as their own layer: application code changes on every
# push, requirements almost never do, so this keeps rebuilds to seconds.
COPY --chown=user requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

COPY --chown=user ./app ./app

USER user

# Spaces routes external traffic to this port and ignores $PORT — it must
# match `app_port` in the Space README's frontmatter.
EXPOSE 7860

# One worker, deliberately, and this is not a resource decision.
# app/services/websocket.py holds connected volunteers in an in-process
# dict, so a second worker would own a second, invisible half of the
# volunteer pool and an alert would only reach whoever shared its process.
# Moving that registry behind Redis pub/sub is what unlocks more workers.
#
# --proxy-headers so request.client.host is the real caller behind the
# Spaces reverse proxy; without it every request appears to come from the
# proxy and the per-IP rate limiters in app/services/ratelimit.py would
# throttle all users as if they were one.
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "7860", \
     "--workers", "1", \
     "--proxy-headers", \
     "--forwarded-allow-ips", "*"]
