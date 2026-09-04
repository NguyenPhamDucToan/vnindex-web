# -*- coding: utf-8 -*-
"""Diff one view against the running original: headings, chart titles, table
columns and controls.

Scraping a single snapshot under-reports badly -- both apps render lazily and
hide most content behind tab selectors -- so this scrolls to the end and clicks
every selector it finds before comparing.

    python diff_view.py "Phân tích ngành" "Phân tích Ngành" [TICKER]
"""
import sys
from playwright.sync_api import sync_playwright

NEW_NAV = sys.argv[1]
OLD_NAV = sys.argv[2]
TICKER = sys.argv[3] if len(sys.argv) > 3 else "VCB"

# Streamlit wraps labels in its own chrome, so match on text, not structure.
COLLECT = r"""() => {
  const n = s => (s || '').replace(/\s+/g, ' ').trim();
  const take = (sel, cap) => [...document.querySelectorAll(sel)]
      .map(e => n(e.textContent)).filter(t => t && t.length <= cap);
  return {
    heads: take('h1,h2,h3,.sec-h,.view-title', 70),
    charts: take('.gtitle,.qtitle', 90),
    controls: [...document.querySelectorAll(
        'button[kind],[data-testid="stBaseButton-secondary"],[role="radio"],'
        + '.range-btn,.sig-c,.nav-item,label,option')]
        .map(e => n(e.textContent)).filter(t => t && t.length <= 44),
    cols: [...document.querySelectorAll('table')].map(t =>
        [...t.querySelectorAll('th')].map(h => n(h.textContent)).filter(Boolean).join(' | '))
        .filter(Boolean),
  };
}"""

# Sidebar nav, deploy buttons and Material icon ligatures are Streamlit's own
# chrome, not content, and would otherwise swamp the report.
NOISE = {"deploy", "view", "tab", "ngành", "phân tích cổ phiếu", "sàng lọc cổ phiếu",
         "so sánh cổ phiếu", "phân tích ngành", "tổng quan thị trường",
         "keyboard_double_arrow_left", "keyboard_double_arrow_right", "mã"}


def walk(pg, streamlit):
    acc = {"heads": set(), "charts": set(), "controls": set(), "cols": set()}

    def grab():
        r = pg.evaluate(COLLECT)
        for k in acc:
            acc[k].update(r[k])

    for _ in range(24):
        if streamlit:
            pg.evaluate("const s=document.querySelector('section.stMain'); if (s) s.scrollTop += 700;")
        else:
            pg.mouse.wheel(0, 800)
        pg.wait_for_timeout(400)
        grab()
    sel = ('[data-testid="stBaseButton-secondary"],[role="radio"]' if streamlit
           else ".range-btn,.sig-c")
    labels = pg.evaluate(f"""() => [...document.querySelectorAll('{sel}')]
        .map(e => e.textContent.trim()).filter(t => t && t.length < 40)""")
    for lab in labels[:16]:
        try:
            pg.click(f"text={lab}", timeout=3500)
            pg.wait_for_timeout(1600)
            grab()
        except Exception:
            continue
    return acc


with sync_playwright() as pw:
    b = pw.chromium.launch()
    data = {}
    for tag, base, nav, st_, wait in (("old", "http://localhost:8501", OLD_NAV, True, 34000),
                                      ("new", "http://localhost:8777", NEW_NAV, False, 5000)):
        pg = b.new_page(viewport={"width": 1600, "height": 1200})
        pg.goto(f"{base}/?ticker={TICKER}", wait_until="networkidle", timeout=180000)
        pg.wait_for_timeout(wait)
        try:
            pg.click(f"text={nav}", timeout=9000)
            pg.wait_for_timeout(15000 if st_ else 4000)
        except Exception:
            pass
        data[tag] = walk(pg, st_)
        pg.close()
    b.close()

total = 0
for key in ("heads", "charts", "cols", "controls"):
    o, n = data["old"][key], data["new"][key]
    up = {x.upper() for x in n}
    miss = sorted(x for x in o if x.upper() not in up and x.lower() not in NOISE)
    print(f"\n--- {key}: original {len(o)}, port {len(n)} ---")
    if miss:
        total += len(miss)
        for m in miss:
            print("    MISSING:", m)
    else:
        print("    nothing missing")
print(f"\nTOTAL: {total}")
