# -*- coding: utf-8 -*-
"""Assert js/sector-metrics.js still matches the sector-metric table the user
signed off on. Radar spokes are the non-`extra` axes, in order.

Run it in the browser so the real module is evaluated rather than parsed by
hand -- a regex over the source would pass on axes that throw at runtime.
"""
import sys
from playwright.sync_api import sync_playwright

APPROVED = {
    "Ngân hàng": ["NIM", "CIR", "Chi phí tín dụng", "LDR", "ROE", "Vốn chủ/Tổng TS"],
    "Chứng khoán": ["TS tài chính/Tổng TS", "Dư nợ margin/Vốn chủ", "Đòn bẩy",
                    "Biên LN ròng", "ROE", "Upside"],
    "Bảo hiểm": ["Đầu tư/Tổng TS", "Biên LN ròng", "ROE", "Đòn bẩy",
                 "Chất lượng LN", "Upside"],
    "Bất động sản": ["Biên gộp", "Tồn kho/Tổng TS", "D/E", "Dòng tiền HĐKD/LNST", "ROE", "Upside"],
    "Xây dựng": ["Biên gộp", "Số ngày phải thu", "D/E", "Dòng tiền HĐKD/LNST", "ROE", "Upside"],
    "Bán lẻ": ["Biên gộp", "Vòng quay tồn kho", "Vòng quay TS", "Biên LN ròng", "CCC", "ROE"],
    "Bán buôn": ["Biên gộp", "Vòng quay tồn kho", "Vòng quay TS", "Biên LN ròng", "CCC", "ROE"],
    "Thực phẩm - Đồ uống": ["Biên gộp", "Vòng quay tồn kho", "Số ngày phải thu",
                            "Biên LN ròng", "ROE", "Upside"],
    "Chế biến Thủy sản": ["Biên gộp", "Vòng quay tồn kho", "Số ngày phải thu",
                          "Biên LN ròng", "ROE", "Upside"],
    "Nông - Lâm - Ngư": ["Biên gộp", "Vòng quay tồn kho", "Số ngày phải thu",
                         "Biên LN ròng", "ROE", "Upside"],
    "SX Nhựa - Hóa chất": ["Biên gộp", "Biên EBITDA", "Vòng quay tồn kho", "CCC", "D/E", "ROE"],
    "SX Phụ trợ": ["Biên gộp", "Biên EBITDA", "Vòng quay tồn kho", "CCC", "D/E", "ROE"],
    "SX Hàng gia dụng": ["Biên gộp", "Biên EBITDA", "Vòng quay tồn kho", "CCC", "D/E", "ROE"],
    "Vật liệu xây dựng": ["Biên gộp", "Biên EBITDA", "Vòng quay tồn kho", "CCC", "D/E", "ROE"],
    "Thiết bị điện": ["Biên gộp", "Biên EBITDA", "Vòng quay tồn kho", "CCC", "D/E", "ROE"],
    "SX Thiết bị, máy móc": ["Biên gộp", "Biên EBITDA", "Vòng quay tồn kho", "CCC", "D/E", "ROE"],
    "Sản phẩm cao su": ["Biên gộp", "Biên EBITDA", "Vòng quay tồn kho", "CCC", "D/E", "ROE"],
    "Tiện ích": ["Biên EBITDA", "Khấu hao/Doanh thu", "D/E", "Biên FCF", "ROE", "Upside"],
    "Vận tải - kho bãi": ["Biên EBITDA", "Vòng quay TS", "D/E", "Biên FCF", "ROE", "Upside"],
    "Khai khoáng": ["Biên EBITDA", "CAPEX/Doanh thu", "D/E", "Biên FCF", "ROE", "Upside"],
    "Công nghệ và thông tin": ["Tăng trưởng DT", "Biên gộp", "Biên LN ròng",
                               "Biên FCF", "ROE", "Upside"],
    "Chăm sóc sức khỏe": ["Biên gộp", "Biên LN ròng", "Chất lượng LN", "D/E", "ROE", "Upside"],
    "Dịch vụ lưu trú, ăn uống, giải trí": ["Biên EBITDA", "Vòng quay TS", "D/E",
                                           "Biên FCF", "ROE", "Upside"],
}

JS = """async () => {
  const m = await import('/js/sector-metrics.js');
  const out = {};
  for (const [sector, axes] of Object.entries(m.SECTOR_AXES)) {
    out[sector] = {
      spokes: axes.filter(a => !a.extra).map(a => a.label),
      extras: axes.filter(a => a.extra).map(a => a.label),
    };
  }
  out.__generic = m.axesFor(['a', 'b']).map(a => a.label);
  return out;
}"""

with sync_playwright() as pw:
    b = pw.chromium.launch()
    pg = b.new_page()
    pg.goto("http://localhost:8777/", wait_until="networkidle", timeout=60000)
    pg.wait_for_timeout(2500)
    got = pg.evaluate(JS)
    b.close()

fails = 0
for sector, want in APPROVED.items():
    have = got.get(sector, {}).get("spokes")
    if have is None:
        print(f"MISSING sector: {sector}")
        fails += 1
    elif have != want:
        print(f"MISMATCH {sector}\n    approved: {want}\n    built:    {have}")
        fails += 1

extra_sectors = set(got) - set(APPROVED) - {"__generic"}
if extra_sectors:
    print("Sectors present but not in the approved table:", sorted(extra_sectors))

for sector, d in got.items():
    if sector != "__generic" and d.get("extras"):
        print(f"  (extra, bars+table only) {sector}: {d['extras']}")

print(f"\ngeneric fallback: {got['__generic']}")
print("OK — every sector matches" if not fails else f"\n{fails} mismatches")
sys.exit(1 if fails else 0)
