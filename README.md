# VNIndex Web — static HTML/JS valuation dashboard

A dependency-free (raw HTML + CSS + vanilla JS) front-end for the HOSE valuation
data produced by the sibling Python project [`vnindex-valuation`](../vnindex-valuation).

**Why this exists.** The Streamlit version runs a Python server: it cold-boots
(~8–9s for the first visitor), needs a keep-alive cron, and burns GitHub Actions
minutes. This version has **no server**. The Python pipeline stays the data
*producer* — it fetches from vnstock, computes DCF/multiples/ratios, and writes
the DB exactly as before — and a small export step turns those already-computed
rows into flat JSON the browser reads directly. Result: instant load, free
static hosting (GitHub Pages), no keep-alive.

## Architecture

```
vnindex-valuation (Python)                 vnindex-web (this repo)
  vnstock ─▶ collectors ─▶ DB (Supabase)      data/*.json  ◀── export_data.py
                                              index.html + js/ + css/  ─▶ browser
```

The browser never runs Python, pandas, or vnstock — it only `fetch()`es JSON.
`js/data.js` is the single data-access layer, so the source could later be
swapped for a live Supabase REST endpoint without touching any view code.

## Regenerate the data

`export_data.py` reads the live DB (via `DATABASE_URL`, or the sibling repo's
`.env`) and writes `data/`. It reuses the sibling's own valuation code
(`model_valuation.py`) to compute the **sector-adjusted, winsorized model price**
— the same number the Streamlit app shows — so a bank isn't valued with a raw
DCF that reads +715%.

```bash
# from this directory, using the sibling project's virtualenv
DATABASE_URL=postgresql://...  python export_data.py
```

This is meant to run in the same GitHub Actions job as the daily refresh.

## Run locally

Browsers block ES modules over `file://`, and Windows' stdlib server mislabels
`.js` as `text/plain`, so use the tiny dev server:

```bash
python serve.py 8777      # then open http://localhost:8777
```

(Production hosts like GitHub Pages serve `.js` correctly, so this is a dev-only
convenience.)

## Deploy (GitHub Pages)

Push to GitHub, then Settings → Pages → deploy from the `main` branch root. The
site is fully static; no build step.

## Status

Six views implemented:
- **Phân tích cổ phiếu** — header, key metrics, candlestick+volume chart,
  sector-aware TTM ratio scorecard (bank NIM/CIR/…, securities & real-estate
  variants), sector-adjusted valuation + quality signal, 6 quarterly analysis
  charts, price-vs-value chart.
- **Sàng lọc** — screener with sector/signal/P-E/ROE/upside filters.
- **Phân tích ngành** — treemap + median-by-sector table.
- **Tổng quan thị trường** — breadth, top gainers/losers/most-active, sector
  performance (from the exported daily % change).
- **Vĩ mô** — 10 headline macro indicator charts.
- **Danh mục** — portfolio tracker (localStorage), P&L + model upside per holding.

**Deliberately not ported** — these need a live call the static site can't make:
live intraday quotes (the app's ticking price during trading hours; this site
shows the EOD close) and the analyst-recommendation card (a per-ticker vnstock
call, not stored in the DB). A handful of the Streamlit app's deeper per-ticker
chart rows (foreign trading, dividends, business projection) are also left out.
