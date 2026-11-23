# Exchangethings.vn

Sàn đổi đồ kiểu quẹt thẻ cho người Việt: điện thoại, thời trang, file số, mã khóa học, voucher, dịch vụ. Hai bên cùng đồng ý mới đổi; tiền bù được giữ qua trung gian tới khi cả hai nhận đủ.

Tài liệu gốc: [PLAN.md](PLAN.md) (các mốc), [SPEC.md](SPEC.md) (đặc tả), [DECISIONS.md](DECISIONS.md) (nhật ký quyết định), [wireframes/](wireframes/index.html).

## Trạng thái

| Mốc | Nội dung | Trạng thái |
|---|---|---|
| M0 | Kế hoạch, đặc tả, wireframe | Đã duyệt 22/11/2026 |
| M1 | Nền móng: database, phân quyền, đăng nhập, hồ sơ, đăng món 6 loại, ảnh xóa EXIF | **Đã duyệt 22/11/2026** |
| M2 | Quẹt, khớp, chat | Chưa làm |
| M3 đến M6 | Đề nghị, giao dịch, đánh giá, admin, ra mắt | Chưa làm |

### M1 gồm

- **Database**: toàn bộ bảng của SPEC mục 11, Row Level Security trên mọi bảng, dữ liệu 34 tỉnh/thành và 3.321 phường/xã (hiệu lực 01/07/2025), 27 danh mục, từ khóa cấm, cấu hình nền tảng.
- **Dữ liệu mẫu**: 10 người dùng cho hai phía của 5 kịch bản, 1 admin, 30 món đủ 6 loại ở 6 tỉnh/thành. Chạy lại cho cùng kết quả.
- **Đăng nhập**: link qua email và Google (Supabase Auth); máy dev đăng nhập bằng người dùng mẫu.
- **Hồ sơ**: tên, giới thiệu, tỉnh/thành, phường/xã, số di động (chưa xác minh OTP), hạng uy tín.
- **Đăng món 6 loại**: mỗi loại có trường bắt buộc riêng (IMEI cho điện thoại, chứng từ cho hàng hiệu, hạn dùng cho mã và voucher, thời lượng cho dịch vụ); lưu nháp, đăng, sửa, gỡ; danh sách điều kiện còn thiếu.
- **Ảnh**: xoay đúng chiều, xóa toàn bộ EXIF và vị trí GPS, lưu WebP 1600px kèm bản 480px; ảnh chứng từ chỉ chủ món và admin xem.
- **Kiểm duyệt**: từ khóa cấm chặn đăng, từ khóa cần xem lại và loại "Khác" chờ admin duyệt.

Chưa có trong M1 (theo PLAN): quẹt và khớp (M2), đề nghị và cán cân (M3), giao dịch, ký quỹ, két số (M4), giao diện admin, xác minh số điện thoại bằng OTP.

## Chạy trên máy

Cần: Node.js 20.9 trở lên (khuyên dùng 22), pnpm 10, PostgreSQL 16 chạy ở `localhost:5432` (user `postgres`, mật khẩu `postgres`; khác thì đặt `DATABASE_ADMIN_URL`).

```bash
pnpm install
cp .env.example .env.local     # điền DEV_AUTH_SECRET (lệnh tạo có trong file)
pnpm db:reset                  # tạo database exchangethings_dev: shim + migrations + dữ liệu mẫu
pnpm db:seed:media             # sinh ảnh minh họa cho dữ liệu mẫu vào .data/storage
pnpm dev                       # mở http://localhost:3000, đăng nhập bằng một người dùng mẫu
```

`pnpm db:reset` xóa và dựng lại database đích, và chỉ chạy với Postgres ở localhost.

## Kiểm tra

| Lệnh | Việc |
|---|---|
| `pnpm test` | 225 test: phân quyền RLS, đăng món, bộ lọc từ khóa, chống lách sau rà soát độc lập, công cụ cài database, seed chạy lại cho cùng kết quả, lớp service trên database thật, unit test. Tự dựng database `exchangethings_test` |
| `pnpm test:unit` | Chỉ unit test, không cần Postgres |
| `pnpm typecheck` | Kiểm tra kiểu TypeScript |
| `pnpm lint` | ESLint (gồm quy tắc accessibility và React Compiler) |
| `pnpm build` | Build production; không cần biến môi trường |

CI (GitHub Actions) chạy đủ 4 bước trên với Postgres 16 ở mỗi lần push và pull request.

## Cấu trúc

