# -*- coding: utf-8 -*-
"""Find text that is cut off or missing, and legend entries that draw nothing.

Three failure modes the layout audit can't see: an SVG label rendered outside
its plot's clip rectangle (Plotly draws it, the browser hides it), an HTML
label truncated by text-overflow, and a legend entry for a series with no
data -- which reads as "this chart is broken" even though it isn't.

Each financial-report tab is measured while it is open: only one tab's charts
are in the DOM at a time, so a single pass at the end sees just the last one.

    python audit_text.py [TICKER ...]
"""
import sys
from playwright.sync_api import sync_playwright

TICKERS = sys.argv[1:] or ["VCB", "VIB", "VNM", "SSI"]
TABS = ["Kết quả KD", "Cân đối KT", "Dòng tiền & Tỷ số"]

PROBE = r"""() => {
  const root = document.querySelector('#view-stock');
  const cutSvg = [], cutHtml = [], deadLegend = [];

  for (const plot of root.querySelectorAll('.js-plotly-plot')) {
    const pr = plot.getBoundingClientRect();
    if (pr.width < 40) continue;
    const title = (((plot.closest('.qchart') || plot.parentElement)
        .querySelector('.qtitle, .sec-h') || {}).textContent || '?').trim().slice(0, 36);

    for (const t of plot.querySelectorAll('text')) {
      const r = t.getBoundingClientRect();
      if (!r.width) continue;
      const over = Math.max(pr.left - r.left, r.right - pr.right,
                            pr.top - r.top, r.bottom - pr.bottom);
      if (over > 1.5) cutSvg.push([title, t.textContent.trim().slice(0, 24), Math.round(over)]);
    }

    // A legend entry whose series has no plottable point.
    const named = (plot.data || []).filter(tr => tr.showlegend !== false && tr.name);
    for (const tr of named) {
      const arr = tr.y || tr.x || tr.r || tr.values || [];
      if (!arr.length || !arr.some(v => v !== null && v !== undefined && !Number.isNaN(v))) {
        deadLegend.push([title, tr.name]);
      }
    }
  }

  for (const e of root.querySelectorAll('*')) {
    if (e.children.length) continue;
    const st = getComputedStyle(e);
    if (st.textOverflow !== 'ellipsis' && st.overflow !== 'hidden') continue;
    if (e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0) {
      cutHtml.push([(e.className || e.tagName).toString().slice(0, 22),
                    (e.textContent || '').trim().slice(0, 30)]);
    }
  }
  return {cutSvg, cutHtml, deadLegend};
}"""

total = 0
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for tk in TICKERS:
        pg = b.new_page(viewport={"width": 1600, "height": 1200})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(f"http://localhost:8777/?ticker={tk}", wait_until="networkidle", timeout=60000)
        pg.wait_for_timeout(5000)
        for _ in range(18):
            pg.mouse.wheel(0, 800)
            pg.wait_for_timeout(180)
        print(f"\n===== {tk} =====")
        found = False
        for lab in [None] + TABS:
            if lab:
                try:
                    pg.click(f"#view-stock >> text={lab}", timeout=4000)
                    pg.wait_for_timeout(1800)
                except Exception:
                    continue
            r = pg.evaluate(PROBE)
            for kind, rows in (("text cut off", r["cutSvg"]),
                               ("html truncated", r["cutHtml"]),
                               ("legend entry with no data", r["deadLegend"])):
                if rows:
                    found = True
                    total += len(rows)
                    print(f"  [{lab or 'page'}] {kind}: {len(rows)}")
                    for x in rows[:10]:
                        print("     ", x)
        if errs:
            total += len(errs)
            print("  JS ERRORS:", list(dict.fromkeys(errs))[:2])
        if not found and not errs:
            print("  clean")
        pg.close()
    b.close()

print(f"\nTOTAL: {total}")
sys.exit(1 if total else 0)
