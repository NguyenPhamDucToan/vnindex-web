# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Static (no build step, no framework) HTML + vanilla-JS ES-module port of the Streamlit valuation app in the
sibling repo `../vnindex-valuation` (GitHub: `NguyenPhamDucToan/vnindex_valuation`). UI text is Vietnamese.
Plotly 2.35 is loaded from CDN in `index.html`; there are no npm dependencies.

## Commands

```bash
python serve.py 8777                 # dev server (needed: file:// blocks ES modules, Windows stdlib mislabels .js)

# Data export — run in the sibling project's virtualenv; needs DATABASE_URL (or ../vnindex-valuation/.env)
python export_data.py                # fast-moving files: companies, screener, macro, market, meta, ticker/*.json
python add_mcap.py                   # adds mcap to screener.json from local ticker files (deploy runs this after export)
python add_macro_indicator.py ...    # patch one macro series without a full re-export
python export_commodities.py         # Yahoo futures -> data/commodities.json
python export_actions.py [--all]     # dividends/issues (`actions`) + insider deals (`insiders`), one VCI call/ticker (weekly)
python export_earnings.py [--missing]  # earnings release dates (VCI createDate) + market-adjusted reaction (`earnings`), weekly
python backfill.py holders|payables|fvtpl   # drives export_detailed.py --missing until no progress
python export_detailed.py --tickers SSI VCI # 20-quarter detail + news for a subset
python export_analyst.py / export_news.py / export_market_history.py
python export_backtest.py            # Phase 10 factor backtest -> data/backtest.json (weekly in refresh-slow.yml, ~2 min)

# Checks (no unit-test suite). Browser ones use Playwright against BASE (default http://localhost:8777)
python check_css.py                  # every class the JS renders has a CSS rule
python check_tips.py                 # scorecard colour thresholds match their tooltip legends
python check_sector_axes.py          # js/sector-metrics.js matches the signed-off sector-metric table
python audit_all.py [WIDTH ...]      # walk every view/sub-tab: JS errors, empty plots, NaN/undefined text, h-scroll
python audit_lines.py / audit_text.py
python compare_to_original.py [TICKER]   # diff vs Streamlit original on :8501 (streamlit run dashboard/app.py --server.port 8501)
python diff_view.py / diff_colors.py
```

On Windows set `PYTHONIOENCODING=utf-8` before running Python scripts — output contains Vietnamese text.

## Architecture

**Producer/consumer split.** The sibling repo fetches market data and writes the DB (Supabase Postgres).
`export_data.py` reads the already-computed rows and writes flat JSON into `data/`; the browser only `fetch()`es it.
`export_data.py` puts `../vnindex-valuation` on `sys.path` and imports its `config`, `valuation/*`, `models/*`;
`model_valuation.py` reuses that code to compute the sector-adjusted, winsorized model price (P/NII for banks,
NAV proxy for real estate…) so the site and the Streamlit app can't drift. Don't reimplement valuation logic here.

