-- Exchangethings.vn, M1: dữ liệu tham chiếu (danh mục, từ khóa cấm, cấu hình nền tảng).
-- Dữ liệu này cần có ở mọi môi trường, kể cả production, nên nằm trong migration chứ không nằm trong seed.

insert into public.categories (id, item_type, name_vi, name_en, requires_proof, is_phone, sort) values
  ('phones',          'physical',     'Điện thoại',              'Phones',               false, true,  10),
  ('electronics',     'physical',     'Đồ điện tử',              'Electronics',          false, false, 20),
  ('cameras',         'physical',     'Máy ảnh',                 'Cameras',              false, false, 30),
  ('games',           'physical',     'Máy chơi game',           'Game consoles',        false, false, 40),
  ('fashion',         'physical',     'Thời trang',              'Fashion',              false, false, 50),
  ('luxury-fashion',  'physical',     'Thời trang hàng hiệu',    'Luxury fashion',       true,  false, 60),
  ('luxury-shoes',    'physical',     'Giày hàng hiệu',          'Luxury shoes',         true,  false, 70),
  ('luxury-bags',     'physical',     'Túi hàng hiệu',           'Luxury bags',          true,  false, 80),
  ('luxury-watches',  'physical',     'Đồng hồ hàng hiệu',       'Luxury watches',       true,  false, 90),
  ('watches',         'physical',     'Đồng hồ',                 'Watches',              false, false, 100),
  ('books',           'physical',     'Sách',                    'Books',                false, false, 110),
  ('home',            'physical',     'Đồ gia dụng',             'Home',                 false, false, 120),
  ('sports',          'physical',     'Thể thao',                'Sports',               false, false, 130),
  ('music',           'physical',     'Nhạc cụ',                 'Musical instruments',  false, false, 140),
  ('templates',       'digital_file', 'Template thiết kế',       'Design templates',     false, false, 200),
  ('ebooks',          'digital_file', 'Sách điện tử',            'E-books',              false, false, 210),
  ('presets',         'digital_file', 'Preset ảnh, video',       'Photo and video presets', false, false, 220),
  ('other-files',     'digital_file', 'File số khác',            'Other digital files',  false, false, 230),
  ('courses',         'course_code',  'Mã khóa học',             'Course codes',         false, false, 300),
  ('vouchers-shopping', 'voucher',    'Voucher mua sắm',         'Shopping vouchers',    false, false, 400),
  ('vouchers-services', 'voucher',    'Voucher dịch vụ',         'Service vouchers',     false, false, 410),
  ('tickets',         'voucher',      'Vé, mã vé',               'Tickets',              false, false, 420),
  ('lessons',         'service',      'Dạy học',                 'Lessons',              false, false, 500),
  ('consulting',      'service',      'Tư vấn',                  'Consulting',           false, false, 510),
  ('creative',        'service',      'Thiết kế, minh họa',      'Design and illustration', false, false, 520),
  ('hands-on',        'service',      'Hướng dẫn thực hành',     'Hands-on sessions',    false, false, 530),
  ('other',           'other',        'Khác',                    'Other',                false, false, 900);

-- Từ khóa cấm: block = chặn đăng; flag = cho đăng nhưng chờ admin duyệt. So khớp không phân biệt dấu.
-- Danh sách khởi đầu, admin bổ sung dần.
insert into public.banned_keywords (keyword, severity) values
  ('vũ khí', 'block'), ('súng', 'block'), ('đạn', 'block'), ('dao găm', 'block'),
  ('ma túy', 'block'), ('cần sa', 'block'), ('thuốc lắc', 'block'), ('ketamine', 'block'),
  ('hàng fake', 'block'), ('hàng nhái', 'block'), ('replica', 'block'), ('super fake', 'block'),
  ('thuốc lá điện tử', 'block'), ('vape', 'block'),
  ('bán tài khoản', 'block'), ('acc game', 'block'), ('dữ liệu khách hàng', 'block'),
  ('crack', 'block'), ('bản lậu', 'block'),
  ('bitcoin', 'flag'), ('usdt', 'flag'), ('tiền ảo', 'flag'),
  ('thuốc', 'flag'), ('rượu', 'flag'), ('rep 1:1', 'flag'),
  ('thú cưng', 'flag'), ('chó', 'flag'), ('mèo', 'flag');

-- Cấu hình nền tảng theo DECISIONS.md (D-02, D-05, D-12) và SPEC mục 7 đến 9.
insert into public.platform_settings (key, value) values
  ('fee_rate', '0'),
  ('deposit_rates', '{"new": 0.2, "regular": 0.1, "high": 0}'),
  ('high_trust', '{"min_swaps": 20, "min_rating": 4.8, "max_lost_disputes_90d": 0}'),
  ('regular_tier', '{"min_swaps": 3, "phone_verified": true}'),
  ('new_account_limit_vnd', '5000000'),
  ('match_weights', '{"wants": 0.35, "value": 0.25, "proximity": 0.2, "trust": 0.2}'),
  ('fairness_thresholds', '{"ok": 0.10, "warn": 0.25, "max_tilt_deg": 14}'),
  ('offer_ttl_hours', '48'),
  ('auto_complete_hours', '72'),
  ('signed_url_ttl_seconds', '600'),
  ('rate_limits', '{"swipes_per_day": 300, "offers_per_day": 30, "messages_per_day": 200}'),
  ('upload_limits', '{"max_photo_mb": 10, "max_file_mb": 50, "file_types": ["pdf", "png", "jpg", "webp", "mp4", "zip"]}');
