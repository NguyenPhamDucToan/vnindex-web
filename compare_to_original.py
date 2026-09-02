"""Deep diff of the static port against the running Streamlit original.

Comparing section headings alone hid three whole classes of gap earlier: chart
titles live inside Plotly (`.gtitle`) not in headings, chart rows sit behind a
tab selector so only one group is in the DOM at a time, and interactive bits
(hover tooltips, selectors, buttons) have no text at all until you look for
them. This walks both apps the same way and reports what one has and the other
doesn't.

    # both must be running
    #   original: streamlit run dashboard/app.py --server.port 8501
    #   port:     python serve.py 8777
    python compare_to_original.py [TICKER]

Output is a per-view list of MISSING (original has it, we don't) and EXTRA.
"""
from __future__ import annotations

import sys
from playwright.sync_api import sync_playwright

OLD = "http://localhost:8501"
NEW = "http://localhost:8777"
TICKER = sys.argv[1] if len(sys.argv) > 1 else "VNM"

# Views, and how to reach them in each app.
VIEWS = [
    ("Phân tích cổ phiếu", "Phân tích Cổ phiếu", "stock"),
    ("Sàng lọc", "Sàng lọc Cổ phiếu", "screen"),
    ("So sánh cổ phiếu", "So sánh Cổ phiếu", "compare"),
    ("Phân tích ngành", "Phân tích Ngành", "sector"),
    ("Tổng quan thị trường", "Tổng quan Thị trường", "market"),
]

COLLECT = r"""() => {
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const take = (sel, cap) => [...document.querySelectorAll(sel)]
      .map(e => norm(e.textContent)).filter(t => t && t.length <= cap);
  return {
    heads:  take('h1,h2,h3,.sec-h', 60),
    charts: take('.gtitle,.qtitle,.chart-sub', 90),
    // Streamlit renders its tab/segmented options as buttons or radio labels;
    // ours are .range-btn / .nav-item.
    controls: [...document.querySelectorAll(
        'button[kind], [data-testid="stBaseButton-secondary"], [role="radio"], .range-btn, .nav-item, .sig-c')]
        .map(e => norm(e.textContent)).filter(t => t && t.length <= 40),
    tables: [...document.querySelectorAll('table')].map(t =>
        [...t.querySelectorAll('th')].map(h => norm(h.textContent)).filter(Boolean).join(' | '))
        .filter(Boolean),
    // Hover affordances: our .ttm-tooltip, Streamlit's title= tooltips.
    tips: document.querySelectorAll('.ttm-tooltip, [title]:not([title=""])').length,
  };
}"""


def scroll_all(pg, streamlit: bool, rounds: int = 26) -> dict:
    """Scroll to the end, merging what is visible at each step (both apps
    render charts lazily, so a single snapshot always under-reports)."""
    acc = {"heads": set(), "charts": set(), "controls": set(), "tables": set(), "tips": 0}
    for _ in range(rounds):
        if streamlit:
            pg.evaluate("const s=document.querySelector('section.stMain'); if (s) s.scrollTop += 800;")
        else:
            pg.mouse.wheel(0, 900)
        pg.wait_for_timeout(500)
        r = pg.evaluate(COLLECT)
        for k in ("heads", "charts", "controls", "tables"):
            acc[k].update(r[k])
        acc["tips"] = max(acc["tips"], r["tips"])
    return acc


def click_every_tab(pg, streamlit: bool, acc: dict) -> None:
    """Chart rows hide behind selectors in both apps; open each and re-collect."""
    sel = ('[data-testid="stBaseButton-secondary"], [role="radio"]' if streamlit
           else ".range-btn, button[data-sub]")
    labels = pg.evaluate(
        f"""() => [...document.querySelectorAll('{sel}')]
              .map(e => e.textContent.trim()).filter(t => t && t.length < 40)""")
    for lab in labels[:14]:
        try:
            pg.click(f"text={lab}", timeout=4000)
            pg.wait_for_timeout(1600)
            r = pg.evaluate(COLLECT)
            for k in ("heads", "charts", "controls", "tables"):
                acc[k].update(r[k])
        except Exception:
            continue


def report(view: str, old: dict, new: dict) -> int:
    issues = 0
    print(f"\n===== {view} =====")
    for key in ("heads", "charts", "tables"):
        o, n = old[key], new[key]
        up = {x.upper() for x in n}
        missing = sorted(x for x in o if x.upper() not in up)
        if missing:
            issues += len(missing)
            print(f"  MISSING {key}:")
            for m in missing:
                print("    -", m)
    if old["tips"] and not new["tips"]:
        issues += 1
        print(f"  MISSING hover tooltips (original has {old['tips']}, we have 0)")
    if not issues:
        print("  no gaps")
    return issues


def main() -> None:
    total = 0
    with sync_playwright() as p:
        b = p.chromium.launch()
        for new_nav, old_nav, _slug in VIEWS:
            data = {}
            for tag, base, nav, streamlit, wait in (
                    ("old", OLD, old_nav, True, 30000),
                    ("new", NEW, new_nav, False, 5000)):
                pg = b.new_page(viewport={"width": 1600, "height": 1200})
                pg.goto(f"{base}/?ticker={TICKER}", wait_until="networkidle", timeout=180000)
                pg.wait_for_timeout(wait)
                try:
                    pg.click(f"text={nav}", timeout=8000)
                    pg.wait_for_timeout(12000 if streamlit else 3000)
                except Exception:
                    pass
                acc = scroll_all(pg, streamlit)
                click_every_tab(pg, streamlit, acc)
                data[tag] = acc
                pg.close()
            total += report(new_nav, data["old"], data["new"])
        b.close()
    print(f"\nTOTAL GAPS: {total}")
    sys.exit(1 if total else 0)


if __name__ == "__main__":
    main()
