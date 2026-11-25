# StudyHub V3.2 — Wave 6 Network Failure & Resilience Report (`NETWORK_FAILURE_REPORT.md`)

> **Auditor:** Agent 6 — Independent Functional Tester (`func-tester-2`, zero edits to `src/*` or `supabase/*`)  
> **Target:** Compiled local production server (`http://127.0.0.1:3051`) with live Supabase Cloud + Playwright network interception (`page.route`, `context.setOffline`)

---

## 1. Executive Summary

All **8 live fault-injection scenarios** (Offline/Reconnect, HTTP `429`, HTTP `500` ×2, HTTP `503` ×2, Network Timeout/Abort, and Signed-URL Expiration `500` Retry) **PASSED** with **0** uncaught `pageerror` exceptions, **0** blank screens, **0** false empty/not-found states, and **0** lost exam answers.

---

## 2. Live Fault-Injection Matrix

| # | Scenario | Route / API Intercepted | Injected Fault | Observed Behavior & Recovery Evidence | Verdict |
| :-: | :--- | :--- | :--- | :--- | :---: |
| **1** | **HTTP `429` Rate Limit** | `/library` (`GET /api/sets`) | `429 RATE_LIMITED` (`Retry-After: 1`) | Displays localized rate-limit error card with visible **Thử lại (Retry)** button (`lib429HasRetry: true`). Clicking Retry after clearing fault loads study sets cleanly (`libRecovered429: true`). | **PASS** |
| **2** | **HTTP `500` Folder Load (`V32-037` / `FUNC-26`)** | `/folders/[id]` (`GET /api/folders`) | `500 INTERNAL_ERROR` | Renders explicit localized Error + Retry state instead of false `"Không tìm thấy thư mục"` (`folderNotFalseNotFound: true`, `folderRetryVisible: true`). Retry loads `"W6 Mobile Folder"` cleanly (`folderRecovered: true`). | **PASS** |
| **3** | **HTTP `500` Reports Inbox (`V32-037` / `FUNC-26`)** | `/sets/[id]/edit` -> `Báo cáo lỗi` (`GET /api/reports`) | `500 INTERNAL_ERROR` (2 hits incl. RQ `retry: 1`) | Renders explicit localized error (`"Không thể tải danh..."`) + Retry button instead of false `"Không có báo cáo nào"` (`reportsErrorShown: true`). Retry recovers to clean empty inbox (`reportsRecovered: true`). | **PASS** |
| **4** | **HTTP `503` Active Exam Autosave** | `/exams/[attemptId]` (`PUT /api/exams/[id]/answers`) | `503 SERVICE_UNAVAILABLE` | Top bar immediately surfaces error state (`"Thoát 1 / 4 Lỗi lưu Thử lại 29:58..."`, `save503Count: 1`, `showedSaveErrorOn503: true`) while preserving answer synchronously in `localStorage`. Clearing `503` flushes dirty queue & restores `"Đã lưu"`. | **PASS** |
| **5** | **HTTP `503` Exam Submit Retry** | `/exams/[attemptId]` (`POST /api/exams/[id]/submit`) | `503 SERVICE_UNAVAILABLE` on 1st submit | Stays safely on `/exams/[attemptId]` with all answers intact (`submit503Hits: 1`, `stayedOnExamAfter503: true`), shows error feedback, and 2nd submit navigates cleanly to `/exams/[attemptId]/results` (`recoveredSubmitAfter503: true`). | **PASS** |
| **6** | **Network Timeout / Abort** | `/library` (`GET /api/sets?...`) | `route.abort("timedout")` | UI settles out of loading state into explicit Error + Retry UI with zero permanent spinner freeze (`abortHasRetry: true`). Clearing fault & clicking Retry loads sets cleanly (`abortRecovered: true`). | **PASS** |
| **7** | **Offline Mid-Exam -> Reconnect + Reload (`V32-005`)** | `/exams/[attemptId]` | `context.setOffline(true)` -> answer Q1 -> `setOffline(false)` -> reload | Offline badge displays `"Ngoại tuyến"` (never falsely `"Đã lưu"`, `notFalselySavedOffline: true`). On reconnect + reload with ZERO clicks, `LiveExamRunner` immediately fires `PUT /api/exams/[id]/answers` (`autoFlushPuts: 2`), persists answer to DB (`savedCountAfterAutoFlush: 1`), and transitions badge to `"Đã lưu"`. | **PASS** |
| **8** | **Signed-URL `500` 1-Shot Retry (`V32-036` / `FUNC-25`)** | `/sets/[id]` (`GET /api/uploads/signed-url`) | `500` on 1st image fetch | `useResilientImage` automatically retries once with `&_r=` cache-bust parameter (`sawCacheBustRetry: true`, `signedUrlCalls: 3`) and renders image without broken-icon freeze. | **PASS** |

---

## 3. Uncaught Exception & Console Hygiene

- `netPageErrors` across all fault injections: **`0`**.
- Login VI network/auth error localization (`V32-040` / `FUNC-29(2)`): Intercepting `/auth/v1/token` with `400 Email not confirmed` rendered localized Vietnamese alert `"Email của bạn chưa được xác nhận. Vui lòng kiểm tra hộp thư để kích hoạt tài khoản."` (`loginErrLocalized: true`).
