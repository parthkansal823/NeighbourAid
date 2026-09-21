"""Measure the classifier→LLM hybrid against the same labelled set.

Run from backend/ with a model configured:

    LLM_MODEL_PATH=../models/gemma-3-1b-it-Q4_K_M.gguf \
        python -m tests.eval_hybrid

Why this exists separately from `eval_triage`: that harness scores the keyword
classifier alone, which is the right baseline but cannot answer "is this model
worth adding". Comparing a model on a handful of hand-picked reports is how
you talk yourself into a regression — the whole point of the 41-case set is
that it also contains the cases a model can get *worse*.

It reproduces the serving path exactly rather than approximating it, so a
number here means the same thing in production:

  * the LLM is consulted only where `urgency_reason == "keyword:default"`,
    i.e. where the classifier matched nothing and is by construction guessing
  * the LLM may only RAISE an urgency, never lower one

Both rules live in `app/services/enrich.py::_maybe_upgrade_urgency`. If they
change there, change them here, or this measures something that never ships.

Prints a comparison table; asserts nothing. The regression guard is
`test_vocab_multilingual.py`.
"""

from __future__ import annotations

import asyncio
import sys
import time

from app.services import llm
from app.services.ai import triage
from tests.eval_dataset import CASES

# Same reason as eval_triage: a Windows console defaults to cp1252 and dies
# partway through the Devanagari/Tamil/Bengali rows.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Lower index = more urgent. Mirrors enrich.py so "may only raise" means the
# same thing in both places.
_RANK = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}

# The gate the serving path uses to decide the classifier is guessing.
_GUESS_REASON = "keyword:default"


async def _hybrid(text: str) -> tuple[str, str, bool, float]:
    """Return (urgency, reason, consulted_llm, llm_ms) for one report."""
    t = triage(text)
    if t.urgency_reason != _GUESS_REASON:
        return t.urgency, t.urgency_reason, False, 0.0

    t0 = time.perf_counter()
    band = await llm.classify(text)
    llm_ms = (time.perf_counter() - t0) * 1000

    if band is None:
        return t.urgency, t.urgency_reason, True, llm_ms
    # One-directional: the model may raise an urgency, never lower it.
    if _RANK.get(band, 99) < _RANK.get(t.urgency, 99):
        return band, "llm:implied", True, llm_ms
    return t.urgency, t.urgency_reason, True, llm_ms


def _score(rows: list[tuple]) -> dict:
    """rows: (case, predicted_urgency). Returns the metrics that matter."""
    graded = [(c, p) for c, p in rows if not c.arguable]
    hits = sum(1 for c, p in graded if p == c.urgency)
    implied = [(c, p) for c, p in graded if c.implied]
    implied_hits = sum(1 for c, p in implied if p == c.urgency)
    # A life-threatening report ranked MEDIUM or below. The number that
    # matters most: it is shown to volunteers beneath less urgent reports.
    sunk = sum(
        1
        for c, p in graded
        if c.urgency == "CRITICAL" and _RANK.get(p, 99) >= _RANK["MEDIUM"]
    )
    under = sum(
        1 for c, p in graded if _RANK.get(p, 99) > _RANK.get(c.urgency, 99)
    )
    return {
        "n": len(graded),
        "hits": hits,
        "pct": round(100 * hits / len(graded)) if graded else 0,
        "implied_hits": implied_hits,
        "implied_n": len(implied),
        "sunk": sunk,
        "under": under,
    }


async def main() -> None:
    enabled = llm.is_enabled()
    print("=" * 74)
    print("HYBRID EVAL — keyword classifier, LLM consulted only on a guess")
    print("=" * 74)
    print(f"  model        : {llm.settings.LLM_MODEL_PATH or '(none configured)'}")
    print(f"  llm enabled  : {enabled}")
    if not enabled:
        print("\n  Set LLM_MODEL_PATH to a GGUF file, or this only re-scores")
        print("  the keyword classifier and the comparison is meaningless.")

    base_rows, hyb_rows = [], []
    consulted = 0
    llm_total_ms = 0.0
    changed: list[tuple] = []

    for case in CASES:
        t = triage(case.text)
        base_rows.append((case, t.urgency))

        urgency, reason, did_call, ms = await _hybrid(case.text)
        hyb_rows.append((case, urgency))
        if did_call:
            consulted += 1
            llm_total_ms += ms
        if urgency != t.urgency:
            changed.append((case, t.urgency, urgency))

    base, hyb = _score(base_rows), _score(hyb_rows)

    print()
    print(f"  {'':<22}{'keyword':>12}{'hybrid':>12}")
    print(f"  {'-' * 46}")
    print(f"  {'overall':<22}{base['hits']}/{base['n']} = {base['pct']}%"
          f"{'':>3}{hyb['hits']}/{hyb['n']} = {hyb['pct']}%")
    print(f"  {'implied danger':<22}{base['implied_hits']}/{base['implied_n']:<10}"
          f"{hyb['implied_hits']}/{hyb['implied_n']}")
    print(f"  {'CRITICAL sunk':<22}{base['sunk']:<12}{hyb['sunk']}")
    print(f"  {'under-ranked':<22}{base['under']:<12}{hyb['under']}")
    print()
    print(f"  LLM consulted on {consulted}/{len(CASES)} reports "
          f"({round(100 * consulted / len(CASES))}%) — the rest cost 0 ms")
    if consulted:
        print(f"  mean LLM latency when consulted: {llm_total_ms / consulted:.0f} ms")

    if changed:
        print()
        print("-" * 74)
        print(f"  CHANGED BY THE MODEL ({len(changed)})")
        print("-" * 74)
        for case, was, now in changed:
            verdict = "correct" if now == case.urgency else f"WRONG (want {case.urgency})"
            print(f"\n  {was} -> {now}  [{verdict}]")
            print(f"    {case.text[:88]}")
    else:
        print("\n  The model changed nothing.")


if __name__ == "__main__":
    asyncio.run(main())
