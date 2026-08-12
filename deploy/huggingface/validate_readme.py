"""Validate a Hugging Face Space README's YAML frontmatter before pushing.

A Space rejects an invalid frontmatter with a server-side `pre-receive hook
declined` and a link to the model-card docs. It does not say which field was
wrong. That is a slow, opaque loop — force-push, get rejected, guess — so
this runs the same checks locally in a fraction of a second.

The rejection that prompted this was `colorFrom: orange`. Orange is not in
Hugging Face's allowed palette, and nothing in the error said so.

Run directly, or via the push scripts which call it automatically:
    python deploy/huggingface/validate_readme.py deploy/huggingface/gradio/README.md
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# Hugging Face accepts only these for colorFrom / colorTo. Not a style
# preference — anything else is a hard push rejection.
VALID_COLORS = {"red", "yellow", "green", "blue", "indigo", "purple", "pink", "gray"}

VALID_SDKS = {"gradio", "streamlit", "docker", "static"}

# Gradio 5.x pins starlette<1.0 and pydantic<2.12. This backend needs
# starlette>=1.3.1 (a CVE floor, see requirements.txt) and pydantic>=2.12, so
# a 5.x Space fails to build with ResolutionImpossible. Gradio 6 widened both
# ranges. Raise this floor, never lower it.
MIN_GRADIO_MAJOR = 6

# Enforced by the Hub; a longer value is rejected rather than truncated.
MAX_SHORT_DESCRIPTION = 60


def parse_frontmatter(text: str) -> dict[str, str]:
    match = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n", text, re.DOTALL)
    if not match:
        raise ValueError(
            "no YAML frontmatter found. The Space README must OPEN with a '---' "
            "line — even a blank line or a BOM before it breaks detection."
        )
    fields: dict[str, str] = {}
    for line in match.group(1).splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            raise ValueError(f"frontmatter line is not 'key: value': {line!r}")
        key, _, value = line.partition(":")
        fields[key.strip()] = value.strip()
    return fields


def validate(path: Path) -> list[str]:
    errors: list[str] = []
    text = path.read_text(encoding="utf-8")

    if text.startswith("﻿"):
        errors.append(
            "file starts with a UTF-8 BOM, which hides the opening '---' from "
            "the Hub's parser. Save as UTF-8 without BOM."
        )

    try:
        fm = parse_frontmatter(text)
    except ValueError as exc:
        return [str(exc)]

    for field in ("title", "sdk", "colorFrom", "colorTo"):
        if field not in fm:
            errors.append(f"missing required field: {field}")

    for field in ("colorFrom", "colorTo"):
        value = fm.get(field)
        if value and value not in VALID_COLORS:
            errors.append(
                f"{field}: {value!r} is not a valid Hugging Face colour. "
                f"Allowed: {', '.join(sorted(VALID_COLORS))}"
            )

    sdk = fm.get("sdk")
    if sdk and sdk not in VALID_SDKS:
        errors.append(f"sdk: {sdk!r} is not one of {', '.join(sorted(VALID_SDKS))}")

    if sdk == "gradio":
        if "app_file" not in fm:
            errors.append("sdk is gradio but app_file is not set")
        version = fm.get("sdk_version", "")
        if not version:
            errors.append("sdk is gradio but sdk_version is not set — see MIN_GRADIO_MAJOR")
        elif not re.fullmatch(r"\d+\.\d+(\.\d+)?", version):
            errors.append(f"sdk_version: {version!r} is not a plain version number")
        else:
            major = int(version.split(".")[0])
            if major < MIN_GRADIO_MAJOR:
                errors.append(
                    f"sdk_version {version} is Gradio {major}.x, which pins "
                    "starlette<1.0 and pydantic<2.12. This backend requires "
                    "starlette>=1.3.1 (a CVE floor) and pydantic>=2.12, so the "
                    "build dies with ResolutionImpossible. Use "
                    f"{MIN_GRADIO_MAJOR}.x or newer."
                )
    elif sdk == "docker":
        if "app_port" not in fm:
            errors.append("sdk is docker but app_port is not set")

    desc = fm.get("short_description", "")
    if len(desc) > MAX_SHORT_DESCRIPTION:
        errors.append(
            f"short_description is {len(desc)} characters; the Hub caps it at "
            f"{MAX_SHORT_DESCRIPTION} and rejects longer values."
        )

    if fm.get("pinned") not in (None, "true", "false"):
        errors.append(f"pinned must be true or false, got {fm['pinned']!r}")

    return errors


def main() -> int:
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} <path-to-space-README.md>", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    if not path.exists():
        print(f"no such file: {path}", file=sys.stderr)
        return 2

    errors = validate(path)
    if errors:
        print(f"Space README frontmatter is invalid ({path}):", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        print(
            "\nPushing this would be rejected by the Hub with an opaque "
            "'pre-receive hook declined'.",
            file=sys.stderr,
        )
        return 1

    print(f"Space README frontmatter OK: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
