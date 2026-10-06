"""Entry point for a Hugging Face Space running on the **Gradio** SDK.

Why this file exists: the Docker SDK is a paid feature on some Hugging Face
accounts, while Gradio and Static are free. A Gradio Space simply runs
`app.py` with Python and proxies port 7860 — it never checks that what you
started is actually Gradio. So this mounts a tiny Gradio page for the Space's
landing view and serves the real FastAPI app underneath it.

Nothing about the backend changes. `app.main:app` is imported unmodified; the
routes, WebSocket endpoint and lifespan all behave exactly as they do under
uvicorn locally or in the Docker image.

Layout expected in the Space repo (see push-gradio-space.sh):

    app.py              <- this file
    requirements.txt    <- backend requirements + gradio
    app/                <- the backend package
    README.md           <- Space frontmatter, sdk: gradio
"""

import os

import gradio as gr
import uvicorn

from app.main import app as api

# A minimal landing page. Hugging Face renders the Space in an iframe, and a
# Space that shows a blank screen or a raw JSON body looks broken to anyone
# who opens it — including you, six weeks from now, wondering if it is down.
with gr.Blocks(title="NeighbourAid API", analytics_enabled=False) as landing:
    gr.Markdown(
        """
        # NeighbourAid API

        Backend for a hyperlocal crisis-response network for India.
        This Space serves the API only — the web app is deployed separately.

        | Path | Purpose |
        |---|---|
        | `/docs` | Interactive API documentation |
        | `/health` | Liveness — checks nothing, never fails while the process is up |
        | `/health/ready` | Readiness — pings MongoDB, reports the live triage engine |
        | `/ws/volunteer` | WebSocket feed for volunteers |

        Point an uptime monitor at `/health/ready` every 5 minutes to keep the
        Space awake and the database connection warm.
        """
    )

# Gradio is mounted at /ui, NOT at /, so it cannot shadow the API routes.
# Mounting at / would make Gradio's catch-all swallow requests to /api/...
# and the failure would look like a routing bug in FastAPI.
app = gr.mount_gradio_app(api, landing, path="/ui")


if __name__ == "__main__":
    # 7860 is fixed, and deliberately NOT read from $PORT.
    #
    # Spaces routes external traffic to the `app_port` declared in the Space
    # README (7860) no matter what the environment says. Honouring $PORT here
    # meant that any base image or shell that happened to export PORT — a
    # very common thing to do — silently bound the wrong port and the Space
    # came up completely unreachable, with healthy-looking logs. Override
    # only via NEIGHBOURAID_PORT, which nothing else sets.
    #
    # One worker, deliberately: app/services/websocket.py holds connected
    # volunteers in an in-process dict, so a second worker would own an
    # invisible half of the pool and alerts would reach only whoever shared
    # its process.
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(os.getenv("NEIGHBOURAID_PORT", "7860")),
        workers=1,
        proxy_headers=True,
        forwarded_allow_ips="*",
    )
