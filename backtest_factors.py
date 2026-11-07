"""Point-in-time factors for the backtest.

Everything a factor reads on date t was public on date t: a quarter is used
only from its period end + 45 days (model_valuation._quarter_usable_from, the
same lag the site's historical multiples use), an annual report from year end
+ 100 days (the audited filing deadline is 90), and prices only up to t.

Factor scores are oriented so that HIGHER = more attractive by that factor's
own thesis (cheap, profitable, rising, calm, small); the engine buys the top.
"""
from __future__ import annotations

import math
from datetime import date, timedelta

import numpy as np
import pandas as pd

from backtest_engine import pct_rank

ANNUAL_LAG_DAYS = 100
MIN_ADV_BN = 1.0          # liquidity floor, VND billions per session (plan Day 76)
ADV_WINDOW = 20
MIN_HISTORY = 120         # sessions a ticker must have traded before it is eligible

FINANCIAL_SECTORS = frozenset({"Ngân hàng", "Chứng khoán", "Bảo hiểm"})

# key -> (Vietnamese name, one-line thesis)
FACTORS = {
    "ep":       ("P/E thấp (E/P cao)", "Lợi nhuận 4 quý / vốn hoá: mua mã rẻ so với lợi nhuận"),
    "bp":       ("P/B thấp (B/P cao)", "Vốn chủ / vốn hoá: mua mã rẻ so với sổ sách"),
    "roe":      ("ROE cao", "Lợi nhuận 4 quý / vốn chủ"),
    "quality":  ("Điểm chất lượng của app", "Cùng công thức điểm chất lượng 0–100 trên trang cổ phiếu"),
    "piotroski": ("Piotroski cao", "9 phép thử sức khoẻ tài chính trên hai báo cáo năm (không tính ngành tài chính)"),
    "mom":      ("Động lượng 12-1", "Tăng giá 12 tháng, bỏ tháng gần nhất"),
    "lowvol":   ("Biến động thấp", "Độ lệch chuẩn lợi nhuận ngày 12 tháng, thấp trước"),
    "small":    ("Vốn hoá nhỏ", "Mã nhỏ trước (hiệu ứng quy mô)"),
    "value_quality": ("Giá trị + Chất lượng", "Trung bình hạng E/P, B/P và điểm chất lượng"),
    "vqm":      ("Giá trị + Chất lượng + Động lượng", "Trung bình hạng E/P, B/P, điểm chất lượng và động lượng"),
}


def _qidx(period: str) -> int | None:
    try:
        return int(period[:4]) * 4 + int(period[6:]) - 1
    except (ValueError, TypeError):
        return None


def _q_usable(period: str) -> date | None:
    i = _qidx(period)
    if i is None:
        return None
    y, q = divmod(i, 4)
    end = date(y, 3 * (q + 1), 1) + timedelta(days=32)
    end = end.replace(day=1) - timedelta(days=1)           # last day of the quarter
    return end + timedelta(days=45)


def _y_usable(period: str) -> date | None:
    try:
        return date(int(str(period)[:4]), 12, 31) + timedelta(days=ANNUAL_LAG_DAYS)
    except ValueError:
        return None


def _num(x):
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    return f if f == f else None


class FinancialHistory:
    """One ticker's statements, indexed by the date each became public."""

    _FLOW = ("revenue", "gross_profit", "ebit", "net_income", "operating_cf", "fcf", "interest_expense")

    def __init__(self, rows: list[dict]):
        qs = [r for r in rows if r.get("period_type") == "Q" and _qidx(str(r.get("period")))]
        self.q = sorted(qs, key=lambda r: _qidx(str(r["period"])))
        self.q_use = [_q_usable(str(r["period"])) for r in self.q]
        ys = [r for r in rows if r.get("period_type") == "Y"]
        self.y = sorted(ys, key=lambda r: str(r["period"]))
        self.y_use = [_y_usable(r["period"]) for r in self.y]

    def ttm(self, t: date) -> dict | None:
        """Four consecutive quarters public by t, the newest at most ~7 months old."""
        avail = [r for r, u in zip(self.q, self.q_use) if u and u <= t]
        if len(avail) < 4:
            return None
        last4 = avail[-4:]
        idx = [_qidx(str(r["period"])) for r in last4]
        if idx != list(range(idx[0], idx[0] + 4)):
            return None
        if (t - _q_usable(str(last4[-1]["period"]))).days > 200:
            return None                                    # stopped filing
        out = {}
        for k in self._FLOW:
            vals = [_num(r.get(k)) for r in last4]
            out[k] = sum(vals) if all(v is not None for v in vals) else None
        newest = last4[-1]
        for k in ("equity", "total_assets", "current_assets", "current_liabilities", "debt",
                  "cash", "shares_outstanding", "inventory"):
            out[k] = _num(newest.get(k))
        out["period"] = newest["period"]
        out["period_end"] = _q_usable(str(newest["period"])) - timedelta(days=45)
        return out

    def annual_pair(self, t: date):
        avail = [r for r, u in zip(self.y, self.y_use) if u and u <= t]
        return (avail[-1], avail[-2]) if len(avail) >= 2 else None


