"""Safety net for seams in stored prices (plan Day 99).

What the database holds: VCI's daily history, which VCI back-adjusts for cash
dividends AND share issues as of the day it is fetched. Checked 2026-11-07
against the exchange's own list (export_actions.py): 98% of bonus/stock
dividend ex-dates and nearly every cash dividend leave no gap in the stored
series. So the prices are already total-return adjusted; applying announced
ratios again would double-count them.

The real defect was the seam: the collector appended new days on VCI's new
scale beside old rows on the old one (215 of 403 tickers, GMD x1.5). The
collector now reloads a ticker whose recent overlap no longer matches
(../vnindex-valuation/collectors/prices.py), and collectors/rebase_prices.py
repaired the stored seams on 2026-11-07.

What is left here is a safety net for a seam the collector misses (a failed
run, a VCI hiccup): only an isolated gap beyond 15%, outside every exchange's
daily band, is treated as one. The looser rule that also accepted 5-15% gaps
near an ISS event fired 39 times on the repaired data, on genuine moves, so
it is not used.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

import backtest_engine as be


def apply(df: pd.DataFrame, factors: list[tuple[int, float]]) -> pd.DataFrame:
    """Divide OHLC before each seam by the product of the factors after it;
    scale volume the other way so close * volume (turnover) is unchanged."""
    n = len(df)
    fac = np.ones(n)
    f = 1.0
    at = dict(factors)
    for i in range(n - 1, 0, -1):
        if i in at:
            f *= at[i]
        fac[i - 1] = f
    out = df.copy()
    for col in ("open", "high", "low", "close"):
        if col in out.columns:
            out[col] = (out[col].astype(float).to_numpy() / fac).round(4)
    if "volume" in out.columns:
        out["volume"] = (out["volume"].astype(float).to_numpy() * fac).round(0)
    return out


def adjust(df: pd.DataFrame):
    """-> (df with seams removed, [(session date, factor), ...])."""
    if df is None or len(df) < 3:
        return df, []
    df = df.reset_index(drop=True)
    _, ev = be.adjust_prices(df, None, None)        # >15% isolated gaps only
    if not ev:
        return df, []
    pos = {str(d)[:10]: i for i, d in enumerate(df["date"])}
    return apply(df, [(pos[d], r) for d, r in ev if d in pos]), ev
