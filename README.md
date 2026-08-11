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

Implemented: **Phân tích cổ phiếu** (header, key metrics, candlestick + volume
chart, sector-aware TTM ratio scorecard, sector-adjusted valuation + quality
signal, price-vs-value chart) and **Sàng lọc** (screener, ranked by signal).

Not yet ported from the Streamlit app: sector-specific bank/securities metric
rows (NIM/CIR/…), the deep quarterly chart rows, sector heatmap, portfolio
tracker, market overview, macro tab, and live intraday quotes.
