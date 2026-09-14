# -*- coding: utf-8 -*-
"""Check each scorecard tile's colour thresholds against its own legend.

Every tile states its bands twice: once as the numbers ratingColor() uses, and
once as the "g / w / b" text in the tooltip. Sector work drifts them apart --
the broker capital tile was copied from the bank block, its colour thresholds
changed to 40%/25%, and the legend left saying 9%/6%, which every one of the 20
brokers passes. Nothing else can see that: the layout audit finds clipped text,
not text that disagrees with the colour beside it.

Tiles whose colour is not a literal ratingColor(value, good, warn) call are
skipped -- sector-banded tiles (mR) resolve their thresholds at runtime and
their legends are generated from the same table by mBand().

    python check_tips.py          # exits 1 if any tile disagrees
"""
import re
import pathlib
import sys

src = pathlib.Path("js/app.js").read_text(encoding="utf-8")

TILE = re.compile(
    r'\{ label: ([^\n]*?), value: [^\n]*?color: ([^,]*?R\(([^)]*)\))[^\n]*?tip: \{([^\n]*?)\} \},')


def legend_values(text: str) -> list[float]:
    """Numbers in a legend string, as fractions when written as a percentage."""
    out = []
    for value, unit in re.findall(r'(\d+(?:[.,]\d+)?)\s*(%|x|)', text):
        number = float(value.replace(",", "."))
        out.append(number / 100 if unit == "%" else number)
    return out


def main() -> int:
    checked = mismatched = 0
    for match in TILE.finditer(src):
        label, args, tip = match.group(1), match.group(3), match.group(4)
        line = src[:match.start()].count("\n") + 1

        thresholds = []
        for arg in [a.strip() for a in args.split(",")][1:3]:
            try:
                thresholds.append(float(arg))
            except ValueError:
                thresholds.append(None)
        if len(thresholds) < 2 or None in thresholds:
            continue        # threshold comes from a variable or a sector band

        good_text = re.search(r'g: "([^"]*)"', tip)
        bad_text = re.search(r'b: "([^"]*)"', tip)
        if not good_text or not bad_text:
            continue        # tile carries no legend to disagree with

        checked += 1
        good, bad = thresholds
        good_ok = any(abs(v - good) < 1e-9 for v in legend_values(good_text.group(1))) \
            or not legend_values(good_text.group(1))
        bad_ok = any(abs(v - bad) < 1e-9 for v in legend_values(bad_text.group(1))) \
            or not legend_values(bad_text.group(1))
        if not (good_ok and bad_ok):
            mismatched += 1
            print(f"  L{line} {label[:50]}")
            print(f'      mau: {good} / {bad}   chu thich: g="{good_text.group(1)}" '
                  f'b="{bad_text.group(1)}"')

    if mismatched:
        print(f"\n{mismatched}/{checked} tile co chu thich lech voi nguong mau.")
        return 1
    print(f"OK — {checked} tile, chu thich khop nguong mau.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
