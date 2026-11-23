# Hướng dẫn cho Claude Code trong repo Exchangethings.vn

@AGENTS.md

## Bắt đầu mỗi mốc

Đọc `PLAN.md`, `SPEC.md`, `DECISIONS.md` trước khi làm. Mỗi mốc có tiêu chí "Xong khi" trong PLAN; chưa đạt thì chưa báo xong.
Quyết định khó đảo ngược hoặc lệch SPEC thì ghi thêm một dòng D-xx vào `DECISIONS.md`.

## Quy ước kỹ thuật

- Next.js 16 bật Cache Components: phần đọc cookie, phiên đăng nhập hoặc database nằm trong `<Suspense>`; `getSessionUserId()` đã gọi `connection()`.
  Không dùng `Date.now()`, `new Date()` ở phần prerender; gọi sau `getViewer()` hoặc `connection()`.
- Truy vấn dữ liệu của người dùng đi qua `withActor()` (src/server/db.ts) để RLS áp dụng. Chỉ dùng `elevate()` cho thao tác chỉ server
  được làm (ghi item_media sau khi xóa EXIF), và chỉ sau khi đã kiểm tra sở hữu dưới quyền người dùng.
- Mỗi Server Action và Route Handler tự kiểm tra phiên; không tin dữ liệu từ form ngoài id.
- Migration mới đặt trong `supabase/migrations/`, kèm test RLS trong `tests/db/`. File sinh tự động (seed, địa giới) chỉ sửa qua script.
- Trước khi commit: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

## Văn phong giao diện

Tiếng Việt tự nhiên, ngắn; tiền dạng `13.000.000 ₫`; không dùng dấu gạch ngang dài (—) trong câu chữ.
