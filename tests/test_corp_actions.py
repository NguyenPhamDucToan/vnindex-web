"""corp_actions.py and export_actions.parse on synthetic data -- no database, no network."""
import pandas as pd
import pytest

import corp_actions as ca
from datetime import date

from export_actions import insider_net, kind_of, parse, parse_insiders


def _bars(closes, opens=None, start="2026-09-14"):
    d = pd.bdate_range(start, periods=len(closes))
    return pd.DataFrame({"date": [x.date().isoformat() for x in d], "open": opens or closes,
                         "high": closes, "low": closes, "close": closes,
                         "volume": [1000.0] * len(closes)})


def test_big_isolated_seam_is_removed():
    # GMD-like seam: old rows on the pre-bonus scale (x1.5), new rows on the new one.
    df = _bars([150.0] * 8 + [100.0] * 8)
    seam = df["date"][8]
    out, ev = ca.adjust(df)
    assert [d for d, _ in ev] == [seam]
    assert out["close"][0] == pytest.approx(100.0)
    assert out["close"].iloc[-1] == 100.0                  # newest bar untouched
    assert (out["close"] * out["volume"])[0] == pytest.approx(150.0 * 1000)   # turnover kept


def test_gaps_inside_the_band_are_left_alone():
    # 10% is a genuine move on UPCoM (band 15%): never a seam on its own.
    df = _bars([110.0] * 8 + [100.0] * 8)
    out, ev = ca.adjust(df)
    assert ev == [] and out["close"].tolist() == df["close"].tolist()


def test_clean_history_and_short_input():
    df = _bars([10.0, 10.1, 10.2, 10.1, 10.3])
    out, ev = ca.adjust(df)
    assert ev == [] and out["close"].tolist() == df["close"].tolist()
    assert ca.adjust(_bars([10.0, 10.0]))[1] == []


def test_parse_kinds_and_dedup():
    assert kind_of("DIV", "x") == "cash"
    assert kind_of("ISS", "Phát hành cổ phiếu - Trả Cổ tức bằng Cổ phiếu tỉ lệ 10%") == "stock"
    assert kind_of("ISS", "Phát hành cổ phiếu - Quyền mua CP cho Cổ đông hiện hữu tỉ lệ 20%") == "rights"
    assert kind_of("ISS", "Phát hành cổ phiếu - Phát hành cho CBCNV") == "esop"
    row = {"event_code": "ISS", "event_title_vi": "Phát hành cổ phiếu - Cổ phiếu thưởng tỉ lệ 10.0%",
           "exright_date": "2026-09-21", "exercise_ratio": 0.1}
    out = parse([row, dict(row), {"event_code": "AGME"}])
    assert len(out) == 1 and out[0]["kind"] == "bonus" and out[0]["ex"] == "2026-09-21"


def _deal(title, code="DDIND", start=None, end=None, pub=None):
    return {"event_code": code, "event_title_vi": title, "start_date": start, "end_date": end,
            "public_date": pub}


def test_insider_registration_and_result_merge_into_one_deal():
    rows = [
        _deal("Doãn Thị Bích Ngọc - Đăng kí Bán 350,000 HPG", "DDRP", "2026-09-15", "2026-10-14", "2026-09-10"),
        _deal("Doãn Thị Bích Ngọc - Đăng kí Bán 350,000 HPG", "DDRP", "2026-10-09", "2026-10-14", "2026-10-15"),
        _deal("Trần Vũ Minh - Đăng kí Mua 50,000,000 HPG", "DDIND", "2026-03-12", "2026-04-09", "2026-04-13"),
        _deal("Công ty ABC - Đăng kí Mua 1.000.000 HPG", "DDINS", "2026-11-04", "2026-12-03", "2026-10-30"),
        {"event_code": "DIV", "event_title_vi": "Trả cổ tức"},
    ]
    out = parse_insiders(rows)
    by = {(d["name"], d["status"]) for d in out}
    assert len(out) == 3
    assert ("Doãn Thị Bích Ngọc", "done") in by                # registration + its result
    assert ("Trần Vũ Minh", "result") in by                     # result only, older history
    assert ("Công ty ABC", "reg") in by                         # still open
    abc = next(d for d in out if d["name"] == "Công ty ABC")
    assert abc["who"] == "org" and abc["side"] == "buy" and abc["qty"] == 1_000_000


def test_insider_net_counts_executed_deals_in_the_window_only():
    deals = [
        {"side": "buy", "qty": 50_000_000, "start": "2026-03-12", "status": "result"},
        {"side": "sell", "qty": 350_000, "start": "2026-09-15", "status": "done"},
        {"side": "buy", "qty": 9_000_000, "start": "2026-11-04", "status": "reg"},     # not executed
        {"side": "sell", "qty": 7_000_000, "start": "2025-01-10", "status": "result"},  # too old
    ]
    v = insider_net(deals, 8_000.0, date(2026, 11, 8))
    assert v == pytest.approx((50_000_000 - 350_000) / 8_000e6, abs=1e-6)   # rounded to 6 dp
    assert insider_net([], 8_000.0, date(2026, 11, 8)) == 0.0
    assert insider_net(None, 8_000.0, date(2026, 11, 8)) is None
    assert insider_net(deals, None, date(2026, 11, 8)) is None


def test_insider_net_counts_each_person_once_at_their_largest_filing():
    # ADG: FSN Asia re-registered the unsold rest four times; summing gave -111%.
    fsn = [("2025-12-02", 6_165_900), ("2026-01-08", 6_165_900), ("2026-02-26", 5_165_900),
           ("2026-04-06", 4_154_900), ("2026-05-12", 4_165_900)]
    deals = [{"name": "FSN Asia", "side": "sell", "qty": q, "start": s, "status": "result"} for s, q in fsn]
    deals.append({"name": "Nguyễn Khánh Trình", "side": "buy", "qty": 1_000_000, "start": "2026-01-21", "status": "result"})
    deals.append({"name": "Nguyễn Khánh Trình", "side": "buy", "qty": 1_000_000, "start": "2026-05-18", "status": "result"})
    v = insider_net(deals, 21.38, date(2026, 11, 8))
    assert v == pytest.approx((1_000_000 - 6_165_900) / 21.38e6, abs=1e-6)
    assert v > -1                                       # never more than the company
