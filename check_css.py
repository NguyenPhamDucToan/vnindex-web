"""Regression check: every class the JS renders must have a CSS rule.

Written after a scripted CSS edit silently deleted the DuPont, ROIC-vs-WACC and
peer-comparison rules -- the replacement cut from one marker comment to another
and took everything in between with it. The sections still rendered, so no test
failed; they just lost their flex layout and stacked full-width. This catches
that class of loss in a second.

    python check_css.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
# Structural / modifier classes that legitimately carry no rules of their own.
ALLOWED = {"ff-cell", "fin-grid", "sh-left", "ta", "ta-ind", "ta-ma", "vpanel",
           "hidden", "view", "card", "num", "sig", "dim", "gain", "loss", "flat"}

css = (ROOT / "css" / "styles.css").read_text(encoding="utf-8")
defined = set(re.findall(r"\.([a-z][\w-]*)", css))

used = set()
for f in sorted((ROOT / "js").glob("*.js")):
    t = f.read_text(encoding="utf-8")
    for m in re.findall(r'class="([^"$`]+)"', t):
        used.update(w for w in m.split() if w)
    for m in re.findall(r'className = "([^"]+)"', t):
        used.update(m.split())

missing = sorted(c for c in used - defined - ALLOWED)
if missing:
    print("CSS rules missing for classes used in JS:")
    for c in missing:
        print("   -", c)
    sys.exit(1)
print(f"OK — {len(used)} classes used, all styled or allow-listed.")