```
supabase/migrations/   schema, RLS, dữ liệu tham chiếu, địa giới hành chính (file cuối sinh từ script)
supabase/seed.sql      dữ liệu mẫu (sinh từ scripts/generate-seed.mjs, không sửa tay)
data/admin-units/      dữ liệu gốc 34 tỉnh/thành, 3.321 phường/xã kèm nguồn
scripts/               dựng lại database, sinh seed, sinh ảnh minh họa, sinh migration địa giới
src/server/            chỉ chạy ở server: kết nối database theo vai trò, phiên đăng nhập, ảnh, lưu tệp, nghiệp vụ món
src/lib/               dùng chung: định dạng VND, số điện thoại, IMEI, 6 loại món, validation
src/app/               trang và Server Action (đường dẫn tiếng Việt: /dang-mon, /mon-cua-toi, /ho-so)
src/proxy.ts           làm mới phiên Supabase, chuyển hướng trang cần đăng nhập
tests/                 test database (db/), unit (unit/), file sinh tự động (data/)
```

## Kiến trúc và bảo mật

- **Phân quyền ở database**: mọi truy vấn của người dùng chạy trong transaction đã đặt vai trò và JWT claims như Supabase làm, nên RLS áp dụng y hệt; bộ test dùng đúng cơ chế này (DECISIONS D-23).
- **Dữ liệu riêng tư tách bảng**: số điện thoại, IMEI đầy đủ chỉ chủ sở hữu và admin đọc được (D-18).
- **Mọi lớp tự kiểm tra lại**: proxy chặn sớm, mỗi trang và Server Action tự xác thực, RLS là lớp cuối.
- **Ảnh chỉ server ghi**, sau khi xóa metadata (D-20); kiểm định dạng thật từ nội dung tệp.
- Bộ lọc từ khóa so khớp nguyên từ trên văn bản đã chuẩn hóa (D-21, D-27); các cách lách kiểm duyệt đã bị chặn và có test (D-22).
- Đã qua một lượt rà soát độc lập trước khi lên mạng, vá cả 8 phát hiện (D-27). Hồ sơ chỉ lộ cột công khai (D-28).
- Việc còn lại trước khi mở cho khách được liệt kê ở D-29: tài khoản database quyền tối thiểu, tắt Data API, giới hạn tần suất.
- Kết nối database ở xa luôn mã hóa TLS và kiểm tra chứng chỉ (kèm sẵn CA gốc của Supabase).
- Không có khóa bí mật trong code; header bảo mật cơ bản trên mọi trang.

## Đưa lên online (không cần token Supabase, không cần dòng lệnh)

1. **Supabase**: tạo project mới, vùng Singapore, tự đặt mật khẩu database.
2. **Cài database**, chọn một trong hai kênh:
   - **Kênh A, dán một lần**: mở [supabase/setup.sql](supabase/setup.sql) trên GitHub, bấm *Copy raw file*. Vào Supabase > SQL Editor > New query, dán, bấm **Run**. Bảng kết quả bên dưới phải toàn `true`. Dán lần hai sẽ bị từ chối, không ghi đè.
   - **Kênh B, tự động**: GitHub > Settings > Secrets and variables > Actions > *New repository secret*, tên `DATABASE_URL`, giá trị là chuỗi **Transaction pooler** (nút Connect trên Supabase, đã điền mật khẩu). Rồi tab Actions > **Database** > Run workflow > `migrate`.
3. **Đăng nhập email**: Supabase > Authentication > URL Configuration. *Site URL* là địa chỉ app; *Redirect URLs* thêm `{APP_URL}/auth/confirm**` và `{APP_URL}/auth/callback**`. Không cần sửa mẫu email.
4. **Vercel**: import repo, đặt biến môi trường theo `.env.example` với `AUTH_MODE=supabase`, `STORAGE_DRIVER=supabase`, `DATABASE_URL` (chuỗi Transaction pooler), ba khóa của Supabase và `APP_URL`.
5. **Kiểm tra**: Actions > Database > Run workflow > `check`. Mọi dòng phải có dấu ✓.

Khi có migration mới: chạy lại workflow với `migrate`. Không chạy `tests/db/shim.sql` hay `supabase/seed.sql` trên Supabase: hai file này chỉ dành cho máy dev.

Khóa bí mật chỉ nhập vào trang cài đặt của GitHub, Vercel và Supabase; không dán vào chat, không commit vào repo.

### Lệnh database

| Lệnh | Việc |
|---|---|
| `pnpm db:migrate` | Chạy migration còn thiếu trên database của `DATABASE_URL`. Có sổ ghi, chạy lại không sao; `--dry-run` để chỉ xem |
| `pnpm db:doctor` | Kiểm tra đúng những thứ app cần: phân quyền, chuyển vai trò, dữ liệu gốc, bộ lọc, kho ảnh. Chỉ đọc |
| `pnpm db:setup-sql` | Sinh lại `supabase/setup.sql` sau khi thêm migration |
| `pnpm db:reset` | Chỉ máy dev: xóa và dựng lại database local kèm dữ liệu mẫu |

Chưa kiểm chứng trên Supabase thật (mới chạy trên Postgres local có cùng vai trò và mặc định): chứng chỉ TLS của pooler, quyền tạo trigger trên `auth.users`, và giới hạn độ dài của SQL Editor với file 188 KB. Nếu SQL Editor từ chối vì file dài, dùng kênh B.
