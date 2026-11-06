# Rà soát kế hoạch Day 1 → 167 — đã có gì, chưa có gì

Rà ngày 2026-11-06 trên cả hai repo: **V** = `vnindex-valuation` (dữ liệu, định giá, Streamlit), **W** = `vnindex-web` (trang tĩnh).
Mỗi dòng ghi trạng thái kèm bằng chứng tìm thấy trong code (file / hàm), để bạn kiểm lại.

✅ Có · 🟡 Một phần / làm khác kế hoạch · ❌ Chưa có · ⚪ Mục họp/review — không kiểm bằng code được

**Tổng 167 mục: ✅ 41 · 🟡 43 · ❌ 75 · ⚪ 8** (lúc rà 2026-11-06) → **sau đợt 1: ✅ 46 · 🟡 40 · ❌ 73 · ⚪ 8** (Phase 1–7 gần như xong; từ Phase 10 trở đi phần lớn chưa làm.)

## Phase 1–2 — Setup & nguồn dữ liệu
| Day | Mục | | Bằng chứng / ghi chú |
|---|---|---|---|
| 1 | venv, requirements, scaffold | ✅ | V: `requirements.txt`, `.venv`, `collectors/ models/ valuation/ dashboard/` |
| 2 | config.py + .env | ✅ | V `config.py`: `TZ` Asia/Ho_Chi_Minh, `SETTLEMENT_DAYS = 2.5`, `FIREANT_API_KEY` qua dotenv. Không có key SSI. |
| 3 | Smoke-test vnstock | ✅ | Đã làm từ đầu; **vnstock nay đã bị thay bằng `vndata`** (V `vndata/`, 2026-11-01). |
| 4 | FireAnt + cafef | 🟡 | FireAnt chỉ có URL/key trong `config.py`, không collector nào dùng. Không có gì cho cafef. |

## Phase 3–4 — Thu thập & lưu trữ
| Day | Mục | | Bằng chứng / ghi chú |
|---|---|---|---|
| 5 | ticker_list.py | ✅ | Có sàn, ngành, tên; **chạy hằng tuần từ 2026-11-06** (`run_ticker_refresh.py`). Chưa có nhóm vốn hoá (cap bucket). |
| 6 | prices.py | 🟡 | 5 năm OHLCV có. `adjusted_close = close` (không phải giá điều chỉnh thật); không xử lý mã huỷ niêm yết; không có cache JSON thô. |
| 7 | financials.py | ✅ | V `financials.py` + schema: revenue, EBIT, NI, EPS, assets, equity, debt, cash, `operating_cf`, `capex`, `fcf`; 20 quý (> 8 trong plan). |
| 8 | Backfill 400 mã | ✅ | V `bulk_load.py`: throttle, log lỗi, chạy tiếp (tải từ ngày cuối đã lưu). |
| 9 | schema.py | ✅ | 6 bảng (companies, prices, financials, valuations, pinned_tickers, macro_indicators) + index. |
| 10 | Upsert | ✅ | `UniqueConstraint` + upsert trong `prices.py`, `financials.py`. |
| 11 | Incremental update | ✅ | `incremental_start_date()`; việc nặng chạy trên GitHub Actions, không trong dashboard. |

