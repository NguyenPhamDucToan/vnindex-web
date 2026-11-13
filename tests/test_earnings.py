"""export_earnings: release dates from VCI stamps, event day, market-adjusted windows."""
from datetime import date

import pandas as pd
import pytest

from export_earnings import (event_index, ni_growth, next_release, parse_releases, quarter_end,
                             study, summarize)


def test_quarter_end():
    assert quarter_end(2026, 3) == date(2026, 9, 30)
    assert quarter_end(2026, 4) == date(2026, 12, 31)


def test_parse_releases_drops_reload_stamps():
    rows = [
        {"yearReport": 2026, "lengthReport": 3, "createDate": "2026-10-29T17:57:12.69"},
        {"yearReport": 2021, "lengthReport": 4, "createDate": "2022-10-24T09:00:00"},   # 297 days: a reload
        {"yearReport": 2026, "lengthReport": 2, "createDate": "2026-07-30T16:45:09"},
        {"yearReport": 2026, "lengthReport": 5, "createDate": "2026-07-30T16:45:09"},   # annual row
    ]
    assert parse_releases(rows) == [
        {"q": "2026Q2", "at": "2026-07-30T16:45", "lag": 30},
        {"q": "2026Q3", "at": "2026-10-29T17:57", "lag": 29},
    ]


def test_event_after_the_close_moves_to_the_next_session():
    s = pd.DatetimeIndex(["2026-10-28", "2026-10-29", "2026-10-30", "2026-11-02"])
    assert event_index("2026-10-29T17:57", s) == 2
    assert event_index("2026-10-29T09:30", s) == 1
    assert event_index("2026-10-31T10:00", s) == 3          # weekend -> Monday


def test_ni_growth_needs_a_positive_base():
    ni = {"2026Q3": 120.0, "2025Q3": 100.0, "2026Q2": 50.0, "2025Q2": -10.0}
    assert ni_growth(ni, "2026Q3") == pytest.approx(0.2)
    assert ni_growth(ni, "2026Q2") is None
    assert ni_growth(ni, "2026Q1") is None


def test_study_is_stock_minus_index():
    sessions = pd.bdate_range("2026-01-01", periods=40)
    vni = pd.Series(100.0, index=sessions)
    vni.iloc[20:] = 101.0                                    # index +1% on the event day
    px = pd.Series(10.0, index=sessions)
    px.iloc[20:] = 10.5                                      # stock +5% on the event day
    rel = [{"q": "2025Q4", "at": f"{sessions[20].date()}T09:00", "lag": 30}]
    (ev,) = study(rel, px, vni, {"2025Q4": 2.0, "2024Q4": 1.0})
    assert ev["date"] == sessions[20].date().isoformat()
    assert ev["d1"] == pytest.approx(0.04)
    assert ev["d20"] is None                                 # only 19 sessions after it
    assert ev["pre"] == 0 and ev["growth"] == 1.0
    s = summarize([ev], rel, date(2026, 3, 1))
    assert s["n"] == 1 and s["up"]["n"] == 1 and s["d1_pos"] == 1.0


def test_next_release_uses_the_same_quarter_lag():
    rel = [{"q": "2024Q4", "lag": 45}, {"q": "2025Q3", "lag": 29}, {"q": "2025Q4", "lag": 41},
           {"q": "2026Q3", "lag": 30}]
    assert next_release(rel, date(2026, 11, 8)) == {"q": "2026Q4", "date": "2027-02-12", "lag": 43}
    late = next_release(rel, date(2027, 3, 1))
    assert late["overdue"] is True
