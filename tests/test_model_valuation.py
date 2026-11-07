"""Tests for model_valuation.py -- the sector-adjusted model price the site shows.

No network and no production database (see conftest.py). The history-builder
test writes a tiny SQLite database; the rest patch history() with a canned one.
"""
from datetime import date, timedelta

import pandas as pd
import pytest

import model_valuation as mv


@pytest.fixture(autouse=True)
def _fresh_history(monkeypatch):
    monkeypatch.setattr(mv, "_HIST", None)
    yield


def _fake_history(monkeypatch, **parts):
    h = {"ticker": {}, "sector": {}, "market": {}, "annual": {}, "sectors": {}}
    h.update(parts)
    monkeypatch.setattr(mv, "history", lambda: h)
    return h


# ── small helpers ───────────────────────────────────────────────────────────
def test_quarter_usable_from_adds_the_publish_lag():
    assert mv._quarter_usable_from("2026-Q1") == date(2026, 4, 1) + timedelta(days=45)
    # Q4 becomes usable in the following year.
    assert mv._quarter_usable_from("2025-Q4") == date(2026, 1, 1) + timedelta(days=45)
    assert mv._quarter_usable_from("garbage") is None


def test_price_basis_date_uses_the_most_common_start_not_the_earliest():
    closes = [("AAA", date(2021, 3, 2), 10.0), ("BBB", date(2021, 3, 2), 5.0),
              ("CCC", date(2021, 3, 2), 7.0),
              # A thin ticker whose history reaches further back must not move it.
              ("TTE", date(2019, 8, 20), 3.0), ("TTE", date(2021, 3, 2), 3.1)]
    assert mv._price_basis_date(closes) == date(2021, 3, 2) + timedelta(days=365 * 5)
    assert mv._price_basis_date([]) is None


def test_winsorized_and_family_mean():
    assert mv._winsorized_mean([10, 10, 10]) == pytest.approx(10)
    # An outlier is pulled in, not allowed to drag the mean.
    assert mv._winsorized_mean([10, 11, 12, 300]) < 60
    # Families are averaged, so one family with many members gets one vote.
    methods = {"pe_own": 100, "pb_own": 100, "pe": 50, "pb": 50, "ps": 50, "ri": 80}
    assert mv._family_mean(methods) == pytest.approx((100 + 50 + 80) / 3)
    assert mv._family_mean({}) is None


# ── the share-basis fix (2026-11-02) ────────────────────────────────────────
def _write_bonus_issue_company():
    """One company, equity 1,000bn throughout, 100m shares until a 1:1 bonus
    issue in 2024, 200m after. Its stored prices are ADJUSTED to the 200m
    count -- a flat 10,000 VND -- the way the first price load stored them.
    True P/B on that basis: 10,000 x 200m / 1,000bn = 2.0 in every year."""
    from models.database import engine, get_session
    from models.schema import Base, Company, Financial, Price
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with get_session() as s:
        s.add(Company(ticker="AAA", name="Bonus Co", sector="Test", exchange="HOSE", is_active=True))
        for year in range(2021, 2027):
            for q in range(1, 5):
                if (year, q) > (2026, 2):
                    break
                shares = 100.0 if year < 2024 else 200.0
                s.add(Financial(ticker="AAA", period=f"{year}-Q{q}", period_type="Q",
                                equity=1000.0, shares_outstanding=shares, net_income=25.0,
                                revenue=200.0))
        d = date(2021, 3, 2)
        while d <= date(2026, 6, 30):
            if d.weekday() < 5:
                s.add(Price(ticker="AAA", date=d, open=10.0, high=10.0, low=10.0,
                            close=10.0, volume=1000, adjusted_close=10.0))
            d += timedelta(days=1)


def test_history_puts_pre_load_quarters_on_the_load_date_share_count():
    _write_bonus_issue_company()
    h = mv._build_history()
    pb = h["ticker"]["AAA"]["pb"]
    pe = h["ticker"]["AAA"]["pe"]
    # Before the fix the 2021-2023 sessions read 1.0x book and dragged the median.
    assert pb == pytest.approx(2.0, abs=0.01)
    # EPS on the same basis: 100bn a year / 200m shares = 500 VND -> P/E 20.
    assert pe == pytest.approx(20.0, abs=0.1)


# ── broker ROE scaling ──────────────────────────────────────────────────────
def _ttm(equity=1000.0, shares=100.0, ni=100.0):
    return {"equity": equity, "shares_outstanding": shares, "net_income": ni}


def test_broker_sector_pb_scale_is_capped_at_twice_the_sector(monkeypatch):
    _fake_history(monkeypatch)
    monkeypatch.setattr(mv, "_avg_annual_roe", lambda t, years=3: 0.40)
    monkeypatch.setattr(mv, "_sector_roe", lambda s, years=3: 0.10)
    bvps = 1000 * 1e9 / (100 * 1e6)          # 10,000 VND
    broker = mv.justified_sector_pb(_ttm(), "Chứng khoán", "VIX", 2.0)
    other = mv.justified_sector_pb(_ttm(), "Thép", "HPG", 2.0)
    assert broker == pytest.approx(bvps * 2.0 * 2.0)     # ROE 4x the sector, capped at 2x
    assert other == pytest.approx(bvps * 2.0 * 4.0)      # other sectors keep the 4x cap


