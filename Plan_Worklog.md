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
