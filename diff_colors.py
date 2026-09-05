# -*- coding: utf-8 -*-
"""Compare chart colours between the original and the port, chart by chart.

Structural diffs pass while the two still look different, because the palette
lives inside Plotly trace objects, not in the DOM text. This reads every trace's
colours out of window.Plotly and lines the two apps up by chart title.

    python diff_colors.py "Phân tích ngành" "Phân tích Ngành"
"""
import sys
from playwright.sync_api import sync_playwright

NEW_NAV = sys.argv[1]
OLD_NAV = sys.argv[2]

READ = r"""() => {
  const out = [];
  for (const p of document.querySelectorAll('.js-plotly-plot')) {
    const r = p.getBoundingClientRect();
    if (r.width < 40) continue;
    const t = p.querySelector('.gtitle');
    let title = t ? t.textContent.trim() : '';
    if (!title) {
      // Streamlit and the port both put a heading just above an untitled plot.
      let n = p.parentElement, hop = 0;
      while (n && !title && hop++ < 4) {
        const h = n.querySelector('h1,h2,h3,.sec-h,.qtitle');
        if (h) title = h.textContent.trim();
        n = n.parentElement;
      }
    }
    const colours = [];
    for (const tr of (p.data || [])) {
      const m = tr.marker || {}, l = tr.line || {};
      const push = (c) => {
        if (typeof c === 'string') colours.push(c);
        else if (Array.isArray(c)) for (const x of new Set(c)) if (typeof x === 'string') colours.push(x);
      };
      push(m.color); push(l.color); push(tr.fillcolor);
      if (m.colors) push(m.colors);
      if (m.colorscale) colours.push('scale:' + JSON.stringify(m.colorscale).slice(0, 60));
      if (tr.colorscale) colours.push('scale:' + JSON.stringify(tr.colorscale).slice(0, 60));
    }
    out.push({title: title.replace(/\s+/g, ' ').slice(0, 46),
              type: (p.data || []).map(d => d.type || 'scatter').join(','),
              colours: [...new Set(colours)]});
  }
  return out;
}"""


def walk(pg, streamlit, nav):
    try:
        pg.click(f"text={nav}", timeout=9000)
        pg.wait_for_timeout(16000 if streamlit else 4500)
    except Exception:
        pass
    seen = {}
    for _ in range(22):
        if streamlit:
            pg.evaluate("const s=document.querySelector('section.stMain'); if (s) s.scrollTop += 700;")
        else:
            pg.mouse.wheel(0, 800)
        pg.wait_for_timeout(420)
        for c in pg.evaluate(READ):
            if c["colours"]:
                seen.setdefault(c["title"], c)
    return seen


with sync_playwright() as pw:
    b = pw.chromium.launch()
    data = {}
    for tag, base, nav, st_, wait in (("old", "http://localhost:8501", OLD_NAV, True, 32000),
                                      ("new", "http://localhost:8777", NEW_NAV, False, 5000)):
        pg = b.new_page(viewport={"width": 1600, "height": 1200})
        pg.goto(f"{base}/", wait_until="networkidle", timeout=180000)
        pg.wait_for_timeout(wait)
        data[tag] = walk(pg, st_, nav)
        pg.close()
    b.close()

import re


def shape(t):
    """Strip the live numbers so only the wording is compared."""
    return re.sub(r"[0-9.,+\-\u2212%()]+", "#", t).strip().upper()


old, new = data["old"], data["new"]
print(f"original charts: {len(old)} | port charts: {len(new)}\n")
by_shape = {shape(k): v for k, v in new.items()}
for title, o in old.items():
    n = new.get(title) or by_shape.get(shape(title))
    if not n:
        key = title[:18].upper()
        n = next((v for k, v in new.items() if k[:18].upper() == key), None)
    if not n:
        print(f"[no counterpart] {title}  {o['colours']}")
        continue
    if [c.lower() for c in o["colours"]] != [c.lower() for c in n["colours"]]:
        print(f"{title}")
        print(f"    original: {o['colours']}")
        print(f"    port    : {n['colours']}")

print("")
print("--- ALL ORIGINAL ---")
for k, v in old.items():
    print("  [%-22s] %-46s %s" % (v["type"][:22], k[:44], v["colours"]))
print("")
print("--- ALL PORT ---")
for k, v in new.items():
    print("  [%-22s] %-46s %s" % (v["type"][:22], k[:44], v["colours"]))
