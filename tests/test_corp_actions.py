"""corp_actions.py and export_actions.parse on synthetic data -- no database, no network."""
import pandas as pd
import pytest

import corp_actions as ca
from export_actions import kind_of, parse


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