## Phase 5–7 — Định giá, dashboard, go-live
| Day | Mục | | Bằng chứng / ghi chú |
|---|---|---|---|
| 12 | P/E, P/B, TTM EPS | ✅ | V `valuation/ratios.py`, `multiples.py`, `inputs.compute_ttm` |
| 13 | EV/EBITDA | ✅ | Có, bank = n/a |
| 14 | Graham | ✅ | `valuation/graham.py` |
| 15 | DCF + bảng valuations | ✅ | `valuation/dcf.py`, `compute_valuations.py` (dùng WACC thay vì 8,5% cố định) |
| 16 | View Market Overview + Screen | ✅ | Streamlit (treemap `heatmap_component`) và W (trang Tổng quan, Sàng lọc) |
| 17 | Drilldown + Watchlist | ✅ | `load_watchlist_data()` (DCF>20%, FCF>0); W trang Phân tích cổ phiếu |
| 18 | Unit test + backtest | ✅ | 109 test pytest; `backtest_signals.py` |
| 19 | Streamlit Cloud | ✅ | `.streamlit/`, `keep_alive.yml` |
| 20 | SQLite → Supabase | 🟡 | `migrate_to_supabase.py`, `pool_pre_ping` có. **Không có BetterStack** (thay bằng `keep_alive.yml` mở trình duyệt). |
| 21 | Giá realtime + GH Actions | ✅ | `live_quote.py`; `refresh.yml` (09:03 UTC, không phải 07:50) |
| 22 | loguru | ✅ | loguru ở mọi collector, log từng mã |
| 23 | Badge dữ liệu cũ | ✅ | W `.stale-tag`/`.stale-note`; Streamlit cảnh báo dữ liệu cũ |
| 24 | Retry | ✅ | `vndata/_http.py` (retry + circuit breaker), `vnstock_call()` |
| 25 | APScheduler | 🟡 | `scheduler.py`/`daily_refresh.py` có, nhưng chạy thật là GitHub Actions; tác vụ trên máy đã tắt. |
| 26 | Docker | ❌ | Không có Dockerfile / compose |

## Phase 8 — Ổn định
| Day | Mục | | Bằng chứng / ghi chú |
|---|---|---|---|
| 27 | Smoke test / bug bash | ✅ | W `audit_all.py`, `audit_lines.py`, `audit_text.py`, `compare_to_original.py` |
| 28 | Sửa top-10 bug | ⚪ | Lịch sử commit có rất nhiều bản sửa, nhưng không có danh sách "top 10" |
| 29 | Profiling Streamlit | 🟡 | Nhiều chú thích PERF, cache trong `app.py`; không có báo cáo đo |
| 30 | Index & tuning SQL | 🟡 | Index có; không thấy dấu EXPLAIN |
| 31 | Pre-compute màn hình | ✅ | Bảng `valuations` + toàn bộ web là JSON tính sẵn |
| 32 | Empty states | ✅ | W: biểu đồ thiếu dữ liệu thì ẩn, có câu thông báo |
| 33 | Mobile | ✅ | W: sửa riêng cho màn 390px (hover label, cuộn ngang) |
| 34 | Config hardening dev/prod | ❌ | |
| 35 | Backup Supabase | ❌ | Không có pg_dump |
| 36 | Runbook | 🟡 | CLAUDE.md hai repo + `TRANG-THAI.md`; không có runbook riêng |
| 37 | CI pytest | ✅ | `tests.yml` chạy khi push và PR; ruff (lỗi runtime) thêm 2026-11-06 |
| 38 | Pre-commit | ❌ | |
| 39 | mypy strict | ❌ | Có type hint rải rác, không có mypy |
| 40 | Review & backlog | ⚪ | |
| 41 | Timezone / ngày lễ | 🟡 | Múi giờ ICT có; **không có lịch nghỉ lễ VN** |
| 42 | Chia tách / thưởng cổ phiếu | ✅ | `shares.py` (số cổ phiếu hiện hành), `adjust_corporate_actions()` khi xuất, sửa cơ sở số cổ phiếu cho bội số lịch sử (2026-11-02) |
| 43 | Log rotation | 🟡 | Chỉ `daily_refresh.py` (chạy trên máy, đã tắt) |

