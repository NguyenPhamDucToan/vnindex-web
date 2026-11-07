"""backtest_engine.py on synthetic prices -- no database, no network."""
import math

import numpy as np
import pandas as pd
import pytest

import backtest_engine as be


def _bars(closes, opens=None, start="2024-01-01"):
    d = pd.bdate_range(start, periods=len(closes))
    return pd.DataFrame({"date": d, "close": closes, "open": opens or closes})


def test_bonus_issue_gap_beyond_the_band_is_adjusted():
    # 1:1 bonus: the reference halves overnight. Flat before and after.
    df = _bars([20.0] * 5 + [10.0] * 5, [20.0] * 5 + [10.0] * 5)
    out, ev = be.adjust_prices(df)
    assert ev and ev[0][1] == pytest.approx(2.0)
    assert out["adj"].tolist() == pytest.approx([10.0] * 10)   # no fake -50%
    assert out["close"].tolist()[0] == 20.0                     # raw kept


def test_market_move_inside_the_band_is_left_alone():
    df = _bars([10.0, 10.0, 9.4, 9.0], [10.0, 10.0, 9.4, 9.0])  # -6%, an ordinary limit-ish day
    out, ev = be.adjust_prices(df)
    assert ev == [] and out["adj"].tolist() == [10.0, 10.0, 9.4, 9.0]


def test_small_gap_adjusted_only_with_an_issuance_event():
    df = _bars([10.0] * 3 + [9.4] * 3)                      # -6%: a 6.4% stock dividend?
    assert be.adjust_prices(df)[1] == []
    ex = df["date"].iloc[3].date()
    _, ev = be.adjust_prices(df, issuances={ex})
    assert ev and ev[0][1] == pytest.approx(10 / 9.4, abs=1e-4)


def test_gap_after_a_trading_halt_is_not_an_action():
    d = list(pd.bdate_range("2024-01-01", periods=3)) + list(pd.bdate_range("2024-03-01", periods=3))
    df = pd.DataFrame({"date": d, "close": [10, 10, 10, 6, 6, 6], "open": [10, 10, 10, 6, 6, 6]})
    assert be.adjust_prices(df)[1] == []


def _panel(prices: dict, start="2024-01-01"):
    idx = pd.bdate_range(start, periods=len(next(iter(prices.values()))))
    return pd.DataFrame(prices, index=idx)


def test_trades_at_the_next_close_and_pays_costs():
    # A doubles on the session after the signal; buying at the signal close
    # would capture it, buying at the next close must not.
    a = [10.0, 10.0, 20.0, 20.0, 20.0]
    px = _panel({"AAA": a})
    sig = {px.index[1]: ["AAA"]}
    r = be.simulate(sig, px, px, capital=1e9, lot=100, costs=be.Costs(0, 0, 0))
    assert r.nav.index[0] == px.index[2]
    assert r.nav.iloc[-1] == pytest.approx(r.nav.iloc[0])      # bought at 20, stayed 20
    rc = be.simulate(sig, px, px, capital=1e9, lot=100, costs=be.Costs())
    assert rc.nav.iloc[0] < 1e9 and rc.nav.iloc[0] > 1e9 * (1 - 0.01)


def test_lot_rounding_leaves_cash():
    # 1bn over one stock at 900k VND per share: 100-share lots are 90m,
    # so 11 lots = 990m invested and the rest stays in cash.
    px = _panel({"AAA": [900.0] * 4})
    r = be.simulate({px.index[0]: ["AAA"]}, px, px, capital=1e9, lot=100, costs=be.Costs(0, 0, 0))
    assert r.cash_share == pytest.approx(0.01, abs=1e-6)


def test_rebalance_sells_what_left_the_list():
    px = _panel({"AAA": [10.0] * 6, "BBB": [10.0, 10.0, 10.0, 10.0, 5.0, 5.0]})
    sig = {px.index[0]: ["BBB"], px.index[2]: ["AAA"]}
    r = be.simulate(sig, px, px, capital=1e9, costs=be.Costs(0, 0, 0))
    # Out of BBB at index 3 (before its halving at index 4).
    assert r.nav.iloc[-1] == pytest.approx(1e9, rel=1e-3)
    assert r.holdings[-1][1] == ["AAA"]


def test_metrics_on_a_known_path():
    idx = pd.bdate_range("2020-01-01", "2022-01-01")
    nav = pd.Series(np.linspace(100, 121, len(idx)), index=idx)
    m = be.metrics(nav, rf=0.0)
    assert m["cagr"] == pytest.approx(0.10, abs=0.002)        # 1.21 over two years
    assert m["max_dd"] == 0.0
    dd = nav.copy(); dd.iloc[100:] *= 0.5
    assert be.metrics(dd)["max_dd"] == pytest.approx(-0.5, abs=0.01)


def test_buckets_and_rebalance_dates():
    s = pd.Series(range(10), index=[f"T{i}" for i in range(10)], dtype=float)
    b = be.quantile_buckets(s, 5)
    assert b[5] == ["T8", "T9"] and b[1] == ["T0", "T1"]
    assert be.top_n(s, 3) == ["T9", "T8", "T7"]
    sess = pd.bdate_range("2024-01-01", "2024-12-31")
    rd = be.rebalance_dates(sess)
    assert [d.month for d in rd] == [2, 5, 8, 11] and all(d.day >= 20 for d in rd)


def test_limit_down_opens_in_a_selloff_are_not_actions():
    # Four limit-down sessions in a row: a crash, not four bonus issues.
    c = [10.0, 9.3, 8.649, 8.0436, 7.4805, 7.4805]
    df = _bars(c, c)
    assert be.adjust_prices(df)[1] == []


def test_an_opening_print_the_close_ignores_is_not_an_action():
    # Thin stock: one odd opening trade 20% down, the close back at 10.
    df = _bars([10.0] * 6, [10.0, 10.0, 10.0, 8.0, 10.0, 10.0])
    assert be.adjust_prices(df)[1] == []


def test_share_count_step_confirms_a_mid_sized_gap():
    # 12% stock dividend in 2024-Q2, no event on file; the statements show
    # the share count stepping 100 -> 112 between Q1 and Q2.
    d = pd.bdate_range("2024-05-01", periods=10)
    c = [11.2] * 5 + [10.0] * 5
    df = pd.DataFrame({"date": d, "close": c, "open": c})
    assert be.adjust_prices(df)[1] == []                       # 12% alone: not enough
    fin = [{"period": "2024-Q1", "period_type": "Q", "shares_outstanding": 100.0},
           {"period": "2024-Q2", "period_type": "Q", "shares_outstanding": 112.0}]
    steps = be.share_steps(fin)
    out, ev = be.adjust_prices(df, steps=steps)
    assert ev and out["adj"].tolist() == pytest.approx([10.0] * 10)
    # A step of a different size does not confirm it.
    fin[1]["shares_outstanding"] = 130.0
    assert be.adjust_prices(df, steps=be.share_steps(fin))[1] == []
