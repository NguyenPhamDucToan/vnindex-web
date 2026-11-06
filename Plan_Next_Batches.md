# Kế hoạch làm tiếp các mục còn thiếu (từ Plan_Status_Day1-167.md)

Lập 2026-11-06. Làm theo đợt; mỗi mục: làm → tự kiểm tra → ghi vào `Plan_Worklog.md`.
Commit trên máy, **không push** cho tới khi bạn duyệt.

## Đợt 1 — giá trị cao, rủi ro thấp, không cần tài khoản ngoài (đang làm)
| # | Day | Việc | Kiểm tra bằng |
|---|---|---|---|
| 1 | 155 | Câu miễn trừ "không phải khuyến nghị đầu tư" trên web + Streamlit | mở trang, `check_css.py` |
| 2 | 5, 160 | Danh sách mã tự cập nhật hằng tuần (mã mới niêm yết tự vào) | chạy thử trên SQLite tạm |
| 3 | 64 | Test cho `model_valuation.py` (lõi định giá web) | pytest |
| 4 | 37 | Lint tối thiểu (ruff, chỉ lỗi thật: cú pháp, tên chưa định nghĩa) trong CI | ruff chạy sạch trên máy |
| 5 | 167 | Data Quality Audit: `quality/audit.py`, bảng `data_quality_log`, chạy sau job giá, badge trên web | chạy trên DB thật (chỉ đọc + ghi bảng mới), test |

## Đợt 2 — định giá & chỉ số (làm khi bạn duyệt đợt 1)
Day 57 PEG · 59 Piotroski F-score · 60 Altman Z (phi tài chính) · 61 Nợ ròng/EBITDA · 56 dividend yield ·
52 hiển thị bảng độ nhạy DCF · 53 kịch bản bear/base/bull · 67 đối soát TTM vs năm · 41 lịch nghỉ lễ VN.

## Đợt 3 — backtest (Phase 10, lớn)
Engine rebalance có phí/thuế/T+2.5, benchmark VNIndex, CAGR/Sharpe/MaxDD, lọc thanh khoản,
walk-forward + out-of-sample, test từng nhân tố. Ước vài phiên làm việc.

## Cần bạn quyết định / cung cấp trước
| Day | Việc | Cần gì |
|---|---|---|
| 35, 136 | Backup Supabase + diễn tập khôi phục | Nơi lưu backup (ví dụ GitHub artifact riêng tư / Google Drive) |
| 112–115, 123 | Đăng nhập, cảnh báo Telegram / email | Bot token Telegram, tài khoản gửi mail; web tĩnh không có đăng nhập |
| 162 | LICENSE | Bạn chọn loại (MIT / giữ bản quyền…) |
| 55 | Lãi suất phi rủi ro theo lợi suất 10 năm | Nguồn số liệu chính thức bạn muốn dùng |
| 92–96 | Scrape cafef + sentiment tiếng Việt | Có muốn scrape cafef không (điều khoản sử dụng) |
| 140–153 | ML / dự báo | Có muốn làm không — kế hoạch tự ghi "keep or drop ML" |

## Không khuyến nghị làm (trái kiến trúc hiện tại)
Day 26, 130, 131 Docker/VPS (web đang chạy Cloudflare Pages miễn phí, job chạy GitHub Actions) ·
128 partition bảng giá (bảng còn nhỏ) · 134 load test (web tĩnh) · 139 blue/green (Cloudflare đã đổi bản nguyên khối) ·
125 collector async (dễ bị VCI chặn hơn — đã gặp HTTP 418).

## Mục họp/review (⚪) — bạn làm, tôi hỗ trợ khi cần
Day 28, 40, 88, 106, 121, 137, 163, 164.
