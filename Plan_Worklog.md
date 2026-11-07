# Nhật ký thực hiện kế hoạch

Mỗi mục: đã làm gì · tự kiểm tra thế nào · kết quả · file thay đổi. Commit trên máy, chưa push.

## Đợt 1 (2026-11-06)

### 1. Day 155 — Câu miễn trừ trách nhiệm ✅
- **Làm:** web: chân trang `.site-foot` trong `<main>` (hiện ở mọi trang, cả điện thoại); Streamlit: `st.sidebar.caption` ngay dưới menu chọn trang.
- **Nội dung:** chỉ để tham khảo, không phải khuyến nghị mua/bán/nắm giữ; giá mô hình tự động có thể sai/chậm; giá mục tiêu chuyên viên là của VCI; tự chịu trách nhiệm.
- **Kiểm tra:** `check_css.py` → "200 classes used, all styled"; HTML parse không lỗi; server dev trả trang có chân trang; không có code nào xoá `<main>` khi chuyển trang; `app.py` biên dịch được.
- **Chưa kiểm:** xem bằng mắt trên trình duyệt (máy không có Playwright) — bạn mở trang kiểm giúp.
- **File:** `vnindex-web/index.html`, `css/styles.css`; `vnindex-valuation/dashboard/app.py`.

### 2. Day 5 + 160 — Danh sách mã tự cập nhật, xử lý mã huỷ niêm yết ✅
- **Vấn đề:** `ticker_list.py` chỉ chạy tay → mã mới niêm yết không bao giờ vào hệ thống; mã đã rời sàn / chứng quyền đáo hạn vẫn được tải giá mỗi ngày. Job BCTC tuần chỉ tải mã đã có số liệu.
- **Làm:**
  - `collectors/ticker_list.py`: mã không còn trên sàn → `is_active = False`; mã quay lại → bật lại. **Chốt an toàn:** chỉ làm khi danh sách tải về có ≥ 300 cổ phiếu (một lần tải hỏng không xoá trắng).
  - `run_ticker_refresh.py` (mới): cập nhật danh sách + tải BCTC cho cổ phiếu 3 chữ cái chưa có số liệu (không gửi hàng trăm lượt gọi rỗng cho chứng quyền/ETF).
  - `financials_refresh.yml`: chạy bước này Chủ nhật, trước bước BCTC; `continue-on-error` để lỗi ở đây không làm mất bước BCTC.
- **Kiểm tra:** chạy trên SQLite tạm với dữ liệu sàn thật: VCB giữ ngành "Ngân hàng"; mã giả ZZZ và chứng quyền giả bị tắt; danh sách hỏng 1 mã → không tắt mã nào; chỉ mã 3 chữ cái vào danh sách tải BCTC.
- **Ước tính lần chạy thật đầu tiên (đọc DB thật):** thêm 294 mã — 8 cổ phiếu mới chưa từng có (BVB, DMX, DSH, DVV, ECO, LPS, MZG, VBB) + chứng quyền mới; tắt 163 mã — chứng quyền đáo hạn + 3 cổ phiếu đã rời HOSE (BCG, TCD, VNE; sẽ không còn trong ô tìm mã).
- **File:** `vnindex-valuation/collectors/ticker_list.py`, `run_ticker_refresh.py`, `.github/workflows/financials_refresh.yml`.

### 3. Day 64 — Test cho `model_valuation.py` ✅
- **Làm:** `vnindex-web/tests/` (mới, 8 test): độ trễ công bố, mốc tải giá (lấy ngày phổ biến nhất), trung bình cắt ngoại lai + trung bình theo nhóm, **bản sửa cơ sở số cổ phiếu** (DB SQLite nhỏ, công ty thưởng 1:1 → P/B phải 2,0), kẹp ROE nhóm chứng khoán (2×, ROE 8 năm, lỗ → mức sàn), BVH chỉ giữ bội số lịch sử của chính mã.
- **An toàn:** `conftest.py` ép `DATABASE_URL` sang file SQLite tạm trước mọi import → test không thể chạm DB thật.
- **Kiểm tra:** 8/8 qua. Chạy cùng bộ test trên `model_valuation.py` **cũ** (trước 2/11) → đỏ đúng chỗ: P/B ra 1,0 thay vì 2,0; kẹp chứng khoán ra 80.000 thay vì 40.000 → test bắt được lỗi thật.
- **CI:** `deploy.yml` chạy bộ test trước bước xuất; test đỏ → không deploy.
- **File:** `vnindex-web/tests/conftest.py`, `tests/test_model_valuation.py`, `.github/workflows/deploy.yml`.