**Fast vs. slow data blocks.** Inside each `data/ticker/<T>.json`, the blocks `analyst`, `detail`, `news_events`,
`holders`, `actions`, `insiders`, `earnings` come from slower per-ticker VCI/Yahoo calls (the throttles in `export_detailed.py`/`export_analyst.py`
were sized for vnstock's old ~20 req/min cap) and are **not** produced by `export_data.py` — it carries them forward from the existing committed file on every run.
So: a re-export that doesn't read the old file destroys them, and these blocks only persist if committed.

**CI (`.github/workflows/`).**
- `deploy.yml` — weekdays 12:30 UTC, on push to `master`, manual. Checks out both repos side by side, runs
  `export_data.py` (skipped on pushes that touch no `.py`/`requirements.txt`/workflow/`data/` — a same-day cached
  export keyed on the git tree hash of `data/` is restored instead), `add_mcap.py`, a sanity check
  (≥300 screener rows, ≥300 ticker files, ≥30 macro series, some `mcap`), then deploys to **Cloudflare Pages** via
  wrangler. It does not commit data. (README's GitHub Pages / `main` section is outdated.)
- `refresh-slow.yml` — Sunday 12:00 UTC (after the sibling's financials sweep, so `detail` quarters line up with
  `financials`): `export_commodities.py`, `backfill.py`, then **commits** `data/`.
- **No vnstock.** Every market-data call goes through the sibling's `vndata` package (`from vndata import Quote,
  Company, Finance, ...`) — plain `requests` to VCI, with SSI iBoard and VNDirect as fallbacks, no API key. It keeps
  vnstock's class names and DataFrame columns, so the exporters read the same `item_id`s and column names. A change
  to `vndata` lands in the sibling repo, and CI here only sees it once that repo is pushed.

**Front-end (`js/`).**
- `data.js` is the only data-access layer (cached `fetch` of `data/*.json`; `commodities.json` optional → `null`).
- `app.js` is the entry point and router for the six views (stock analysis, screener, sector, market, macro,
  portfolio in localStorage). It wraps `Plotly.react` once globally to set `hoverlabel.namelength = -1` and a
  smaller hover font on narrow screens — keep that rather than per-chart hoverlabel settings.
- Sector awareness runs through `sector-metrics.js` (per-sector metric sets/radar axes, e.g. bank NIM/CIR,
  securities, insurance), `ratings.js` (`ratingColor`/`sectorBand` thresholds), `ttm.js`, and `signals.js`
  (quality score + signal classification). Changing a tile's thresholds means also changing its tooltip legend
  (`check_tips.py`).
- `quarterly.js` indexes the `detail` block by the quarters `financials` provides.
- `screener.js` (Sàng lọc: presets, min/max filters, `#screen?...` URL state, CSV) and `backtest.js`
  (Kiểm định chiến lược, reads `data/backtest.json`). Backtest logic: `backtest_engine.py` (price
  adjustment, simulation with costs/lots, metrics) and `backtest_factors.py` (point-in-time factors:
  quarters usable 45 days after period end, annual reports 100 days, trade at the next close).
- Stored prices are VCI's adjusted history (cash dividends and share issues already priced in; checked
  against the `actions` block, 98% of ex-dates show no gap). Don't re-apply announced ratios. The sibling collector
  reloads a ticker whose recent overlap no longer matches VCI (`collectors/prices.py` `rebase_ratio`);
  `corp_actions.py` is only a safety net for a missed seam (isolated gap >15%). `js/corp-actions.js` marks
  ex-dates on the price chart and renders "Quyền & cổ tức".
- `insiders.js` renders "Giao dịch nội bộ" from `insiders`. Net figures count executed deals only (a filing
  published after its window closed is a result report; registration + result are merged in `export_actions.py`).
  The screener's `ins_net12` (12-month net, fraction of shares) comes from `export_actions.insider_net`.
- `earnings.js` renders "Giá phản ứng khi ra báo cáo quý" from `earnings` (export_earnings.py): release date = VCI's
  `createDate` on the quarter's statement (stamps outside 10–75 days after quarter end are reloads, dropped; after
  15:00 → next session), returns minus VNINDEX over [−5,−1], [0,+1], [0,+5], [0,+20] sessions.
- Holders, "Quyền & cổ tức", insiders and the earnings reaction are `<details>` sections shown as tabs of one
  card ("Sở hữu, cổ tức & sự kiện", `tabcard.js`) below the valuation summary — not stacked above the price chart
  (the owner found that cluttered). Opening a tab opens its `<details>`, whose own `toggle` handler draws the chart,
  so a section must draw on `toggle`, never while hidden.
- Charts that need missing optional data are skipped, not broken.

Goal of the port is parity with the Streamlit original; the `compare_to_original.py`/`diff_*` scripts exist for that.
Live intraday quotes and live per-ticker vnstock calls are deliberately not ported (static site, no CORS).
