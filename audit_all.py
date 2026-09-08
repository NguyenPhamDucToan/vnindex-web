# -*- coding: utf-8 -*-
"""Whole-app audit: walk every view (and every sub-tab inside it) and report
anything that reads as broken -- JS errors, empty or zero-size plots, junk text
(undefined/NaN/[object Object]), horizontal page scroll, and all-dash rows.

    python audit_all.py [WIDTH ...]
"""
import os
import sys
from playwright.sync_api import sync_playwright

# Override to audit a deployed site:  BASE=https://... python audit_all.py
BASE = os.environ.get("BASE", "http://localhost:8777").rstrip("/")

WIDTHS = [int(w) for w in (sys.argv[1:] or [1600, 390])]
VIEWS = ["stock", "screen", "compare", "sector", "market"]

PROBE = r"""(viewId) => {
  const root = document.querySelector('#view-' + viewId);
  if (!root) return {missing: true};
  const bad = [];
  for (const p of root.querySelectorAll('.js-plotly-plot')) {
    const r = p.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;      // hidden tab, not broken
    const data = p.data || [];
    // A histogram carries only x, and an indicator/gauge only a scalar value;
    // counting y alone reported both as empty when they render fine.
    const pts = data.reduce((a, tr) => {
      if (tr.type === 'indicator') return a + (tr.value != null ? 1 : 0);
      const arr = tr.y || tr.r || tr.values || tr.labels || tr.x || [];
      return a + arr.filter(v => v != null).length;
    }, 0);
    const t = p.querySelector('.gtitle');
    const title = ((t ? t.textContent : '') ||
      ((p.closest('.qchart') || p.parentElement).querySelector('.qtitle, .sec-h') || {}).textContent ||
      '?').replace(/\s+/g, ' ').trim().slice(0, 46);
    if (!data.length || pts === 0) bad.push(['EMPTY', title]);
    else if (r.width < 80 || r.height < 80) bad.push(['TINY ' + Math.round(r.width) + 'x' + Math.round(r.height), title]);
  }
  const junk = [...(root.innerText || '').matchAll(/undefined|NaN|\[object Object\]|Infinity/g)]
    .map(m => m[0]);
  // A row of nothing but dashes means every cell failed to resolve.
  let dashRows = 0;
  for (const tr of root.querySelectorAll('table tbody tr')) {
    const tds = [...tr.querySelectorAll('td')];
    if (tds.length > 2 && tds.every(td => ['—', '-', ''].includes(td.textContent.trim()))) dashRows++;
  }
  // Containers that overflow without asking to scroll.
  let clipped = 0;
  const clippedList = [];
  for (const e of root.querySelectorAll('div,table,section')) {
    // Plotly's own inner divs always report a wider scrollWidth than they
    // display; they are not layout defects.
    if (e.closest('.js-plotly-plot')) continue;
    const st = getComputedStyle(e);
    if (st.overflowX === 'auto' || st.overflowX === 'scroll') continue;
    // Plotly sizes its <svg> to the container's fractional width (230.297 in a
    // 230px box), and SVG text boxes inflate scrollWidth further. That shows up
    // as a few pixels of phantom overflow with nothing actually cut, so only
    // report a gap wide enough to be visible.
    if (e.scrollWidth > e.clientWidth + 8 && e.clientWidth > 0) {
      clipped++;
      if (clippedList.length < 4) clippedList.push(e.className || e.tagName);
    }
  }
  return {bad, junk: [...new Set(junk)], dashRows, clipped, clippedList};
}"""

total = 0
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for w in WIDTHS:
        print(f"\n===== {w}px =====")
        pg = b.new_page(viewport={"width": w, "height": 1200})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(f"{BASE}/?ticker=VCB", wait_until="networkidle", timeout=90000)
        pg.wait_for_timeout(4000)
        for v in VIEWS:
            try:
                pg.click(f".nav-item[data-view='{v}']", timeout=8000)
            except Exception as e:
                print(f"  {v}: nav click failed: {e}")
                continue
            pg.wait_for_timeout(6000)
            for _ in range(18):
                pg.mouse.wheel(0, 800)
                pg.wait_for_timeout(200)
            # Open every sub-tab within the view before judging it.
            subs = pg.evaluate(f"""() => [...document.querySelectorAll(
                '#view-{v} .range-btn, #view-{v} .sig-c')]
                .map(e => e.textContent.trim()).filter(t => t && t.length < 40)""")
            for lab in subs[:14]:
                try:
                    pg.click(f"#view-{v} >> text={lab}", timeout=3000)
                    pg.wait_for_timeout(1400)
                except Exception:
                    continue
            r = pg.evaluate(PROBE, v)
            issues = []
            for kind, title in r.get("bad", []):
                issues.append(f"{kind}: {title}")
            if r.get("junk"):
                issues.append(f"TEXT JUNK: {r['junk']}")
            if r.get("dashRows"):
                issues.append(f"{r['dashRows']} all-dash table rows")
            if r.get("clipped"):
                issues.append(f"{r['clipped']} clipped containers: {r.get('clippedList')}")
            total += len(issues)
            print(f"  {v}: {'OK' if not issues else ''}")
            for i in issues:
                print("      -", i)
        if pg.evaluate("() => document.documentElement.scrollWidth > window.innerWidth + 2"):
            total += 1
            print("  HORIZONTAL PAGE SCROLL")
        if errs:
            total += len(errs)
            print("  JS ERRORS:")
            for e in dict.fromkeys(errs):
                print("      -", e[:150])
        pg.close()
    b.close()

print(f"\nTOTAL ISSUES: {total}")
sys.exit(1 if total else 0)
