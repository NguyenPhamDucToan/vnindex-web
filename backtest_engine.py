"""Portfolio backtest engine (plan Phase 10, Days 72-89).

Pure functions over pandas objects; no database, no network. export_backtest.py
loads the data and calls these; tests/test_backtest_engine.py runs them on
synthetic series.

Conventions
-----------
* Prices are in thousands of VND, as stored. `raw` is the traded close, `adj`
  the close back-adjusted for bonus issues and splits (see adjust_prices).
  Returns and NAV use `adj`; anything that needs a real share count or a real
  market cap at a point in time (lot rounding, P/E) uses `raw`.
* A signal computed on date t is executed at the close of the next session,
  so no portfolio is ever formed at a price that was already known to the
  signal.
* Costs per side: commission + slippage; sells also pay the 0.1% sale tax.
* Positions are bought in board lots of 100 shares from a fixed starting
  capital, so the cash a small account cannot invest is part of the result.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date

import numpy as np
import pandas as pd

TRADING_DAYS = 252

# An entitlement (bonus issue, stock dividend, split) rescales the reference
# price overnight, so the opening print gaps and the close stays on the new
# level. Measured on this database, an opening gap alone is not evidence: of
# 1,547 gaps past 7.5% between consecutive sessions, most were limit-down opens
# (exactly 1/0.93) in sell-offs, and a third were thin-trading opens the close
# never followed. So a gap is adjusted only when the CLOSE moved with it, and
#   (A) it is past 15% and isolated -- a cluster of big gaps is a crash, or
#   (B) it is past 5% and something independent confirms it: an issuance event
#       within days, or a step in the reported share count of the same size
#       (the statements reach back to 2019, the event list mostly to 2024).
# A cash dividend of a few percent is left alone, as VNINDEX leaves it alone.
BIG_GAP = 0.15
EVENT_GAP = 0.05
CLOSE_AGREES = 0.5        # close must move at least half the opening gap
SHARE_TOL = 0.04          # share-count step must match the gap within 4%
MAX_RATIO = 25.0          # beyond this it is a data error, not an action
MAX_GAP_DAYS = 10         # bars further apart than this are a trading halt
CLUSTER_SESSIONS = 5
LIMIT_DOWN = 1 / 0.93       # previous close / a limit-down open
LIMIT_UP = 1 / 1.07
LIMIT_TOL = 0.005


def share_steps(fin_rows: list[dict]) -> list[tuple]:
    """(window_start, window_end, ratio) for every quarter whose reported
    share count rose by more than 4% on the quarter before. A gap inside the
    window -- after the previous quarter end, up to 10 days past this one --
    whose ratio matches is an issuance."""
    import calendar
    qs = sorted((r for r in fin_rows if r.get("period_type") == "Q" and r.get("shares_outstanding")),
                key=lambda r: str(r["period"]))
    out = []

    def _end(p):
        y, q = int(p[:4]), int(p[6:])
        m = 3 * q
        return date(y, m, calendar.monthrange(y, m)[1])
    for a, b in zip(qs, qs[1:]):
        try:
            sa, sb = float(a["shares_outstanding"]), float(b["shares_outstanding"])
            ea, eb = _end(str(a["period"])), _end(str(b["period"]))
        except (TypeError, ValueError):
            continue
        if sa > 0 and sb / sa > 1.04:
            out.append((ea, eb + pd.Timedelta(days=10).to_pytimedelta(), sb / sa))
    return out


def adjust_prices(df: pd.DataFrame, issuances: set | None = None,
                  steps: list[tuple] | None = None) -> tuple[pd.DataFrame, list]:
    """Back-adjust close/open for entitlements. Returns (df with `adj`, events).

    `df` has columns date, open, close (raw), sorted by date. The newest bar
    keeps its traded price; earlier bars are divided by the cumulative ratio of
    the actions after them.
    """
    out = df.copy()
    if len(out) < 2:
        out["adj"] = out["close"].astype(float)
        return out, []
    closes = out["close"].astype(float).to_numpy()
    opens = out["open"].astype(float).to_numpy() if "open" in out.columns else closes
    dates = pd.to_datetime(out["date"]).dt.date.to_numpy()
    n = len(closes)
    cand = {}
    for i in range(1, n):
        pc, op, cl = closes[i - 1], opens[i], closes[i]
        if not (pc > 0 and op > 0 and cl > 0) or (dates[i] - dates[i - 1]).days > MAX_GAP_DAYS:
            continue
        r = pc / op
        if not (1 / MAX_RATIO < r < MAX_RATIO) or abs(r - 1) <= EVENT_GAP:
            continue
        rc = pc / cl
        if (rc - 1) * (r - 1) <= 0 or abs(rc - 1) < CLOSE_AGREES * abs(r - 1):
            continue                                   # the close did not follow the open
        cand[i] = r
    # A gap of exactly the daily limit is a limit-up/limit-down open, which a
    # sell-off produces many of: never an action, whatever else lines up.
    cand = {i: r for i, r in cand.items()
            if min(abs(r - LIMIT_DOWN), abs(r - LIMIT_UP)) > LIMIT_TOL}
    idx = sorted(cand)

    def isolated(k):
        i = idx[k]
        return ((k == 0 or i - idx[k - 1] > CLUSTER_SESSIONS)
                and (k == len(idx) - 1 or idx[k + 1] - i > CLUSTER_SESSIONS))
    ratio_at = {}
    for k, i in enumerate(idx):
        r, d = cand[i], dates[i]
        near_event = bool(issuances) and any(-2 <= (e - d).days <= 10 for e in issuances)
        if near_event or (abs(r - 1) > BIG_GAP and isolated(k)):
            ratio_at[i] = r
    # A share-count step confirms ONE gap: the isolated one inside its window
    # that matches its size best.
    for a, b, sr in (steps or []):
        best = None
        for k, i in enumerate(idx):
            if i in ratio_at or not (a < dates[i] <= b) or not isolated(k):
                continue
            err = abs(cand[i] / sr - 1)
            if err <= SHARE_TOL and (best is None or err < best[0]):
                best = (err, i)
        if best:
            ratio_at[best[1]] = cand[best[1]]
    fac = np.ones(n)
    f = 1.0
    for i in range(n - 1, 0, -1):
        if i in ratio_at:
            f *= ratio_at[i]
        fac[i - 1] = f
    out["adj"] = closes / fac
    events = [(str(dates[i]), round(r, 4)) for i, r in sorted(ratio_at.items())]
    return out, events


# ── panels ──────────────────────────────────────────────────────────────────
def to_panel(frames: dict[str, pd.DataFrame], column: str) -> pd.DataFrame:
    """{ticker: df with date + column} -> wide DataFrame, index = sessions."""
    cols = {}
    for t, df in frames.items():
        s = df.set_index(pd.to_datetime(df["date"]))[column].astype(float)
        cols[t] = s[~s.index.duplicated(keep="last")]
    return pd.DataFrame(cols).sort_index()


def rebalance_dates(sessions: pd.DatetimeIndex, months=(2, 5, 8, 11), day: int = 20,
                    start=None) -> list[pd.Timestamp]:
    """First session on or after `day` of each rebalance month."""
    out = []
    years = range(sessions[0].year, sessions[-1].year + 1)
    for y in years:
        for m in months:
            target = pd.Timestamp(y, m, day)
            if start is not None and target < pd.Timestamp(start):
                continue
            after = sessions[sessions >= target]
            if len(after) and (after[0] - target).days <= 10:
                out.append(after[0])
    return out


# ── simulation ──────────────────────────────────────────────────────────────
@dataclass
class Costs:
    commission: float = 0.0015
    slippage: float = 0.001
    sell_tax: float = 0.001

    @property
    def buy(self) -> float:
        return self.commission + self.slippage

    @property
    def sell(self) -> float:
        return self.commission + self.slippage + self.sell_tax


@dataclass
class Result:
    nav: pd.Series
    turnover: float                     # mean one-way turnover per rebalance, fraction of NAV
    holdings: list = field(default_factory=list)   # [(date, [tickers])]
    cost_paid: float = 0.0              # fraction of mean NAV, per year
    cash_share: float = 0.0             # mean idle cash share


def simulate(selections: dict[pd.Timestamp, list[str]], adj: pd.DataFrame, raw: pd.DataFrame,
             capital: float = 1e9, lot: int = 100, costs: Costs | None = None,
             end=None) -> Result:
    """Equal-weight long-only portfolio rebuilt on each signal date.

    `selections` maps a signal date to the tickers to hold; the trade happens at
    the close of the following session. Prices are forward-filled for valuation
    (a suspended stock keeps its last price) and a stock that cannot be priced
    on the trade day is not bought.
    """
    costs = costs or Costs()
    adj = adj.ffill()
    raw = raw.ffill()
    sessions = adj.index
    if end is not None:
        sessions = sessions[sessions <= pd.Timestamp(end)]
    sig_dates = sorted(d for d in selections if d in sessions)
    if not sig_dates:
        return Result(nav=pd.Series(dtype=float), turnover=0.0)
    trade_on = {}
    for d in sig_dates:
        pos = sessions.get_loc(d)
        if pos + 1 < len(sessions):
            trade_on[sessions[pos + 1]] = selections[d]
    start = min(trade_on)
    units: dict[str, float] = {}       # in adjusted-price units: value = units * adj
    cash = float(capital)
    nav_out = {}
    turns, held, paid, cash_shares = [], [], 0.0, []
    vk = 1000.0                        # prices are in thousands of VND
    for d in sessions[sessions >= start]:
        px = adj.loc[d]
        if d in trade_on:
            nav_before = cash + sum(u * px[t] * vk for t, u in units.items() if t in px and px[t] == px[t])
            targets = [t for t in trade_on[d] if t in px.index and px[t] == px[t] and px[t] > 0
                       and raw.loc[d].get(t, np.nan) > 0]
            traded = 0.0
            # Sell everything not wanted, and trim what is.
            # Leave room for the sale costs of what is sold, so cash never goes negative.
            want_value = (nav_before * (1 - costs.sell) / len(targets)) if targets else 0.0
            new_units = {}
            for t in targets:
                r = raw.loc[d, t] * vk
                shares = math.floor(want_value / (r * (1 + costs.buy)) / lot) * lot
                new_units[t] = shares * r / (px[t] * vk)     # convert real shares -> adjusted units
            for t in set(units) | set(new_units):
                p = px.get(t, np.nan)
                if not (p == p and p > 0):
                    new_units[t] = units.get(t, 0.0)          # unpriceable: keep as is
                    continue
                delta = new_units.get(t, 0.0) - units.get(t, 0.0)
                v = abs(delta) * p * vk
                if delta > 0:
                    cash -= v * (1 + costs.buy)
                    paid += v * costs.buy
                elif delta < 0:
                    cash += v * (1 - costs.sell)
                    paid += v * costs.sell
                traded += v
            units = {t: u for t, u in new_units.items() if u > 0}
            turns.append(traded / 2 / nav_before if nav_before > 0 else 0.0)
            held.append((d.date().isoformat(), sorted(units)))
        nav = cash + sum(u * px[t] * vk for t, u in units.items() if px[t] == px[t])
        nav_out[d] = nav
        if nav > 0:
            cash_shares.append(max(cash, 0.0) / nav)
    nav_s = pd.Series(nav_out)
    years = max((nav_s.index[-1] - nav_s.index[0]).days / 365.25, 1e-9)
    return Result(nav=nav_s, turnover=float(np.mean(turns)) if turns else 0.0, holdings=held,
                  cost_paid=paid / float(nav_s.mean()) / years if len(nav_s) else 0.0,
                  cash_share=float(np.mean(cash_shares)) if cash_shares else 0.0)


# ── metrics ─────────────────────────────────────────────────────────────────
def metrics(nav: pd.Series, rf: float = 0.04, bench: pd.Series | None = None) -> dict:
    """CAGR, volatility, Sharpe, max drawdown, Calmar; optional excess vs a benchmark."""
    nav = nav.dropna()
    if len(nav) < 20 or nav.iloc[0] <= 0:
        return {}
    years = (nav.index[-1] - nav.index[0]).days / 365.25
    total = nav.iloc[-1] / nav.iloc[0] - 1
    cagr = (1 + total) ** (1 / years) - 1 if years > 0 and total > -1 else None
    r = nav.pct_change().dropna()
    vol = float(r.std() * math.sqrt(TRADING_DAYS)) if len(r) > 1 else None
    dd = float((nav / nav.cummax() - 1).min())
    out = {"cagr": cagr, "total": float(total), "vol": vol,
           "sharpe": ((cagr - rf) / vol) if (cagr is not None and vol) else None,
           "max_dd": dd, "calmar": (cagr / abs(dd)) if (cagr is not None and dd < 0) else None,
           "years": round(years, 2)}
    if bench is not None:
        b = bench.reindex(nav.index).ffill().dropna()
        if len(b) > 20:
            bm = metrics(b, rf)
            out["excess_cagr"] = (cagr - bm["cagr"]) if (cagr is not None and bm.get("cagr") is not None) else None
            # Share of rolling 63-session windows the strategy beat the benchmark.
            j = pd.concat([nav, b], axis=1, join="inner").dropna()
            w = (j.iloc[:, 0].pct_change(63) - j.iloc[:, 1].pct_change(63)).dropna()
            out["beat_share"] = float((w > 0).mean()) if len(w) else None
    return out


def calendar_returns(nav: pd.Series) -> dict:
    """{year: return} from the first to the last NAV of each calendar year
    (the first year from the start, a partial year marked by its span)."""
    out = {}
    nav = nav.dropna()
    prev = None
    for y, g in nav.groupby(nav.index.year):
        base = prev if prev is not None else g.iloc[0]
        out[str(y)] = float(g.iloc[-1] / base - 1)
        prev = g.iloc[-1]
    return out


# ── ranking helpers ─────────────────────────────────────────────────────────
def pct_rank(s: pd.Series) -> pd.Series:
    """Cross-sectional percentile in [0, 1], NaN kept as NaN."""
    return s.rank(pct=True, method="average")


def quantile_buckets(score: pd.Series, n: int = 5) -> dict[int, list[str]]:
    """Split tickers by score into n buckets; bucket n holds the highest scores."""
    s = score.dropna().sort_values()
    if len(s) < n:
        return {}
    out = {}
    for k, chunk in enumerate(np.array_split(s.index.to_numpy(), n), start=1):
        out[k] = list(chunk)
    return out


def top_n(score: pd.Series, n: int) -> list[str]:
    return list(score.dropna().sort_values(ascending=False).index[:n])


def as_date(x) -> date:
    return pd.Timestamp(x).date()
