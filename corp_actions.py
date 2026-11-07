"""Seam repair for stored prices (plan Day 99).

What the database holds: VCI's daily history, which VCI back-adjusts for cash
dividends AND share issues as of the day it is fetched. Checked 2026-11-07
against the exchange's own list (export_actions.py): of 284 bonus/stock
dividends with an ex-date in the stored window, 98% leave no gap at all in
the stored series, and neither do cash dividends (D2D's 29% payout on
2024-10-11: open within 1.4% of the previous close). So the stored prices are
already total-return adjusted; applying the announced ratios again would
double-count them.

What goes wrong is the seam. Until the collector learned to reload a ticker
whose history VCI has rescaled (collectors/prices.py, rebase_ratio), each run
appended new days on the new scale beside old rows on the old one -- and a
catch-up after missed runs moves the seam to the first day fetched (GMD's
2026-10-07 bonus x1.5 sits at 2026-09-25). This module finds those seams with
backtest_engine.adjust_prices, using the ex-dates of share actions as
confirmation alongside ISS events and share-count steps, and divides the
history before each one. Once the database has been rebased it finds nothing.
"""
from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd

import backtest_engine as be

SHARE_KINDS = ("stock", "bonus", "rights")


def confirm_dates(actions: list[dict] | None, issuances: set | None = None) -> set:
    """Dates that make a gap credible: ISS events plus ex-dates of share actions."""
    out = set(issuances or ())
    for a in actions or []:
        if a.get("kind") in SHARE_KINDS:
            try:
                out.add(date.fromisoformat(str(a.get("ex") or a.get("date"))[:10]))
            except ValueError:
                pass
    return out


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


def adjust(df: pd.DataFrame, actions: list[dict] | None = None,
           issuances: set | None = None, steps: list | None = None):
    """-> (df with seams removed, [(session date, factor), ...])."""
    if df is None or len(df) < 3:
        return df, []
    df = df.reset_index(drop=True)
    _, ev = be.adjust_prices(df, confirm_dates(actions, issuances), steps)
    if not ev:
        return df, []
    pos = {str(d)[:10]: i for i, d in enumerate(df["date"])}
    return apply(df, [(pos[d], r) for d, r in ev if d in pos]), ev
