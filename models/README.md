# Optional local models

Triage and alert delivery work without model weights or an API key. Optional
models run in the laptop backend, **not in the Android APK**. File size is not
runtime RAM. This repository does not implement phone-local inference or ship
model weights to a phone.

Weights in this directory are gitignored. Download them explicitly; neither
the application nor its default Docker image downloads them automatically.

## Checkpoints

| File | Approximate weight size | Use |
|---|---|---|
| `gemma-3-1b-it-Q4_K_M.gguf` | 769 MiB | Text model used in the current local evaluation |
| `SmolVLM-500M-Instruct-Q8_0.gguf` + `mmproj-SmolVLM-500M-Instruct-Q8_0.gguf` | 520 MiB combined | Optional photo-caption model and projector |
| `qwen2.5-3b-instruct-q4_k_m.gguf` | 2 GiB | Default stronger second-stage verifier beside Gemma 1B |
| `Qwen2.5-7B-Instruct-Q4_K_M.gguf` | 4.4 GiB | Higher-RAM verifier override; measure the laptop first |

The text checkpoint is available from
[ggml-org on Hugging Face](https://huggingface.co/ggml-org/gemma-3-1b-it-GGUF).
Check the model's licence before distributing its weights. The application
does not require redistributing weights with either its source or APK.

## Enable and evaluate on Windows

From the repository root, install the optional runtime into the backend venv:

```powershell
.\backend\venv\Scripts\python.exe -m pip install -r backend\requirements-llm.txt --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu
```

With the text weights downloaded, evaluate from `backend/`:

```powershell
$env:LLM_MODEL_PATH = '../models/gemma-3-1b-it-Q4_K_M.gguf'
$env:NA_DISABLE_AI_MODEL = '0'
.\venv\Scripts\python.exe -m tests.eval_hybrid
```

These variables apply to that terminal only. To enable server-side review,
configure `LLM_MODEL_PATH` (Gemma) and, optionally, a separate
`LLM_VERIFIER_MODEL_PATH` (Qwen), then restart the backend. Paths must exist
inside the process/container serving requests. The first model has a 20-second
default timeout, 2048-token context (1024–8192), four threads and no GPU
layers by default. The verifier defaults to 45 seconds, 4096 tokens
(1024–16384), four threads and no GPU layers. Both use `llama.cpp` locally.

For photo captions also configure `LLM_VISION_MODEL_PATH` and
`LLM_VISION_MMPROJ_PATH`. A report exceeding a context budget retains the
fallback rather than silently dropping its ending. `NA_DISABLE_AI_MODEL=1`
disables the first-pass, verifier and vision models together.

## Offline Docker two-stage review

The normal laptop stack intentionally stays lightweight: its default image has
no optional llama runtime and no model mount. To opt in, download the GGUF
files yourself under the gitignored `models/` directory, then copy the model
configuration once:

```powershell
Copy-Item deploy/laptop/ai.env.example deploy/laptop/ai.env
```

`ai.env` uses container paths such as `/models/gemma-3-1b-it-Q4_K_M.gguf` and
`/models/qwen2.5-3b-instruct-q4_k_m.gguf`; edit only those local filenames or
the documented performance limits. It is ignored and must not contain a JWT,
MongoDB credential, tunnel address, edge secret or model-provider key.

After completing the ordinary one-time `npm run server:setup`, use the opt-in
commands from `frontend/`:

```powershell
npm run server:ai:connect
npm run server:ai:test
# Later:
npm run server:ai:stop
```

They layer `deploy/laptop/docker-compose.ai.yml` over the normal stack, build
the optional `ai` image target, and bind-mount `../../models` at `/models`
read-only. They never copy weights into the image, download weights, or call a
cloud inference service. The default `server:*` commands intentionally return
to the no-model image; use the matching `server:ai:*` commands while running
the model-enabled stack. Qwen 3B is the sane default; switch the verifier path
to the listed 7B file only after measuring memory and latency on that laptop.

## Two-stage review and phone-model boundary

The backend is authoritative. After a report is saved, a configured Gemma
first pass may review ordinary MEDIUM/LOW reports. Gemma approval publishes
the report immediately while Qwen continues in the background. If Gemma is
uncertain, the report is briefly held for Qwen; Qwen can publish it as reviewed
or uncertain, and can restrict only clearly spam-like, non-emergency content.
Critical and high-urgency reports are broadcast immediately as provisional. A
missing model, load error, timeout, saturated inference slot or malformed
response falls open to the deterministic publication path rather than silently
suppressing a possible emergency. The stronger model can produce an automated
review state; it is not proof that an incident is real, a medical judgment or
a replacement for corroboration and human escalation.

A future phone-local Gemma could improve UX or prefill an offline draft, but
it is **not implemented** here. A browser or APK must never be allowed to
approve, restrict, resolve, hide or elevate an alert based on a client model
result. The server re-runs its own rules and owns visibility decisions.

## Current local evaluation — 6 October 2026

Run with actual Gemma 3 1B weights, current prompt and JSON schema, using
[`eval_hybrid`](../backend/tests/eval_hybrid.py).
There are 41 development cases; one arguable case is excluded from accuracy.

| Engine | Correct / graded | Implied danger | CRITICAL ranked MEDIUM or LOW |
|---|---|---|---|
| Keyword classifier | 38/40 (95%) | 5/7 | 0 |
| Classifier + optional Gemma | 39/40 (97.5%) | 6/7 | 0 |

The model was consulted on 8/41 reports. This small development set is **not**
training, clinical validation, calibration for a deployment, or proof of
real-world accuracy. One implied-danger case remains missed. Inference takes
seconds and varies with CPU, context and other running tasks. RAM was not
measured in this run. Add a second-model evaluation only with a held-out,
privacy-reviewed data set and measure false restrictions as well as agreement;
never fine-tune on identifiable emergency reports without explicit lawful
consent, retention controls, access controls and a human safety review.

## Safety boundaries

- All inference happens after an alert is saved. With the optional review
  models configured, a deterministic CRITICAL/HIGH alert is broadcast as
  provisional immediately; a MEDIUM/LOW report may briefly wait for the
  server-side first review, and any model failure falls open to normal
  deterministic visibility.
- The model can only raise urgency where the deterministic classifier matched
  nothing. It cannot lower urgency or replace a known CRITICAL result.
- Generation uses [JSON Schema constraints](https://llama-cpp-python.readthedocs.io/en/stable/#json-and-json-schema-mode),
  followed by strict output validation. Model output is still untrusted.
- Headline checks reject new incident concepts, script/language drift and
  invented numeric values. Negated descriptions accept only literal excerpts
  retaining their negation cues; otherwise the original headline stays.
  These checks cannot prove every name, spelled-out count or semantic detail.
- Photo captions do not authenticate an image. Negated, uncertain and mixed
  captions are inconclusive. A static photo cannot disprove gas leaks,
  electrical outages, water-supply faults or medical symptoms. A matching
  caption never increases a score; a supported clear mismatch can only
  subtract the capped photo penalty. Violence is not judged.
- A timeout retains the inference slot until native work actually finishes;
  bursts do not build an unbounded model queue.
- A verifier result is an automated safety-review signal, not fact checking.
  Keep community corroboration, source checks and a human incident process for
  real-world verification.

Regression tests need no weights:

```powershell
cd backend
.\venv\Scripts\python.exe -m pytest tests/test_ai_evidence_guards.py tests/test_ai_runtime_reliability.py tests/test_enrich_guards.py -q
```

Cross-language duplicates use deterministic incident concepts plus text
similarity, not an embedding model or vector database.