## Phase 9 — Định giá chuyên sâu
| Day | Mục | | Bằng chứng / ghi chú |
|---|---|---|---|
| 44 | Ngân hàng P/B–ROE | ✅ | W `model_valuation.justified_pb_price`, nhánh ngân hàng riêng |
| 45 | NIM, NPL, CAR, LDR | 🟡 | NIM, LDR, CIR có (W `sector-metrics.js`, `app.js`). **NPL, CAR không có** (nguồn không có số) — thay bằng "số năm dự phòng" |
| 46 | RI cho ngân hàng | ✅ | `rim_fade_price(clean_surplus=True)`, Ke theo CAPM |
| 47 | Bảo hiểm & chứng khoán | ✅ | Nhánh riêng; sửa BVH (nhân thọ) và P/B CK theo ROE 8 năm (2026-11-02) |
| 48 | BĐS NAV / sổ sách | 🟡 | Chỉ proxy 1,8× sổ sách; không có NAV |
| 49 | DDM cho tiện ích | ❌ | |
| 50 | Bội số tương đối ngành | ✅ | `sector_multiple()`, `justified_sector_pb()` |
| 51 | Dải P/E, P/B lịch sử | ✅ | W `valuationBandSection` |
| 52 | Bảng độ nhạy DCF | 🟡 | `dcf.sensitivity_grid()` có nhưng **không hiển thị ở đâu**; ngân hàng có dải `pb_lo`/`pb_hi` |
| 53 | Kịch bản bear/base/bull | ❌ | |
| 54 | Ước lượng tăng trưởng | 🟡 | `annual_fcff_growth()` (CAGR); không có hồi quy / cắt ngoại lai |
| 55 | WACC | 🟡 | Beta theo VNINDEX có; **lãi suất phi rủi ro cố định 5%**, không lấy lợi suất 10 năm |
| 56 | Cổ tức, payout | 🟡 | Payout và biểu đồ cổ tức có; không có dividend yield, không tách tiền/cổ phiếu |
| 57 | PEG | ❌ | |
| 58 | ROE / ROIC / DuPont | ✅ | W `dupontSection`, `roicSection` |
| 59 | Piotroski F-score | ❌ | |
| 60 | Altman Z | ❌ | |
| 61 | Nợ ròng/EBITDA, interest coverage | 🟡 | `cash_interest_coverage` có (Streamlit); nợ ròng/EBITDA không thấy |
| 62 | Điểm định giá tổng hợp | ✅ | `_family_mean()` (3 nhóm phương pháp) + điểm chất lượng / tín hiệu |
| 63 | Đối chiếu cafef 30 mã | 🟡 | Đã đối chiếu 20 mã với SSI Research (2026-11-02), không phải cafef |
| 64 | Test cho module mới | ✅ | `test_wacc`, `test_signals`…; `vnindex-web/tests/` cho `model_valuation.py` (2026-11-06) |
| 65 | Docs / methodology | 🟡 | README, CLAUDE.md, ghi chú trên panel; không có trang phương pháp |
| 66 | Bảng lịch sử số cổ phiếu | 🟡 | Số cổ phiếu theo quý trong `financials` + số hiện hành; không có bảng riêng |
| 67 | Đối soát TTM vs năm | ❌ | |
| 68 | Backfill lịch sử định giá | 🟡 | `valuation_history` chỉ tích luỹ theo ngày chạy; không tính lại cho quá khứ |

## Phase 10 — Backtest
| Day | Mục | | Bằng chứng / ghi chú |
|---|---|---|---|
| 69 | Point-in-time financials | 🟡 | Giả định trễ công bố 45 ngày (`_PUBLISH_LAG_DAYS`); không có ngày công bố thật |
| 70 | Thu ngày công bố BCTC | ❌ | |
| 71 | Backtest engine v2 | 🟡 | `backtest_signals.py`: lợi nhuận kỳ sau theo tín hiệu; không có rebalance/holdings |
| 72 | Phí, thuế, T+2.5 | ❌ | |
| 73 | Total return có cổ tức | ❌ | |
| 74 | Benchmark VNIndex/VN30 | ❌ | |
| 75 | CAGR, Sharpe, max DD | ❌ | |
| 76 | Lọc thanh khoản | ❌ | |
| 77 | Walk-forward 2019–2025 | ❌ | |
| 78 | Test từng nhân tố (quintile) | ❌ | |
| 79 | Đa nhân tố | ❌ | |
| 80 | Momentum 12-1 | ❌ | |
| 81 | Low-vol | ❌ | |
| 82 | Size effect | ❌ | |
| 83 | Sector-neutral | ❌ | |
| 84 | Regime 2022 | ❌ | |
| 85 | Robustness ngưỡng | ❌ | |
| 86 | Out-of-sample | ❌ | |
| 87 | View backtest | 🟡 | W hiển thị kết quả tĩnh từ `data/backtest.json`; không tương tác |
| 88 | Báo cáo Phase 10 | ⚪ | |
| 89 | Survivorship bias | ❌ | |
| 90 | Slippage | ❌ | |
| 91 | Xuất báo cáo backtest | ❌ | |

