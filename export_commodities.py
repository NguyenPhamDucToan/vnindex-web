"""Export the commodity price indices behind the original's chart 21.

dashboard/app.py fetches Yahoo Finance futures live and normalises each series
to 100 at the start of the window. A static site can't call Yahoo from the
browser (no CORS, and the page would be one API outage from a blank chart), so
the same fetch runs here and lands in data/commodities.json.

The sector -> symbol mapping lives in the JSON too, so the front-end doesn't
carry a second copy that can drift from this one.

    python export_commodities.py [--period 1y]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data"

# Copied verbatim from dashboard/app.py::_SECTOR_COMMODITIES -- input series are
# drawn dashed, output solid, which is how the original tells the two apart.
SECTOR_COMMODITIES = {
    "Thực phẩm - Đồ uống": {
        "title": "Giá nguyên liệu - Thực phẩm & Đồ uống",
        "input":  [("ZW=F", "Lúa mì", "#3b82f6"), ("SB=F", "Đường", "#8b5cf6"), ("ZC=F", "Bắp", "#f59e0b")],
        "output": [("KC=F", "Cà phê", "#92400e"), ("ZS=F", "Đậu nành", "#22c55e")],
    },
    "Nông - Lâm - Ngư": {
        "title": "Giá hàng hóa Nông nghiệp",
        "input":  [("ZC=F", "Bắp", "#f59e0b"), ("ZW=F", "Lúa mì", "#3b82f6")],
        "output": [("ZS=F", "Đậu nành", "#22c55e"), ("SB=F", "Đường", "#8b5cf6")],
    },
    "Chế biến Thủy sản": {
        "title": "Giá nguyên liệu - Thủy sản",
        "input":  [("ZC=F", "Bắp/TĂCN", "#f59e0b"), ("ZS=F", "Đậu nành/TĂCN", "#22c55e")],
        "output": [],
    },
    "Khai khoáng": {
        "title": "Giá hàng hóa Khai khoáng",
        "input":  [("CL=F", "Dầu thô", "#ef4444")],
        "output": [("GC=F", "Vàng", "#eab308"), ("SI=F", "Bạc", "#9ca3af")],
    },
    "Tiện ích": {
        "title": "Giá nguyên liệu - Năng lượng",
        "input":  [("CL=F", "Dầu thô", "#ef4444"), ("NG=F", "Khí tự nhiên", "#3b82f6")],
        "output": [],
    },
    "Vận tải - kho bãi": {
        "title": "Giá nhiên liệu Vận tải",
        "input":  [("BZ=F", "Dầu Brent", "#ef4444"), ("NG=F", "Khí tự nhiên", "#3b82f6")],
        "output": [],
    },
    "Vật liệu xây dựng": {
        "title": "Giá Vật liệu xây dựng",
        "input":  [("TIO=F", "Quặng sắt (đầu vào)", "#ef4444"), ("CL=F", "Năng lượng (đầu vào)", "#6b7280")],
        "output": [("SLX", "ETF Thép (đầu ra)", "#3b82f6")],
    },
    "SX Phụ trợ": {
        "title": "Giá nguyên liệu đầu vào/đầu ra - Sản xuất",
        "input":  [("TIO=F", "Quặng sắt (đầu vào)", "#ef4444"), ("HG=F", "Đồng (đầu vào)", "#f59e0b")],
        "output": [("SLX", "ETF Thép (đầu ra)", "#3b82f6")],
    },
    "SX Thiết bị, máy móc": {
        "title": "Giá nguyên liệu - Máy móc",
        "input":  [("TIO=F", "Quặng sắt (đầu vào)", "#ef4444"), ("ALI=F", "Nhôm (đầu vào)", "#9ca3af")],
        "output": [("HG=F", "Đồng (đầu ra)", "#f59e0b")],
    },
    "SX Nhựa - Hóa chất": {
        "title": "Giá nguyên liệu - Hóa chất/Nhựa",
        "input":  [("CL=F", "Dầu thô (đầu vào)", "#ef4444"), ("NG=F", "Khí tự nhiên (đầu vào)", "#3b82f6")],
        "output": [],
    },
    "Thiết bị điện": {
        "title": "Giá nguyên liệu - Thiết bị điện",
        "input":  [("HG=F", "Đồng (đầu vào)", "#f59e0b"), ("ALI=F", "Nhôm (đầu vào)", "#9ca3af")],
        "output": [],
    },
    "Sản phẩm cao su": {
        "title": "Giá nguyên liệu - Cao su/Dầu mỏ",
        "input":  [("CL=F", "Dầu thô (đầu vào)", "#ef4444")],
        "output": [],
    },
    "Xây dựng": {
        "title": "Giá Thép & Vật liệu xây dựng",
        "input":  [("TIO=F", "Quặng sắt (đầu vào)", "#ef4444"), ("CL=F", "Năng lượng (đầu vào)", "#6b7280")],
        "output": [("SLX", "Thép (đầu ra)", "#3b82f6")],
    },
}


def all_symbols() -> list[str]:
    out = []
    for d in SECTOR_COMMODITIES.values():
        for sym, _lab, _clr in d["input"] + d["output"]:
            if sym not in out:
                out.append(sym)
    return out


def fetch(symbols: list[str], period: str) -> dict:
    """Close prices per symbol, rebased to 100 at the start of the window."""
    import warnings
    import pandas as pd
    import yfinance as yf

    frames: dict[str, "pd.Series"] = {}
    for sym in symbols:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                df = yf.download(sym, period=period, progress=False,
                                 auto_adjust=True, threads=False)
            if df is None or df.empty:
                print(f"  {sym}: empty")
                continue
            close = df["Close"].squeeze().dropna()
            base = close.iloc[0] if len(close) else None
            if not base:
                print(f"  {sym}: no base")
                continue
            frames[sym] = (close / base * 100).round(2)
            print(f"  {sym}: {len(close)} points")
        except Exception as exc:                        # one dud symbol is not fatal
            print(f"  {sym}: {type(exc).__name__}: {exc}")

    if not frames:
        return {"dates": [], "series": {}}

    # Futures trade on different calendars, so align on the union of dates and
    # leave holes as null -- exactly what the original's DataFrame join does.
    wide = pd.DataFrame(frames).sort_index()
    dates = [d.strftime("%Y-%m-%d") for d in pd.to_datetime(wide.index)]
    series = {
        sym: [None if pd.isna(v) else float(v) for v in wide[sym].tolist()]
        for sym in wide.columns
    }
    return {"dates": dates, "series": series}


def main() -> None:
    period = "1y"
    if "--period" in sys.argv:
        period = sys.argv[sys.argv.index("--period") + 1]

    syms = all_symbols()
    print(f"Fetching {len(syms)} commodity symbols ({period})...")
    payload = fetch(syms, period)
    payload["sectors"] = {
        name: {
            "title": d["title"],
            "input":  [list(t) for t in d["input"]],
            "output": [list(t) for t in d["output"]],
        }
        for name, d in SECTOR_COMMODITIES.items()
    }

    DATA.mkdir(parents=True, exist_ok=True)
    out = DATA / "commodities.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                   encoding="utf-8")
    kb = out.stat().st_size / 1024
    print(f"Wrote {out.name}: {len(payload['series'])}/{len(syms)} series, "
          f"{len(payload['dates'])} dates, {kb:.0f} KB")


if __name__ == "__main__":
    main()
