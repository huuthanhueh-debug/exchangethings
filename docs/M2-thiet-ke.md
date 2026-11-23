# M2: quẹt, khớp, chat (bản thiết kế làm việc)

Phạm vi theo PLAN: chồng thẻ, bộ lọc, điểm gợi ý; tạo match; hiệu ứng khớp; chat có che SĐT và số tài khoản.
Xong khi: unit test điểm gợi ý pass; e2e "hai người thích nhau thì khớp" pass.

## Database (migration mới `20261123000100_m2_swipe_match_chat.sql`, không sửa migration cũ)

- `swipe_item(item, direction)` SECURITY DEFINER: kiểm tra món đang hiển thị, không phải món mình, không bị chặn hai chiều,
  giới hạn 300 lượt/24 giờ (platform_settings.rate_limits). Thích mà bên kia đã thích một món của mình thì tạo `matches`
  (user_a < user_b; item_a là món của user_a, item_b là món của user_b). Trả `{matched, match_id, is_new}`.
- `deck_item_ids(bộ lọc, limit)` SECURITY DEFINER: món đang hiển thị, trừ món mình, món đã quẹt, người bị chặn hai chiều.
- `send_message(match, body)`: chỉ hai người trong match; 200 tin/24 giờ; nội dung đi qua `mask_contacts()` trước khi lưu.
  Chỉ lưu bản đã che (cột `masked` = có che hay không): API của Supabase đọc thẳng bảng nên không lưu bản gốc.
- `mask_contacts(text)`: chuẩn hóa NFKC, bỏ ký tự vô hình; che mọi liên kết, số điện thoại VN (kể cả viết cách),
  dãy 9 đến 16 chữ số liền (số tài khoản). Số tiền có dấu chấm ("13.000.000") không bị che.
- Bảng mới `match_reads(match_id, user_id, last_read_at)` cho số tin chưa đọc; `mark_match_read(match)`.
- RLS: swipes đọc của mình; matches và messages chỉ hai người trong match (admin chưa đọc, M5 mở theo báo cáo);
  blocks đọc/ghi của mình; notifications đọc của mình. Không ai ghi thẳng swipes, matches, messages.
- Hàm mới phải thu hồi quyền gọi mặc định rồi cấp cho `authenticated`; cập nhật danh sách cho phép ở
  `scripts/lib/db-tools.mjs` (doctor) và `tests/db/hardening.test.ts`; chạy `pnpm db:setup-sql`.

## Điểm gợi ý (SPEC mục 8), hàm thuần ở `src/lib/matching.ts`

`score = 0,35 × wants_fit + 0,25 × value_balance + 0,20 × proximity + 0,20 × trust` (trọng số đọc từ platform_settings).
- wants_fit = trung bình hai chiều; mỗi chiều: món cụ thể 1; danh mục 0,7; từ khóa 0,4; không khớp 0.
  Chiều A: mong muốn trên các món của người xem so với món đang xét. Chiều B: mong muốn của món đang xét so với món của người xem.
- value_balance = 1 − min(1, lệch còn lại / max(hai giá trị)); lệch còn lại = chênh lệch − mức bù khả thi
  (min của "bên giá thấp chịu bù tối đa" và "bên giá cao chịu nhận tối đa").
- Người xem có nhiều món: lấy món cho tổng (wants + value) cao nhất. Chưa có món: wants_fit 0, value_balance 0,5.
- proximity: đồ số và dịch vụ online 1; cùng tỉnh/thành 1; cùng miền 0,6; khác miền hoặc thiếu thông tin 0,3.
- Mốc kiểm tra: An xem iPhone 18 của Bình ra 0,85 / 0,94 / 0,3 / 0,92, tổng khoảng 0,78. Seed đổi mong muốn cho khớp ví dụ:
  iPhone 15 của An muốn đúng món iPhone 18 của Bình; iPhone 18 của Bình muốn danh mục điện thoại.
- Lấy tối đa 200 ứng viên mới nhất theo bộ lọc, chấm điểm ở server, trả 20 thẻ điểm cao nhất.

## Giao diện

- `/quet`: chồng thẻ (kéo, nút X và tim, phím mũi tên trái/phải, tôn trọng prefers-reduced-motion), bộ lọc qua URL
  (loại, danh mục, khoảng giá trị, tỉnh/thành, "chỉ món hợp với đồ tôi có"), hiệu ứng "Khớp rồi!".
- `/khop`: danh sách khớp kèm tin cuối và số chưa đọc. `/khop/[id]`: chat, tự tải tin mới mỗi 3 giây (polling:
  chạy được ở mọi môi trường, kể cả pooler; nâng lên Supabase Realtime sau), ghi chú an toàn, báo khi tin bị che.
- Trang món: nút "Quan tâm" cho người đã đăng nhập (cùng hàm swipe). "Đề nghị đổi" để M3.
- Điều hướng: Quẹt, Khớp, Đăng món, Món của tôi, Tôi.

## Kiểm thử

- Unit: `src/lib/matching.ts` (mốc SPEC và ca biên). DB: swipe, khớp, giới hạn, chặn, RLS tin nhắn, che liên lạc.
- E2E trong repo (Playwright, `tests/e2e`): An thích iPhone 18, Bình thích iPhone 15, hiện "Khớp rồi!", chat, tin có SĐT bị che.
