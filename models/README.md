# Optional local models

Triage works without model weights or an API key. Optional models run on the
laptop backend, **not in the Android APK**. File size is not runtime RAM.
This repository does not implement phone-local inference.

Weights in this directory are gitignored. Download them explicitly; neither
the application nor its default Docker image downloads them automatically.

## Checkpoints

| File | Approximate weight size | Use |
|---|---|---|
| `gemma-3-1b-it-Q4_K_M.gguf` | 769 MiB | Text model used in the current local evaluation |
| `SmolVLM-500M-Instruct-Q8_0.gguf` + `mmproj-SmolVLM-500M-Instruct-Q8_0.gguf` | 520 MiB combined | Optional photo-caption model and projector |
| `qwen2.5-3b-instruct-q4_k_m.gguf` | 2 GiB | Older comparison checkpoint; not required |
| `Qwen2.5-7B-Instruct-Q4_K_M.gguf` | 4.4 GiB | Larger comparison checkpoint; not required |

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

These variables apply to that terminal only. To enable the backend, configure
`LLM_MODEL_PATH` and restart it. Paths must exist inside the process/container
serving requests. The default Docker image does **not** install the optional
runtime or contain weights; setting a host path alone will not enable a model
inside that container.

For photo captions also configure `LLM_VISION_MODEL_PATH` and
`LLM_VISION_MMPROJ_PATH`. `LLM_CONTEXT_TOKENS` defaults to 2048 (allowed
1024–8192), `LLM_THREADS` to 4 and `LLM_GPU_LAYERS` to 0. A report exceeding
the context budget retains the fallback rather than silently dropping its
ending. `NA_DISABLE_AI_MODEL=1` disables text and vision together.

## Current local evaluation — 6 October 2026

Run with actual Gemma 3 1B weights, current prompt and JSON schema, using
[`eval_hybrid`](../backend/tests/eval_hybrid.py).
There are 41 development cases; one arguable case is excluded from accuracy.

| Engine | Correct / graded | Implied danger | CRITICAL ranked MEDIUM or LOW |
|---|---|---|---|
| Keyword classifier | 38/40 (95%) | 5/7 | 0 |
| Classifier + optional Gemma | 39/40 (97.5%) | 6/7 | 0 |

The model was consulted on 8/41 reports. This small development set is **not**
clinical validation or proof of real-world accuracy. One implied-danger case
remains missed. Inference takes seconds and varies with CPU, context and
other running tasks. RAM was not measured in this run.

## Safety boundaries

- All inference happens after an alert is saved and broadcast.
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

Regression tests need no weights:

```powershell
cd backend
.\venv\Scripts\python.exe -m pytest tests/test_ai_evidence_guards.py tests/test_ai_runtime_reliability.py tests/test_enrich_guards.py -q
```

Cross-language duplicates use deterministic incident concepts plus text
similarity, not an embedding model or vector database.
