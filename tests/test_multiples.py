"""export_multiples.summarize and model_valuation.overlay_vci_multiples."""
import pytest

from export_multiples import summarize
from model_valuation import overlay_vci_multiples


def _q(y, q, **kw):
    return {"yearReport": y, "quarter": q, **kw}


def test_summarize_takes_the_newest_window_and_drops_artefacts():
    rows = [_q(2018, 1, pe=99.0, pb=9.0)]                       # outside the 20-quarter window
    rows += [_q(2021 + i // 4, i % 4 + 1, pe=10.0 + i % 3, pb=1.5, priceToCashFlow=-4.0) for i in range(20)]
    rows.append(_q(2026, 1, pe=950.0, pb=1.5))                  # near-zero earnings: not a price
    s = summarize(rows)
    assert s["pb"] == 1.5 and s["n"] == 20
    assert s["pe"] == pytest.approx(11.0)                        # median of 10/11/12, 950 excluded
    assert "pocf" not in s                                        # negative every quarter
    assert s["from"] == "2021Q2" and s["to"] == "2026Q1"


def test_summarize_needs_two_years():
    assert summarize([_q(2026, q, pe=10.0) for q in (1, 2, 3)]) is None


def test_overlay_replaces_key_by_key_and_adds_missing_tickers():
    mine = {"TCB": {"pe": 5.0, "pb": 0.79, "ps": 3.0}, "AAA": {"pe": 9.0}}
    vci = {"TCB": {"pe": 8.1, "pb": 1.24, "n": 20}, "NEW": {"pb": 1.1}}
    out = overlay_vci_multiples(mine, vci)
    assert out["TCB"] == {"pe": 8.1, "pb": 1.24, "ps": 3.0}      # ps kept: VCI gave none
    assert out["AAA"] == {"pe": 9.0} and out["NEW"] == {"pb": 1.1}
    assert mine["TCB"]["pe"] == 5.0                                # input left alone
    assert overlay_vci_multiples(mine, {}) is mine