## Phase 11 — Tin tức & dữ liệu thay thế
| Day | Mục | | Bằng chứng / ghi chú |
|---|---|---|---|
| 92 | Scraper tin cafef | 🟡 | Tin lấy từ VCI (`export_detailed.fetch_news_events`), không scrape cafef |
| 93 | Bảng news | 🟡 | Lưu trong JSON từng mã, không có bảng DB |
| 94 | Làm sạch tiếng Việt | ❌ | |
| 95 | Sentiment lexicon | ❌ | |
| 96 | PhoBERT | ❌ | |
| 97 | Tin trong drilldown | ✅ | W "Tin tức & Sự kiện"; Streamlit `load_news` |
| 98 | Sự kiện quyền | ✅ | Events VCI (cổ tức, phát hành, GDKHQ) |
| 99 | Điều chỉnh giá theo sự kiện | 🟡 | Chỉ điều chỉnh bước nhảy >15% lúc xuất; DB không có giá điều chỉnh thật |
| 100 | Khối ngoại | ✅ | `fetch_foreign()` (VNDirect) |
| 101 | Biểu đồ khối ngoại | ✅ | W `foreignSection` |
| 102 | Cổ đông lớn / nội bộ | 🟡 | Cổ đông + ban lãnh đạo có; giao dịch nội bộ chỉ hiện như sự kiện |
| 103 | Vĩ mô: lãi suất, tỷ giá, CPI | ✅ | `macro_collector.py`, `worldbank_collector.py`, tỷ giá VNDirect |
| 104 | Panel vĩ mô | 🟡 | W trang Vĩ mô có; **không overlay lên VNIndex** |
| 105 | Sentiment × định giá | ❌ | |
| 106 | Review Phase 11 | ⚪ | |
| 107 | ĐHCĐ / kế hoạch cổ tức | 🟡 | Sự kiện ĐHCĐ có trong danh sách events; không tổng hợp guidance |
| 108 | Event study | ❌ | |

## Phase 12 — Danh mục & cảnh báo
| Day | Mục | | Bằng chứng / ghi chú |
|---|---|---|---|
| 109 | Bảng danh mục & CRUD | 🟡 | W portfolio trong localStorage (đã ẩn khỏi menu, vào bằng `#portfolio`); không có DB, không có lô |
| 110 | View danh mục | 🟡 | Cùng chỗ trên: lãi/lỗ + upside từng mã |
| 111 | Lưu watchlist | ✅ | `pinned_tickers` (Streamlit), W localStorage |
| 112 | Đăng nhập | ❌ | |
| 113 | Rule cảnh báo | ❌ | |
| 114 | Telegram | ❌ | |
| 115 | Email | ❌ | |
| 116 | Position sizing | ❌ | (Có skill risk-management của Claude, không nằm trong app) |
| 117 | Gợi ý rebalance | ❌ | |
| 118 | Lịch cổ tức danh mục | ❌ | |
| 119 | Xuất Excel/CSV | 🟡 | Streamlit `build_excel_export()`; web không có |
| 120 | PDF tear sheet | ❌ | |
| 121 | User testing | ⚪ | |
| 122 | Bộ lọc qua URL | 🟡 | `?ticker=` (W), `?view=&ticker=` (Streamlit); bộ lọc sàng lọc không lưu lên URL |
| 123 | Tuỳ chọn thông báo | ❌ | |