### 4. Day 37 — Lint lỗi runtime trong CI ✅ (+ sửa 1 lỗi thật nó tìm ra)
- **Làm:** ruff chỉ bật nhóm lỗi gây sập khi chạy (`E9,F63,F7,F82`: cú pháp, tên chưa định nghĩa); không bật luật về kiểu viết. Thêm vào `tests.yml` (valuation) và bước test của `deploy.yml` (web). Mở rộng bộ lọc `tests.yml` để chạy cả khi `dashboard/`, `vndata/`, script gốc đổi.
- **Lỗi thật tìm ra:** `dashboard/app.py` gọi `func.max(...)` trong khi file import là `sqlfunc` → `NameError` bị `except Exception: pass` nuốt → **thông báo Strong Buy/Strong Sell cho mã trong watchlist chưa từng hiện từ 2026-07-08**. Truy vấn con còn so một cột với chính nó nên không lọc được dòng mới nhất. Viết lại bằng subquery `GROUP BY`.
- **Kiểm tra:** ruff sạch cả hai repo; truy vấn mới chạy trên SQLite tạm trả đúng dòng mới nhất mỗi mã, chỉ mã trong watchlist; `app.py` biên dịch được. `inputs.py`: thêm import cho chú thích kiểu (không phải lỗi runtime).
- **File:** `vnindex-valuation/dashboard/app.py`, `valuation/inputs.py`, `.github/workflows/tests.yml`; `vnindex-web/.github/workflows/deploy.yml`.

### 5. Day 167 — Data Quality Audit ✅
- **Làm:**
  - `vnindex-valuation/quality/audit.py` (mới): 11 quy tắc cho cổ phiếu đang niêm yết (mã 3 chữ cái): không có giá, giá chậm ≥3 phiên, giá nhảy ×3 (nghi sai đơn vị), bước giá >15% chưa điều chỉnh, không có BCTC, thiếu quý mới, tổng tài sản/vốn chủ nhảy ×20 (lỗi đơn vị), doanh thu nhảy ×1000, cân đối sai (cổ phiếu ≤0, tài sản < vốn chủ), vốn chủ âm, định giá chưa tính lại theo giá mới. `--dry-run` chỉ đọc.
  - Bảng `data_quality_log` (thêm vào `models/schema.py`; tự tạo ở lần chạy đầu, chỉ thêm bảng, không đổi bảng cũ). Mỗi lần chạy ghi 1 dòng đánh dấu + các phát hiện; tự xoá lần chạy > 60 ngày.
  - Chạy mỗi tối trong `refresh.yml`, sau bước giá + định giá; `if: always()` + `continue-on-error` → không bao giờ làm hỏng job, vẫn chạy khi job giá lỗi.
  - Web: `export_data.py` ghi `data/quality.json` từ lần chạy mới nhất; thanh bên hiện nhãn "N lỗi dữ liệu / N cảnh báo / không phát hiện lỗi", rê chuột xem từng loại.
- **Kiểm tra:**
  - 4 test mới (DB SQLite trong bộ nhớ): mỗi quy tắc bắt đúng ca của nó, mã sạch không bị báo, mã ngừng hoạt động / không phải cổ phiếu bị bỏ qua, ghi log + xoá lần chạy cũ, lần chạy sạch vẫn có dòng đánh dấu.
  - Chạy `--dry-run` trên DB thật: lần đầu ra 6 "lỗi" doanh thu — xem chi tiết thì là doanh nghiệp BĐS dồn doanh thu bàn giao (DRH ×600, CRV ×31) → tách doanh thu sang cảnh báo ×1000. Lần sau: **19 cảnh báo, 0 lỗi**: 17 mã giá cũ (có BCG, TCD đã rời sàn), TCB bước giá −33% (đợt thưởng 29/10 chưa điều chỉnh), BCG thiếu BCTC.
  - Tạo `quality.json` từ log giả 2 lần chạy → chỉ lấy lần mới nhất, bỏ dòng đánh dấu.
  - 112 test valuation + 8 test web qua; ruff sạch; JS kiểm cú pháp bằng node.
- **Chưa kiểm:** nhãn trên trình duyệt (cần lần deploy đầu sau khi audit đã chạy một lần trên CI).
- **File:** `vnindex-valuation/quality/{__init__,audit}.py`, `models/schema.py`, `tests/test_quality_audit.py`, `.github/workflows/refresh.yml`, `CLAUDE.md`; `vnindex-web/export_data.py`, `js/data.js`, `js/app.js`, `css/styles.css`.

