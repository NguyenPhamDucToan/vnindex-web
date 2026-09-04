# -*- coding: utf-8 -*-
"""Find broken line traces across every chart in the stock view.

Flags, per scatter trace:
  GAP     - nulls sandwiched between real points, so the line breaks mid-chart
  LATE    - the line only starts well after the first x position
  EARLY   - it stops well before the last
  STUB    - fewer than 3 real points, drawn as a floating fragment
  SCALE   - a trace whose values dwarf the others on the same axis, flattening them

    python audit_lines.py [TICKER ...]
"""
import sys
from playwright.sync_api import sync_playwright

TICKERS = sys.argv[1:] or ["VCB", "VNM", "SSI", "HPG", "VIC"]
TABS = ["Kết quả KD", "Cân đối KT", "Dòng tiền & Tỷ số"]

PROBE = """() => {
  const out = [];
  for (const el of document.querySelectorAll('.qtitle')) {
    const plot = el.parentElement.querySelector('.js-plotly-plot');
    if (!plot || !plot.data) continue;
    const traces = [];
    for (const tr of plot.data) {
      if (tr.type !== 'scatter' || !Array.isArray(tr.y)) continue;
      const y = tr.y, n = y.length;
      const idx = [];
      for (let i = 0; i < n; i++) if (y[i] !== null && y[i] !== undefined && !Number.isNaN(y[i])) idx.push(i);
      if (!idx.length) { traces.push({name: tr.name, empty: true}); continue; }
      const first = idx[0], last = idx[idx.length - 1];
      let holes = 0;
      for (let i = first; i <= last; i++)
        if (y[i] === null || y[i] === undefined || Number.isNaN(y[i])) holes++;
      const vals = idx.map(i => Math.abs(y[i])).filter(v => v > 0);
      traces.push({
        name: tr.name, n, pts: idx.length, first, last, holes,
        connect: !!tr.connectgaps, axis: tr.yaxis || 'y',
        max: vals.length ? Math.max(...vals) : 0,
      });
    }
    if (traces.length) out.push({title: el.textContent.trim(), traces});
  }
  return out;
}"""


def check(chart):
    issues = []
    by_axis = {}
    # An actual series ending exactly where its forecast begins is a handoff,
    # not a break: suppress the EARLY/LATE pair for those two.
    handoff = set()
    for a in chart["traces"]:
        for b in chart["traces"]:
            if a is b or a.get("empty") or b.get("empty"):
                continue
            if a["last"] == b["first"] and a["first"] < b["first"] < b["last"]:
                handoff.add(a["name"])
                handoff.add(b["name"])
    for t in chart["traces"]:
        if t.get("empty"):
            issues.append(f"EMPTY  {t['name']}")
            continue
        n = t["n"]
        if t["holes"] and not t["connect"]:
            issues.append(f"GAP    {t['name']} ({t['holes']} holes inside the line)")
        if t["pts"] < 3 and n >= 6:
            issues.append(f"STUB   {t['name']} (only {t['pts']} pts over {n})")
        elif t["first"] > max(1, n * 0.25) and t["name"] not in handoff:
            issues.append(f"LATE   {t['name']} (starts at {t['first']}/{n})")
        if t["last"] < n - 1 - max(1, n * 0.25) and t["name"] not in handoff:
            issues.append(f"EARLY  {t['name']} (ends at {t['last']}/{n})")
        by_axis.setdefault(t["axis"], []).append(t)

    for axis, ts in by_axis.items():
        mx = [t for t in ts if t.get("max")]
        if len(mx) < 2:
            continue
        hi = max(mx, key=lambda t: t["max"])
        lo = min(mx, key=lambda t: t["max"])
        if lo["max"] and hi["max"] / lo["max"] > 8:
            issues.append(f"SCALE  {hi['name']} is {hi['max'] / lo['max']:.0f}x {lo['name']} on {axis}")
    return issues


total = 0
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for t in TICKERS:
        pg = b.new_page(viewport={"width": 1600, "height": 1200})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(f"http://localhost:8777/?ticker={t}", wait_until="networkidle", timeout=60000)
        pg.wait_for_timeout(4000)
        for _ in range(12):
            pg.mouse.wheel(0, 900)
            pg.wait_for_timeout(200)
        print(f"\n===== {t} =====")
        for tab in TABS:
            try:
                pg.click(f"text={tab}", timeout=4000)
                pg.wait_for_timeout(1800)
            except Exception:
                continue
            for chart in pg.evaluate(PROBE):
                iss = check(chart)
                if iss:
                    total += len(iss)
                    print(f"  [{tab}] {chart['title']}")
                    for i in iss:
                        print("      ", i)
        if errs:
            print("  JS ERRORS:", errs[:2])
        pg.close()
    b.close()
print(f"\nTOTAL ISSUES: {total}")
sys.exit(1 if total else 0)