def eligible(t: pd.Timestamp, raw: pd.DataFrame, value_bn: pd.DataFrame) -> list[str]:
    """Shares that traded within 5 sessions of t, have MIN_HISTORY sessions, and
    clear the liquidity floor on their mean traded value over ADV_WINDOW."""
    pos = raw.index.get_loc(t)
    window = raw.iloc[max(0, pos - 4): pos + 1]
    traded_recently = window.notna().any()
    hist = raw.iloc[: pos + 1].notna().sum()
    adv = value_bn.iloc[max(0, pos - ADV_WINDOW + 1): pos + 1].mean()
    ok = traded_recently & (hist >= MIN_HISTORY) & (adv >= MIN_ADV_BN)
    return [c for c in raw.columns if ok.get(c, False) and len(c) == 3]


def factor_table(t: pd.Timestamp, tickers: list[str], hist: dict[str, FinancialHistory],
                 raw: pd.DataFrame, adj: pd.DataFrame, sectors: dict[str, str],
                 quality_fn, piotroski_fn) -> pd.DataFrame:
    """One row per ticker, one column per factor score (higher = buy)."""
    td = t.date()
    pos = adj.index.get_loc(t)
    adj_hist = adj.iloc[: pos + 1]
    rows = {}
    for tk in tickers:
        h = hist.get(tk)
        f = {}
        px_raw = raw[tk].iloc[: pos + 1].dropna()
        px_adj = adj_hist[tk].dropna()
        if px_raw.empty:
            continue
        p_raw = float(px_raw.iloc[-1])
        ttm = h.ttm(td) if h else None
        if ttm and ttm.get("shares_outstanding") and p_raw > 0:
            # Shares grow with every bonus issue after the quarter end; the
            # ratio of raw to adjusted price tracks exactly those issues.
            pe_ts = pd.Timestamp(ttm["period_end"])
            fac_t = p_raw / float(px_adj.iloc[-1])
            before = adj_hist.index[adj_hist.index <= pe_ts]
            if len(before) and raw[tk].loc[before].dropna().size:
                d0 = raw[tk].loc[before].dropna().index[-1]
                fac_q = float(raw.at[d0, tk]) / float(adj.at[d0, tk])
            else:
                fac_q = fac_t
            shares = ttm["shares_outstanding"] * (fac_q / fac_t if fac_t > 0 else 1.0)
            mcap = p_raw * shares                    # thousands VND x millions = VND billions
            ni, eq = ttm.get("net_income"), ttm.get("equity")
            if mcap > 0:
                f["mcap"] = mcap
                if ni is not None:
                    f["ep"] = ni / mcap
                if eq is not None:
                    f["bp"] = eq / mcap
            if ni is not None and eq and eq > 0:
                f["roe"] = ni / eq
            def _r(a, b):
                a, b = ttm.get(a), ttm.get(b)
                return (a / b) if (a is not None and b) else None
            f["quality"] = quality_fn(
                _r("net_income", "equity"), _r("net_income", "revenue"),
                _r("operating_cf", "net_income"), _r("fcf", "revenue"),
                _r("current_assets", "current_liabilities"), _r("debt", "equity"),
                sector=sectors.get(tk))
        if h and sectors.get(tk) not in FINANCIAL_SECTORS:
            pair = h.annual_pair(td)
            if pair:
                pf = piotroski_fn(pair[0], pair[1], sectors.get(tk))
                if pf:
                    f["piotroski"] = pf["score"] + 0.01 * (f.get("quality") or 0) / 100   # tie-break
        if len(px_adj) >= 252:
            a = px_adj.to_numpy()
            if a[-252] > 0:
                f["mom"] = a[-21] / a[-252] - 1
            r = np.diff(np.log(a[-252:]))
            f["lowvol"] = -float(np.std(r)) * math.sqrt(252)
        if "mcap" in f:
            f["small"] = -math.log(f["mcap"])
        rows[tk] = f
    df = pd.DataFrame.from_dict(rows, orient="index")
    for c in FACTORS:
        if c not in df.columns:
            df[c] = np.nan
    ranks = {c: pct_rank(df[c]) for c in ("ep", "bp", "quality", "mom")}
    df["value_quality"] = pd.concat([ranks["ep"], ranks["bp"], ranks["quality"]], axis=1).mean(axis=1, skipna=False)
    df["vqm"] = pd.concat([ranks["ep"], ranks["bp"], ranks["quality"], ranks["mom"]], axis=1).mean(axis=1, skipna=False)
    return df