## Tóm tắt đợt 1
5/5 mục xong, tự kiểm như trên. Thêm 1 lỗi thật tìm được và đã sửa (cảnh báo watchlist chưa từng chạy). Commit trên máy, **chưa push**.
Việc bạn cần làm: xem các mục "Chưa kiểm" ở trên; đồng ý thì tôi push (repo `vnindex-valuation` trước, rồi `vnindex-web`).

---

# Đợt 2 — định giá & chỉ số (2026-11-07)

### 1. Day 57, 59, 60, 61, 56 — PEG, Piotroski, Altman Z'', nợ ròng/EBITDA, EBIT/lãi vay, tỷ suất cổ tức ✅
- **Làm:** `vnindex-valuation/valuation/scores.py` (mới, hàm thuần): Piotroski 9 phép thử trên 2 báo cáo năm liền nhau (cần ≥7 phép thử chạy được); Altman Z'' bản cho doanh nghiệp phi sản xuất/thị trường mới nổi (vốn chủ sổ sách; ≥2,6 an toàn, 1,1–2,6 xám, <1,1 nguy hiểm); nợ ròng/EBITDA 4 quý; EBIT/lãi vay; PEG = P/E ÷ tăng trưởng lợi nhuận ròng 3 năm (không dùng EPS vì thưởng cổ phiếu làm méo); tỷ suất cổ tức = cổ tức tiền mặt năm gần nhất đã kết thúc / vốn hoá. Ngân hàng/chứng khoán/bảo hiểm: chỉ PEG + cổ tức.
- `export_data.py` tính và ghi khối `scores` vào từng `ticker/<T>.json`, thêm cột `piotroski, altman_z, net_debt_ebitda, peg, div_yield` vào `screener.json`.
- Web: thẻ mới **"Sức khoẻ tài chính & cổ tức"** dưới bảng TTM, mỗi ô có chú giải công thức + ngưỡng; Piotroski liệt kê phép thử đạt/trượt.
- **Kiểm tra:** 11 test mới (`tests/test_scores.py`). Chạy trên 403 mã (dữ liệu ở máy): Piotroski trung vị 6/9; Altman 246 an toàn, 79 xám, 32 nguy hiểm; PEG có ở 214 mã (lợi nhuận tăng). `check_tips.py`: 32 ô, chú giải khớp ngưỡng màu.
- **Lưu ý:** thưởng cổ phiếu bị Piotroski tính là "phát hành thêm" (106 mã trượt phép thử này), đã ghi trong chú giải. EBIT/lãi vay cao bất thường ở doanh nghiệp vốn hoá lãi vay (vd NVL), đã ghi trong chú giải.

### 2. Day 52, 53 — Bảng độ nhạy DCF + kịch bản bi quan / cơ sở / lạc quan ✅
- **Làm:** `model_valuation.py`: tách `_dcf_inputs()` (dòng tiền chuẩn hoá + tăng trưởng, dùng chung cho thẻ DCF và bảng); `dcf_grid()` WACC −2…+2 điểm % × tăng trưởng −4/0/+4 điểm %; `scenarios()` bi quan = nhóm phương pháp thấp nhất, lạc quan = cao nhất, cơ sở = giá mô hình. Lưu trong `model.params`.
- Web: dưới khối "Trung bình N phương pháp" có khối **Kịch bản** (3 ô) và **Độ nhạy DCF** (bảng 5×3, ô giữa = thẻ DCF).
- **Kiểm tra:** 3 test mới; ô giữa khớp đúng thẻ DCF (đã thử trên DB thật: FPT 50.826 = 50.826, GMD, REE khớp). Ngân hàng/CK/BH không có bảng (không dùng DCF).

### 3. Day 67 — Đối soát tổng 4 quý với báo cáo năm ✅
- **Làm:** quy tắc `ttm_annual_gap` (cảnh báo) trong `quality/audit.py`: năm đầy đủ gần nhất, doanh thu hoặc lợi nhuận ròng lệch >5% và >5 tỷ. Nhãn tiếng Việt trên web.
- **Kiểm tra:** 1 test mới. Trên dữ liệu ở máy: năm 2025 có ~8 mã lệch (LDG, VNE, CIG, VCG…), thường do kiểm toán điều chỉnh mà báo cáo quý không sửa.

