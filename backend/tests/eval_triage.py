"""Measure triage accuracy against the labelled set in eval_dataset.py.

Run from backend/:

    python -m tests.eval_triage

This is a measurement tool, not a pass/fail test — it prints a report rather
than asserting, because the useful output is *where* it fails, not whether.
The regression guard lives in test_vocab_multilingual.py.

Read the "implied" row first. That is the class of report where the danger is
described but never named, and it is the honest case for adding a model: no
amount of vocabulary fixes it, because there is no word to match.
"""

from __future__ import annotations

import sys
import time
from collections import Counter

from app.services.ai import triage
from tests.eval_dataset import CASES, Case

# The report prints Devanagari, Tamil, Bengali and Gurmukhi. A Windows
# console defaults to cp1252 and raises UnicodeEncodeError partway through,
# which truncates the report exactly where the non-English failures are.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BANDS = ("CRITICAL", "HIGH", "MEDIUM", "LOW")
# Distance between bands, used to separate "one band off" from "badly wrong".
RANK = {b: i for i, b in enumerate(BANDS)}


def _classify(case: Case) -> str:
    return triage(case.text).urgency


def main() -> int:
    rows = []
    t0 = time.perf_counter()
    for case in CASES:
        got = _classify(case)
        rows.append((case, got, got == case.urgency))
    elapsed_ms = (time.perf_counter() - t0) * 1000

    counted = [(c, g, ok) for c, g, ok in rows if not c.arguable]
    correct = sum(1 for _, _, ok in counted if ok)
    total = len(counted)

    print("=" * 74)
    print("TRIAGE ACCURACY - keyword classifier (app/services/vocab.py)")
    print("=" * 74)
    print(f"  overall      : {correct}/{total} = {correct / total:.0%}")
    print(f"  latency      : {elapsed_ms / len(rows):.3f} ms per report")
    print(f"  excluded     : {len(rows) - total} arguable case(s)")
    print()

    # Where it fails matters more than how often. A report that should be
    # CRITICAL and lands on LOW is a different kind of failure from one that
    # lands on HIGH, and only the first one gets somebody hurt.
    print("  By whether the danger is STATED or IMPLIED")
    for label, subset in (
        ("stated ", [r for r in counted if not r[0].implied]),
        ("implied", [r for r in counted if r[0].implied]),
    ):
        if not subset:
            continue
        ok = sum(1 for _, _, k in subset if k)
        print(f"    {label} : {ok}/{len(subset)} = {ok / len(subset):.0%}")
    print()

    print("  By true urgency")
    for band in BANDS:
        subset = [r for r in counted if r[0].urgency == band]
        if not subset:
            continue
        ok = sum(1 for _, _, k in subset if k)
        print(f"    {band:9}: {ok}/{len(subset)}")
    print()

    print("  By language")
    langs = Counter(c.lang for c, _, _ in counted)
    for lang in sorted(langs):
        subset = [r for r in counted if r[0].lang == lang]
        ok = sum(1 for _, _, k in subset if k)
        print(f"    {lang:8}: {ok}/{len(subset)}")
    print()

    misses = [(c, g) for c, g, ok in rows if not ok]
    if misses:
        print("-" * 74)
        print(f"  MISSES ({len(misses)})")
        print("-" * 74)
        # Under-ranking first: those are the ones that cost somebody help.
        misses.sort(key=lambda m: RANK[m[1]] - RANK[m[0].urgency], reverse=True)
        for case, got in misses:
            drift = RANK[got] - RANK[case.urgency]
            direction = "UNDER-ranked" if drift > 0 else "over-ranked"
            flag = " [implied]" if case.implied else ""
            arg = " [arguable]" if case.arguable else ""
            print(f"\n  {case.lang} expected {case.urgency}, got {got} "
                  f"({direction} by {abs(drift)}){flag}{arg}")
            print(f"    {case.text[:88]}")
            if case.note:
                print(f"    note: {case.note}")

    under = sum(1 for c, g, ok in rows
                if not ok and not c.arguable and RANK[g] > RANK[c.urgency])
    print()
    print("=" * 74)
    print(f"  UNDER-ranked (dangerous direction): {under}")
    print("  A report ranked below its true urgency is shown to volunteers")
    print("  beneath genuinely less urgent ones. That is the failure that")
    print("  costs someone help, and it is the number to drive to zero.")
    print("=" * 74)
    return 0


if __name__ == "__main__":
    sys.exit(main())