## Phase 13 — Hạ tầng
| Day | Mục | | Bằng chứng / ghi chú |
|---|---|---|---|
| 124 | Việc nặng ra khỏi dashboard | ✅ | GitHub Actions + web tĩnh |
| 125 | Collector async | ❌ | (Refresh đã nhanh 70→~15 phút nhờ bỏ vnstock, nhưng vẫn tuần tự) |
| 126 | Quản lý rate-limit | ✅ | `vndata/_http.py`: retry, circuit breaker theo host, dừng khi 401/403/418 |
| 127 | Đối soát hai nguồn | 🟡 | VCI → SSI dự phòng; không có báo cáo chênh lệch |
| 128 | Partition bảng giá | ❌ | |
| 129 | Đánh giá rời Supabase free | ❌ | |
| 130 | Docker prod stack | ❌ | |
| 131 | Deploy VPS | 🟡 | Làm khác: web trên Cloudflare Pages, không có VPS |
| 132 | Monitoring | 🟡 | `vndata_smoke.yml`, sanity check trong deploy, email lỗi của GitHub; không có Healthchecks/Grafana |
| 133 | Log tập trung | ❌ | |
| 134 | Load test | ❌ | (web tĩnh, ít cần) |
| 135 | Security review | ❌ | |
| 136 | DR drill | ❌ | |
| 137 | Review hạ tầng | ⚪ | |
| 138 | Dọn chi phí | ❌ | |
| 139 | Zero-downtime deploy | 🟡 | Cloudflare Pages tự đổi bản nguyên khối |

## Phase 14 — Dự báo & ML
| Day | Mục | | Bằng chứng / ghi chú |
|---|---|---|---|
| 140–153 | Feature store, nhãn 12 tháng, ridge, LightGBM, dự báo lợi nhuận, mùa vụ, anomaly, clustering, SHAP, registry, drift… | ❌ | Không có thư viện ML nào (sklearn, lightgbm, shap) trong hai repo |

## Phase 15–16 — Hoàn thiện & vận hành
| Day | Mục | | Bằng chứng / ghi chú |
|---|---|---|---|
| 154 | UX polish | ✅ | Web đã qua nhiều lượt chỉnh giao diện |
| 155 | Trang phương pháp & miễn trừ | 🟡 | Ghi chú phương pháp trên panel; câu miễn trừ trên web + Streamlit (2026-11-06); chưa có trang phương pháp riêng |
| 156 | Coverage >80% | ❌ | Không đo coverage |
| 157 | MkDocs | ❌ | |
| 158 | Data dictionary | ❌ | |
| 159 | BCTC năm & điều chỉnh kiểm toán | 🟡 | `run_financials_refresh.py` tải lại kỳ bị điều chỉnh (ví dụ BMI) |
| 160 | Huỷ niêm yết / IPO | ✅ | `run_ticker_refresh.py` hằng tuần: mã mới vào + tải BCTC, mã rời sàn tắt (2026-11-06) |
| 161 | Performance regression test | ❌ | |
| 162 | Open-source / license | 🟡 | Repo đã public, **không có file LICENSE** |
| 163 | Retrospective | ⚪ | |
| 164 | Roadmap 6 tháng | ⚪ | |
| 165 | Song ngữ VN/EN | ❌ | Chỉ tiếng Việt |
| 166 | Release tag v1.0 | ❌ | Không có git tag nào |
| 167 | Data Quality Audit | ✅ | Làm 2026-11-06: `quality/audit.py`, bảng `data_quality_log`, chạy mỗi tối trong `refresh.yml`, nhãn trên web (xem `Plan_Worklog.md`). |