def test_broker_scaling_reads_the_mid_cycle_roe(monkeypatch):
    _fake_history(monkeypatch)
    seen = {}
    monkeypatch.setattr(mv, "_avg_annual_roe", lambda t, years=3: seen.setdefault("t", years) and 0.1)
    monkeypatch.setattr(mv, "_sector_roe", lambda s, years=3: seen.setdefault("s", years) and 0.1)
    mv.justified_sector_pb(_ttm(), "Chứng khoán", "SSI", 2.0)
    assert seen == {"t": mv._BROKER_ROE_YEARS, "s": mv._BROKER_ROE_YEARS}


def test_loss_making_broker_gets_the_floor_not_the_full_sector_multiple(monkeypatch):
    _fake_history(monkeypatch)
    monkeypatch.setattr(mv, "_avg_annual_roe", lambda t, years=3: -0.05)
    monkeypatch.setattr(mv, "_sector_roe", lambda s, years=3: 0.10)
    bvps = 10_000
    assert mv.justified_sector_pb(_ttm(), "Chứng khoán", "APG", 2.0) == pytest.approx(bvps * 2.0 * 0.25)


# ── life insurer ────────────────────────────────────────────────────────────
def test_life_insurer_keeps_only_its_own_history(monkeypatch):
    _fake_history(monkeypatch,
                  ticker={"BVH": {"pe": 17.0, "pb": 1.5}, "PGI": {"pe": 10.0, "pb": 1.2}},
                  sector={"Bảo hiểm": {"pe": 9.6, "pb": 1.26, "ps": 1.0}},
                  market={"pe": 12.0, "pb": 1.1, "ps": 1.0})
    ttm = {"equity": 20_000.0, "shares_outstanding": 740.0, "net_income": 2_000.0,
           "revenue": 40_000.0, "total_assets": 250_000.0}
    life = mv._sector_adjust({}, ttm, "Bảo hiểm", beta=0.75, ticker="BVH")
    non_life = mv._sector_adjust({}, ttm, "Bảo hiểm", beta=0.75, ticker="PGI")
    for k in ("pe", "pb", "epv", "ri"):
        assert life.get(k) is None, k
    assert life["pb_own"] and life["pe_own"]
    assert non_life["pe"] is not None and non_life["pb"] is not None


# ── DCF sensitivity grid and bear/base/bull (plan Day 52-53) ────────────────
def test_dcf_grid_centre_reproduces_the_dcf_card(monkeypatch):
    from valuation.dcf import dcf_valuation
    from valuation.wacc import DEFAULT_BETA, DEFAULT_COD
    monkeypatch.setattr(mv, "_dcf_inputs", lambda ttm, t: (1000.0, 0.10))
    ttm = {"shares_outstanding": 500.0, "debt": 2000.0, "cash": 500.0, "equity": 5000.0}
    card = dcf_valuation(fcff_base=1000.0, net_debt_bn=1500.0, shares_millions=500.0,
                         fcff_growth_rate=0.10, beta=DEFAULT_BETA, cost_of_debt=DEFAULT_COD,
                         debt_bn=2000.0, equity_bn=5000.0)
    grid = mv.dcf_grid(ttm, "AAA")
    assert len(grid) == 15
    centre = [c for c in grid if c["wacc"] == round(card["wacc"], 4) and c["growth"] == 0.10]
    assert centre and abs(centre[0]["price"] - card["price_per_share"]) <= 1
    # Higher discount rate -> lower value; higher growth -> higher value.
    by = {(c["wacc"], c["growth"]): c["price"] for c in grid}
    ws = sorted({c["wacc"] for c in grid})
    assert by[(ws[0], 0.10)] > by[(ws[-1], 0.10)]
    assert by[(ws[2], 0.14)] > by[(ws[2], 0.06)]


def test_dcf_grid_none_without_cash_flow(monkeypatch):
    monkeypatch.setattr(mv, "_dcf_inputs", lambda ttm, t: (None, 0.12))
    assert mv.dcf_grid({"shares_outstanding": 100.0}, "AAA") is None


def test_scenarios_take_the_extreme_families():
    methods = {"pe_own": 100, "pb_own": 100, "pe": 50, "pb": 50, "dcf": 80}
    sc = mv.scenarios(methods)
    assert sc["bear"] == 50 and sc["bear_family"] == "sector"
    assert sc["bull"] == 100 and sc["bull_family"] == "own"
    assert sc["base"] == round(mv._family_mean(methods))
    assert mv.scenarios({"pe": 50}) is None      # one family: nothing to compare