### 4. Day 41 — Lịch nghỉ lễ VN ⏸ chưa làm
- Lý do: bộ kiểm tra đã đếm phiên từ dữ liệu thật (ngày lễ không bị tính là chậm giá); job ngày lễ chỉ lấy lại giá phiên trước, vô hại. Giá trị thấp, để sau.

### Môi trường máy
- Python 3.12 trên máy đã bị gỡ (venv `vnindex-valuation/.venv` hỏng). Test chạy bằng venv tạm trong thư mục nháp (Python 3.9 + pandas/sqlalchemy/pytest). CI dùng 3.12, sẽ chạy lại khi push.
- Test: web 11/11, valuation 117 qua (bỏ `test_macro_collector.py` vì máy thiếu `truststore`, không liên quan).

### 5. Làm lại tab Sàng lọc — Day 16, 61, 76, 83, 119, 122 ✅ (chờ bạn xem)
- **Vì sao:** bảng cũ trộn số đã điều chỉnh theo ngành với số thô trong DB (CTG "Upside" +6.310%, DCF 2 triệu ₫/cp); không lọc thanh khoản (209/403 mã < 1 tỷ/phiên); hai ô chọn ngành; thanh trượt upside −1000…+200%; biểu đồ "Backtest 2020–2025" lấy từ file tĩnh 2/9 không rõ cách tính.
- **Làm:** module mới `js/screener.js`.
  - 6 bộ lọc mẫu: Tất cả · Giá trị · Chất lượng · Cổ tức · Tăng trưởng giá hợp lý · An toàn tài chính; bấm là điền ngưỡng vào ô, thấy được vì sao mã lọt.
  - 12 ô ngưỡng min/max (thanh khoản 20 phiên, vốn hoá, upside, chất lượng, P/E, P/B, ROE, Piotroski, PEG, cổ tức, nợ ròng/EBITDA, Altman Z''); mặc định chỉ lọc thanh khoản ≥ 1 tỷ/phiên (Day 76).
  - Bảng: chỉ số đã điều chỉnh (giá mô hình = trang cổ phiếu), bấm tiêu đề để sắp xếp, mã thiếu số luôn xuống cuối; cột mã cố định khi cuộn ngang; **hạng trong ngành** theo phân vị upside + chất lượng (Day 83).
  - Bộ lọc lưu lên URL `#screen?...` (Day 122), nút sao chép liên kết; **Xuất CSV** có BOM cho Excel (Day 119).
  - Ô tín hiệu đếm theo các bộ lọc khác; biểu đồ chấm chất lượng–upside đi theo bộ lọc, bấm điểm mở mã. Gỡ biểu đồ backtest cũ và biểu đồ tròn trùng với ô tín hiệu.
  - Điện thoại: bộ lọc gập sau nút "Bộ lọc ▾ · n đang bật", ô tín hiệu 4 cột.
- `export_data.py`: thêm `adv20` (giá trị khớp bình quân 20 phiên, tỷ đồng) vào `screener.json`.
- **Kiểm tra:** chạy Edge tự động (Playwright): không lỗi JS; 6 bộ lọc mẫu ra 204/73/16/29/56/66 mã; sắp xếp + URL; mở lại liên kết khôi phục đúng 55 mã; bấm dòng mở trang cổ phiếu; điện thoại 390px không tràn ngang. `check_css.py`, `check_tips.py`, 11 test web qua.
- **Sửa trong lúc kiểm:** tham số tìm kiếm trùng tên `q` với ô "Chất lượng" → mở lại link ra 0 mã; đổi thành `t`.

---

# Đợt 3 — Backtest (Phase 10, Day 72–89) (2026-11-07)

### Vì sao làm lại từ đầu
`backtest_signals.py` cũ (nguồn của biểu đồ "Backtest 2020–2025" đã gỡ): đặt tín hiệu ở **ngày cuối quý** (BCTC 30–45 ngày sau mới có), tăng trưởng DCF lấy từ **dữ liệu hiện tại**, chỉ các mã đang niêm yết, mỗi tín hiệu là một "lệnh" riêng, không phí/thuế → không phải một danh mục có thể giao dịch.

