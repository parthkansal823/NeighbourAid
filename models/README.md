# Local model weights

Everything in this directory except this README is **gitignored**. The weights
are downloaded artefacts, not source: a single 7B checkpoint is ~4.7 GB, which
is larger than the rest of this repo combined and over GitHub's 100 MB
per-file hard limit. This file pins exactly what to fetch so the directory is
reproducible from a clone.

Nothing here is required to run NeighbourAid. Triage works with no model at
all — see [`backend/app/services/vocab.py`](../backend/app/services/vocab.py),
which scores 90% on the eval set at 0.04 ms per report using no weights, no
network and no API key. These models are for evaluating whether an LLM can
beat that, and for the capabilities keyword matching cannot cover at all.

## Fetching

```bash
pip install huggingface_hub
python - <<'EOF'
from huggingface_hub import hf_hub_download
hf_hub_download('Qwen/Qwen2.5-3B-Instruct-GGUF',
                'qwen2.5-3b-instruct-q4_k_m.gguf', local_dir='models')
hf_hub_download('bartowski/Qwen2.5-7B-Instruct-GGUF',
                'Qwen2.5-7B-Instruct-Q4_K_M.gguf', local_dir='models')
EOF
```

Downloads resume, so a killed transfer can be re-run — but run it in the
foreground or under a process manager that outlives the shell. A detached
`nohup … &` gets orphaned and leaves multi-gigabyte `.incomplete` files in
`models/.cache/` with nothing to show for it.

## Models

| File | Size | Purpose |
|---|---|---|
| `qwen2.5-3b-instruct-q4_k_m.gguf` | 2.1 GB | Instruction LLM. 4-bit fits a 4 GB GPU entirely. Strongest Indic coverage per parameter of the small open models. |
| `Qwen2.5-7B-Instruct-Q4_K_M.gguf` | 4.7 GB | Same family, larger. Needs partial CPU offload on 4 GB VRAM. |

Runtime is [`llama-cpp-python`](https://github.com/abetlen/llama-cpp-python),
installed from the prebuilt CPU wheel index so no compiler and — importantly —
no `torch` is required:

```bash
pip install llama-cpp-python \
  --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu
```

## Measured results

All on the same 40-case labelled set,
[`backend/tests/eval_dataset.py`](../backend/tests/eval_dataset.py), scored the
same way as `python -m tests.eval_triage`. Anything else compares a model
against a different exam.

| Engine | Overall | Implied danger | CRITICAL sunk | Latency | RAM |
|---|---|---|---|---|---|
| Keyword classifier | **90%** | 5/7 | 0 | **0.04 ms** | **0** |
| multilingual-e5-small (int8 ONNX) | 75% | 5/7 | 3 | 6 ms | 454 MB |
| Qwen2.5-3B-Instruct | 70% | **6/7** | 0 | 1538 ms | 2.1 GB |
| Classifier → LLM hybrid | 88% | **6/7** | 0 | median 0 ms | 2.1 GB |

Read that table before adding a model to the serving path. **The LLM alone
scores worse than the classifier**, largely by promoting HIGH to CRITICAL —
it is following the rubric's "when between two bands, choose the more urgent",
and a feed where everything is CRITICAL carries no signal.

"CRITICAL sunk" counts life-threatening reports ranked MEDIUM or below. It is
the number that matters most: a report below its true urgency is shown to
volunteers beneath genuinely less urgent ones.

The hybrid consults the LLM only where the classifier matched nothing and is
by construction guessing — 22% of reports, hence a 0 ms median.

## Where an LLM is actually worth its weight

Not urgency; that is solved. The gaps with no keyword workaround:

- **Summarisation.** `generate_headline` truncates at 90 characters. A voice
  transcript is rambling, and a volunteer scanning a feed needs a sentence.
- **Cross-language duplicate detection.** `similarity()` is character 4-gram
  overlap, so "fire near Gate 3" and "aag gate 3 ke paas" do not match — the
  exact case that matters when several people report one incident.
- **Images**, which need a vision model and are not covered here at all.