### Làm
- `backtest_engine.py` (thuần, 12 test):
  - **Điều chỉnh giá** cho thưởng/chia tách (DB lưu giá thô): chỉ nhận khoảng nhảy khi giá đóng cửa cũng nhảy theo, và (A) >15% đứng riêng hoặc (B) >5% có sự kiện phát hành **hoặc** số cổ phiếu trong BCTC quý tăng đúng tỷ lệ; khoảng nhảy đúng bằng biên độ trần/sàn không bao giờ là quyền. Lần đầu (chỉ dựa biên độ 7,5%) ra 1.547 "quyền" — phần lớn là phiên mở cửa giảm sàn; sau sửa: 176 trên 134 mã, bắt đúng TRA 2:1, VHM 2:1, PHR, TCB ×1,48, không bắt nhầm NTC/CMG/ADG.
  - **Mô phỏng**: chia đều, đặt lệnh ở giá đóng cửa phiên sau ngày tín hiệu, phí 0,15% + trượt giá 0,1% mỗi chiều, thuế bán 0,1%, vốn 1 tỷ, lô 100 (tiền lẻ không mua được nằm lại).
  - **Chỉ số**: CAGR, biến động, Sharpe (lãi suất phi rủi ro 4,5%), sụt tối đa, Calmar, so với chuẩn, tỷ lệ quãng 3 tháng thắng VNINDEX, lợi nhuận từng năm.
- `backtest_factors.py`: chỉ số tại từng thời điểm — quý dùng từ cuối quý + 45 ngày, năm + 100 ngày; vốn hoá dùng số cổ phiếu đã chỉnh theo thưởng sau cuối quý. 10 tiêu chí: P/E thấp, P/B thấp, ROE, điểm chất lượng của app (cùng công thức), Piotroski, động lượng 12-1, biến động thấp, vốn hoá nhỏ, Giá trị+Chất lượng, Giá trị+Chất lượng+Động lượng. Lọc thanh khoản ≥ 1 tỷ/phiên (Day 76).
- `export_backtest.py`: đọc DB (chỉ đọc), VNINDEX từ VNDirect, tái cơ cấu quý (ngày 20 tháng 2/5/8/11), top-20 mỗi tiêu chí, **5 nhóm** (Day 78), **độ nhạy số mã 10/20/30/50** (Day 85), **trong mẫu ≤ 2023 / ngoài mẫu 2024+** (Day 86), danh mục hiện tại → `data/backtest.json` (thay file tĩnh cũ). Chạy ~2 phút; hằng tuần trong `refresh-slow.yml` (bước mới, có `DATABASE_URL`, `continue-on-error`).
- Web: trang mới **"Kiểm định chiến lược"** (`js/backtest.js`, Day 87): ô tóm tắt, khung giả định & giới hạn, bảng kết quả, đường vốn (chọn chiến lược, thang log, vạch ngoài mẫu), biểu đồ 5 nhóm, bảng số mã, bảng từng năm, danh mục hiện tại (bấm mã mở trang cổ phiếu).

### Kết quả (2022-05-20 → 2026-11-06, 18 lần tái cơ cấu, 195–267 mã/kỳ)
| | CAGR | So VNINDEX | Ngoài mẫu |
|---|---|---|---|
| VNINDEX | 8,1% | | 16,0% |
| Chia đều cả thị trường | 1,1% | −7,0% | 1,4% |
| Giá trị + Chất lượng + Động lượng | 12,1% | +4,0% | 19,1% |
| P/E thấp | 11,1% | +3,0% | 18,0% |
| Giá trị + Chất lượng | 10,8% | +2,7% | 11,1% |
| Điểm chất lượng của app | 5,4% | −2,7% | 8,9% |
| Piotroski | −5,5% | −13,6% | −2,8% |
- P/E thấp xếp nhóm rõ nhất: nhóm 1→5: −4,5% / −5,9% / −0,1% / 2,5% / 8,8%. Giá trị+Chất lượng: −5,3% → 10,7%.
- Không hiệu quả trên HOSE giai đoạn này: Piotroski, động lượng, vốn hoá nhỏ (mã **lớn** thắng: nhóm vốn hoá lớn nhất 8,5%/năm).
- Cổ phiếu "trung bình" thua VNINDEX 7%/năm: chỉ số bị vài mã vốn hoá lớn kéo.

### Giới hạn (ghi trên trang)
Lợi nhuận theo giá, chưa có cổ tức tiền mặt (cả chuẩn); thiên lệch sống sót (DB chỉ có mã đang niêm yết); giai đoạn ngắn (4,5 năm, trong mẫu chỉ 1,6 năm); **giá mô hình / tín hiệu Mua-Bán của app chưa kiểm định** (cần bội số lịch sử tại từng thời điểm).

### Chưa làm trong Phase 10
Day 79–84 phần sâu (đa nhân tố có trọng số, chế độ thị trường, trung lập ngành), Day 89 (thêm mã đã huỷ niêm yết — cần nguồn dữ liệu), kiểm định tín hiệu của app.
