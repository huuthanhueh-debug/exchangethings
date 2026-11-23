-- Exchangethings.vn: cài đặt database cho một project Supabase MỚI.
-- Cách dùng: Supabase > SQL Editor > New query > dán toàn bộ file này > Run. Không cần token, không cần dòng lệnh.
-- Chạy trong một transaction: lỗi ở đâu thì không có gì thay đổi. Chạy lần hai sẽ bị từ chối, không ghi đè.
-- File sinh tự động bởi scripts/build-setup-sql.mjs từ supabase/migrations; không sửa tay.

begin;

do $check$
begin
  if (select count(*) from pg_roles where rolname in ('anon', 'authenticated', 'service_role')) < 3 or to_regclass('auth.users') is null then
    raise exception 'Đây không phải project Supabase: thiếu vai trò anon/authenticated/service_role hoặc bảng auth.users.';
  end if;
  if to_regclass('public.items') is not null or to_regclass('public.profiles') is not null or to_regclass('app_meta.migrations') is not null then
    raise exception 'Database đã có bảng của Exchangethings.vn. File này chỉ dành cho project mới; không có gì thay đổi.';
  end if;
end $check$;

create schema if not exists app_meta;
create table if not exists app_meta.migrations (
  version text primary key check (version ~ '^[0-9]{14}$'),
  name text not null,
  checksum text not null,
  applied_at timestamptz not null default now(),
  applied_by text not null default current_user
);

-- ===== 20261122000100_schema.sql =====
-- Exchangethings.vn, M1: lược đồ cơ sở dữ liệu.
-- Chạy trên Supabase (đã có schema auth) hoặc trên Postgres local kèm tests/db/shim.sql.
-- Quy ước: tiền là bigint VND; thời gian là timestamptz; mọi bảng bật RLS ở migration 200.

-- Supabase đặt extension trong schema extensions; gọi hàm bằng tên đầy đủ để không phụ thuộc search_path.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------------
-- Kiểu liệt kê
-- ---------------------------------------------------------------------------
create type public.item_type as enum ('physical', 'digital_file', 'course_code', 'voucher', 'service', 'other');
create type public.item_condition as enum ('new', 'like_new', 'good', 'fair', 'not_applicable');
create type public.item_status as enum ('draft', 'pending_review', 'active', 'reserved', 'swapped', 'removed');
create type public.delivery_method as enum ('carrier', 'meetup', 'digital', 'online_session');
create type public.want_type as enum ('item', 'category', 'keyword');
create type public.media_kind as enum ('photo', 'proof');
create type public.user_tier as enum ('new', 'regular', 'high');
create type public.user_role as enum ('user', 'admin');
create type public.keyword_severity as enum ('block', 'flag');
create type public.region as enum ('north', 'central', 'south');
create type public.swipe_direction as enum ('like', 'pass');
create type public.offer_status as enum ('offer_sent', 'countered', 'accepted', 'expired', 'cancelled', 'declined');
create type public.offer_side as enum ('give', 'get');
create type public.txn_kind as enum ('carrier', 'meetup', 'digital', 'mixed', 'service', 'purchase');
create type public.txn_status as enum ('accepted', 'locked', 'in_progress', 'delivered', 'completed', 'cancelled', 'disputed', 'resolved_refund', 'resolved_release');
create type public.escrow_purpose as enum ('topup', 'purchase', 'deposit');
create type public.escrow_status as enum ('pending', 'held', 'released', 'refunded', 'failed');
create type public.shipment_status as enum ('created', 'picked_up', 'in_transit', 'delivered', 'returned');
create type public.vault_kind as enum ('code', 'file');
create type public.report_target as enum ('user', 'item', 'message');
create type public.report_status as enum ('open', 'actioned', 'dismissed');
create type public.dispute_status as enum ('open', 'resolved_refund', 'resolved_release');

-- ---------------------------------------------------------------------------
-- Hàm tiện ích
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Dữ liệu tham chiếu
-- ---------------------------------------------------------------------------
create table public.provinces (
  code text primary key check (code ~ '^[0-9]{2}$'),
  name text not null,
  short_name text not null,
  place_type text not null,
  region public.region not null
);

create table public.wards (
  code text primary key check (code ~ '^[0-9]{5}$'),
  name text not null,
  province_code text not null references public.provinces (code)
);
create index wards_province_idx on public.wards (province_code);

create table public.categories (
  id text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  item_type public.item_type not null,
  name_vi text not null,
  name_en text not null,
  requires_proof boolean not null default false,
  is_phone boolean not null default false,
  sort smallint not null default 0
);

create table public.banned_keywords (
  id bigint generated always as identity primary key,
  keyword text not null unique check (length(keyword) between 2 and 60),
  severity public.keyword_severity not null
);

create table public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Người dùng
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (length(display_name) between 2 and 40),
  avatar_path text,
  province_code text references public.provinces (code),
  ward_code text references public.wards (code),
  bio text check (length(bio) <= 280),
  trust_score smallint not null default 35 check (trust_score between 0 and 100),
  tier public.user_tier not null default 'new',
  completed_swaps integer not null default 0 check (completed_swaps >= 0),
  rating_avg numeric(3, 2) check (rating_avg between 1 and 5),
  rating_count integer not null default 0 check (rating_count >= 0),
  lost_disputes_90d integer not null default 0 check (lost_disputes_90d >= 0),
  role public.user_role not null default 'user',
  locale text not null default 'vi' check (locale in ('vi', 'en')),
  banned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Phường/xã phải thuộc đúng tỉnh/thành đã chọn.
create or replace function public.check_profile_ward() returns trigger
language plpgsql as $$
begin
  if new.ward_code is not null and not exists (
    select 1 from public.wards w where w.code = new.ward_code and w.province_code = new.province_code
  ) then
    raise exception 'ward % does not belong to province %', new.ward_code, new.province_code
      using errcode = '23514';
  end if;
  return new;
end $$;
create trigger profiles_ward_check before insert or update of province_code, ward_code on public.profiles
  for each row execute function public.check_profile_ward();

-- Dữ liệu riêng tư tách bảng: RLS chỉ phân quyền theo dòng, không giấu được từng cột.
create table public.profile_private (
  id uuid primary key references public.profiles (id) on delete cascade,
  phone_e164 text check (phone_e164 ~ '^\+84[0-9]{9}$'),
  phone_verified_at timestamptz,
  street_address text check (length(street_address) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profile_private_updated_at before update on public.profile_private
  for each row execute function public.set_updated_at();

-- Tạo hồ sơ khi có tài khoản mới trong auth.users.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  -- Tên mặc định trung tính: không lấy phần đầu email hay tên Google, vì thường là tên thật và tên hiển thị là công khai.
  v_default text := 'Thành viên ' || upper(substr(replace(new.id::text, '-', ''), 1, 4));
  v_name text := coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), v_default);
begin
  if length(v_name) < 2 or public.banned_keyword_severity(v_name) = 'block' then v_name := v_default; end if;
  insert into public.profiles (id, display_name) values (new.id, left(v_name, 40));
  insert into public.profile_private (id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Tên hiển thị và lời giới thiệu là nội dung công khai: không chứa từ cấm.
create or replace function public.check_profile_text() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.texts_severity(new.display_name, new.bio) = 'block' then
    raise exception 'profile contains a banned keyword' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger profiles_text_filter before update of display_name, bio on public.profiles
  for each row execute function public.check_profile_text();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.banned_at is null
  );
$$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.banned_at is null);
$$;

-- ---------------------------------------------------------------------------
-- Món đồ
-- ---------------------------------------------------------------------------
create table public.items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  type public.item_type not null,
  category_id text references public.categories (id),
  title text not null check (length(title) between 3 and 80),
  description text check (length(description) <= 2000),
  condition public.item_condition not null default 'not_applicable',
  est_value_vnd bigint not null check (est_value_vnd between 0 and 10000000000),
  topup_pay_max_vnd bigint not null default 0 check (topup_pay_max_vnd between 0 and 10000000000),
  topup_receive_max_vnd bigint not null default 0 check (topup_receive_max_vnd between 0 and 10000000000),
  sell_price_vnd bigint check (sell_price_vnd between 1000 and 10000000000),
  delivery_methods public.delivery_method[] not null check (cardinality(delivery_methods) between 1 and 4),
  province_code text references public.provinces (code),
  expires_on date,
  imei_last4 text check (imei_last4 ~ '^[0-9]{4}$'),
  signed_out_confirmed boolean not null default false,
  transfer_right_confirmed boolean not null default false,
  duration_minutes integer check (duration_minutes between 15 and 480),
  status public.item_status not null default 'draft',
  review_note text check (length(review_note) <= 500),
  -- Admin đã từ chối món này: lần đăng lại phải chờ duyệt, không lên thẳng.
  requires_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Cách giao phải hợp với loại món.
  constraint items_delivery_matches_type check (
    case type
      when 'physical' then delivery_methods <@ array['carrier', 'meetup']::public.delivery_method[]
      when 'digital_file' then delivery_methods = array['digital']::public.delivery_method[]
      when 'course_code' then delivery_methods = array['digital']::public.delivery_method[]
      when 'voucher' then delivery_methods = array['digital']::public.delivery_method[]
      when 'service' then delivery_methods <@ array['meetup', 'online_session']::public.delivery_method[]
      else true
    end
  ),
  -- Ràng buộc chỉ áp khi món rời trạng thái nháp.
  constraint items_ready_rules check (
    status = 'draft' or (
      (type <> 'physical' or province_code is not null)
      and (type not in ('digital_file', 'course_code', 'voucher') or transfer_right_confirmed)
      and (type not in ('course_code', 'voucher') or expires_on is not null)
      and (type <> 'service' or duration_minutes is not null)
    )
  )
);
create index items_owner_idx on public.items (owner_id);
create index items_status_type_idx on public.items (status, type);
create index items_province_idx on public.items (province_code);
create trigger items_updated_at before update on public.items
  for each row execute function public.set_updated_at();

-- Loại món phải khớp loại của danh mục.
create or replace function public.check_item_category() returns trigger
language plpgsql as $$
begin
  if new.category_id is not null and not exists (
    select 1 from public.categories c where c.id = new.category_id and c.item_type = new.type
  ) then
    raise exception 'category % is not valid for item type %', new.category_id, new.type
      using errcode = '23514';
  end if;
  return new;
end $$;
create trigger items_category_check before insert or update of category_id, type on public.items
  for each row execute function public.check_item_category();

create table public.item_private (
  item_id uuid primary key references public.items (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  imei_full text not null check (imei_full ~ '^[0-9]{15}$'),
  created_at timestamptz not null default now()
);

create table public.item_media (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  kind public.media_kind not null default 'photo',
  storage_path text not null unique,
  width integer check (width > 0),
  height integer check (height > 0),
  exif_stripped boolean not null check (exif_stripped),
  sort smallint not null default 0,
  created_at timestamptz not null default now()
);
create index item_media_item_idx on public.item_media (item_id, kind, sort);

-- Giới hạn và khóa khi ghi ảnh. Khóa dòng món trước khi đếm để hai lượt tải lên cùng lúc không vượt giới hạn,
-- và để publish_item (cũng khóa dòng món) không đếm ảnh trong lúc ảnh đang được thêm hoặc xóa.
create or replace function public.guard_item_media_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_item public.items;
  v_count integer;
begin
  select * into v_item from public.items where id = new.item_id for update;
  if not found then
    return new; -- khóa ngoại sẽ báo lỗi
  end if;
  if v_item.status in ('reserved', 'swapped') then
    raise exception 'item is locked' using errcode = '22023';
  end if;
  select count(*) into v_count from public.item_media where item_id = new.item_id and kind = new.kind;
  if new.kind = 'photo' and v_count >= 10 then
    raise exception 'too many photos' using errcode = '22023';
  elsif new.kind = 'proof' and v_count >= 4 then
    raise exception 'too many proofs' using errcode = '22023';
  end if;
  -- Món loại "khác" được duyệt theo nội dung, kể cả ảnh: thêm ảnh thì duyệt lại.
  if v_item.type = 'other' and v_item.status = 'active' then
    update public.items set status = 'pending_review' where id = new.item_id;
  end if;
  return new;
end $$;
create trigger item_media_guard_insert before insert on public.item_media
  for each row execute function public.guard_item_media_insert();

-- Món đã đăng phải giữ đủ ảnh đã dùng để đăng: chỉ xóa ảnh khi món ở nháp hoặc đã gỡ.
create or replace function public.guard_item_media_delete() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_status public.item_status;
begin
  select status into v_status from public.items where id = old.item_id for update;
  -- Không thấy món nghĩa là món đang bị xóa (cascade): cho xóa ảnh theo.
  if found and v_status not in ('draft', 'removed') then
    raise exception 'cannot delete media of a listed item' using errcode = '22023';
  end if;
  return old;
end $$;
create trigger item_media_guard_delete before delete on public.item_media
  for each row execute function public.guard_item_media_delete();

create table public.item_wants (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.items (id) on delete cascade,
  want_type public.want_type not null,
  wanted_item_id uuid references public.items (id) on delete cascade,
  category_id text references public.categories (id),
  keyword text check (length(keyword) between 2 and 40),
  constraint item_wants_shape check (
    (want_type = 'item' and wanted_item_id is not null and category_id is null and keyword is null)
    or (want_type = 'category' and category_id is not null and wanted_item_id is null and keyword is null)
    or (want_type = 'keyword' and keyword is not null and wanted_item_id is null and category_id is null)
  )
);
create index item_wants_item_idx on public.item_wants (item_id);

-- Mỗi món tối đa 5 mong muốn. Từ khóa mong muốn cũng là nội dung công khai nên qua bộ lọc như tên và mô tả:
-- món nháp được lọc khi đăng (publish_item), món đã đăng được lọc ngay khi thêm.
create or replace function public.guard_item_wants() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_item public.items;
  v_severity public.keyword_severity;
begin
  select * into v_item from public.items where id = new.item_id for update;
  if not found then
    return new; -- khóa ngoại sẽ báo lỗi
  end if;
  if (select count(*) from public.item_wants where item_id = new.item_id) >= 5 then
    raise exception 'too many wants' using errcode = '22023';
  end if;
  if new.keyword is not null and v_item.status in ('active', 'pending_review') then
    v_severity := public.banned_keyword_severity(new.keyword);
    if v_severity = 'block' then
      raise exception 'listing contains a banned keyword' using errcode = '22023';
    elsif v_severity = 'flag' and v_item.status = 'active' then
      update public.items set status = 'pending_review' where id = new.item_id;
    end if;
  end if;
  return new;
end $$;
create trigger item_wants_guard before insert on public.item_wants
  for each row execute function public.guard_item_wants();

-- ---------------------------------------------------------------------------
-- Kiểm duyệt nội dung: từ khóa cấm, đăng món, rút món, admin duyệt
-- ---------------------------------------------------------------------------
-- Chuẩn hóa văn bản trước khi so từ khóa, để chữ đọc giống nhau thì khớp giống nhau (DECISIONS D-21, D-27):
-- 1. NFKC: ghép dấu rời thành chữ tiếng Việt chuẩn, đổi chữ fullwidth về chữ thường gặp.
-- 2. Bỏ ký tự vô hình (zero-width, soft hyphen, dấu điều khiển hướng chữ) và dấu kết hợp còn sót.
-- 3. Đổi chữ Cyrillic, Hy Lạp trông giống chữ Latin về chữ Latin.
-- 4. Mọi ký tự không phải chữ hay số thành một khoảng trắng; tách chữ và số dính nhau ("vape2" thành "vape 2").
-- Cần LC_CTYPE hiểu Unicode (Supabase và Postgres local đều vậy); cuối file có phép kiểm tra.
create or replace function public.normalize_for_filter(p_text text) returns text
language sql immutable as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          translate(
            regexp_replace(
              regexp_replace(lower(normalize(coalesce(p_text, ''), NFKC)),
                '[­͏؜ᅟᅠ឴឵᠋-᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]', '', 'g'),
              '[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]', '', 'g'),
            'авеікмнорстухјѕһԁԛԝαβεζηικμνορτυχ',
            'abeikmhopctyxjshdqwabeznikmvoptux'),
          '[^[:alnum:]]+', ' ', 'g'),
        '([[:alpha:]])([[:digit:]])', '\1 \2', 'g'),
      '([[:digit:]])([[:alpha:]])', '\1 \2', 'g'));
$$;

-- So khớp nguyên từ trên văn bản đã chuẩn hóa. Từ đơn có dấu chỉ khớp khi giữ dấu ("đạn" không khớp "dan",
-- "chó" không khớp "cho"). Cụm nhiều chữ và từ khóa không dấu khớp cả khi người dùng gõ không dấu ("ma tuy").
-- Bộ lọc là lớp chặn đầu tiên; cách viết lách nhìn thấy được (v4pe, s.ú.n.g) do báo cáo và admin xử lý.
create or replace function public.banned_keyword_severity(p_text text) returns public.keyword_severity
language sql stable security definer set search_path = public as $$
  with t as (
    select ' ' || n.txt || ' ' as txt, ' ' || extensions.unaccent(n.txt) || ' ' as txt_plain
      from (select public.normalize_for_filter(p_text) as txt) n
  ), k as (
    select severity, public.normalize_for_filter(keyword) as kw from public.banned_keywords
  ), hits as (
    select k.severity
      from k, t
     where k.kw <> ''
       and (position(' ' || k.kw || ' ' in t.txt) > 0
         or ((position(' ' in k.kw) > 0 or k.kw = extensions.unaccent(k.kw))
             and position(' ' || extensions.unaccent(k.kw) || ' ' in t.txt_plain) > 0))
  )
  select case
    when bool_or(severity = 'block') then 'block'::public.keyword_severity
    when bool_or(severity = 'flag') then 'flag'::public.keyword_severity
  end
  from hits;
$$;

-- Mức nặng nhất trong nhiều đoạn văn bản. Xét riêng từng đoạn để chữ cuối đoạn này không ghép với chữ đầu đoạn kia.
create or replace function public.texts_severity(variadic p_texts text[]) returns public.keyword_severity
language sql stable security definer set search_path = public as $$
  select case
    when bool_or(q.s = 'block') then 'block'::public.keyword_severity
    when bool_or(q.s = 'flag') then 'flag'::public.keyword_severity
  end
  from (select public.banned_keyword_severity(x) as s from unnest(p_texts) as x) q;
$$;

-- Nội dung công khai của một món: tên, mô tả và các từ khóa "muốn đổi lấy".
create or replace function public.item_severity(p_item_id uuid, p_title text, p_description text)
returns public.keyword_severity
language sql stable security definer set search_path = public as $$
  select public.texts_severity(variadic array[p_title, p_description]
    || coalesce((select array_agg(w.keyword) from public.item_wants w
                  where w.item_id = p_item_id and w.keyword is not null), '{}'::text[]));
$$;

-- Cho trang quản lý món: kết quả lọc của chính món mình (hoặc admin xem món bất kỳ).
create or replace function public.my_item_severity(p_item_id uuid) returns public.keyword_severity
language sql stable security definer set search_path = public as $$
  select public.item_severity(i.id, i.title, i.description)
    from public.items i
   where i.id = p_item_id and (i.owner_id = auth.uid() or public.is_admin());
$$;

-- Người dùng không tự đặt status; đăng món đi qua hàm này để kiểm tra đủ điều kiện.
create or replace function public.publish_item(p_item_id uuid) returns public.item_status
language plpgsql security definer set search_path = public as $$
declare
  v_item public.items;
  v_cat public.categories;
  v_photos integer;
  v_proofs integer;
  v_severity public.keyword_severity;
  v_next public.item_status;
begin
  select * into v_item from public.items where id = p_item_id for update;
  if not found or v_item.owner_id is distinct from auth.uid() then
    raise exception 'item not found' using errcode = 'P0002';
  end if;
  if not public.is_active_user() then
    raise exception 'account is banned' using errcode = '42501';
  end if;
  if v_item.status not in ('draft', 'removed') then
    raise exception 'item is already %', v_item.status using errcode = '22023';
  end if;
  select * into v_cat from public.categories where id = v_item.category_id;

  select count(*) filter (where kind = 'photo'), count(*) filter (where kind = 'proof')
    into v_photos, v_proofs
    from public.item_media where item_id = p_item_id;

  if v_item.type = 'physical' and v_photos < 3 then
    raise exception 'physical items need at least 3 photos' using errcode = '22023';
  end if;
  if coalesce(v_cat.requires_proof, false) and v_proofs < 1 then
    raise exception 'this category needs a proof of authenticity' using errcode = '22023';
  end if;
  if coalesce(v_cat.is_phone, false) and (
       v_item.imei_last4 is null or not v_item.signed_out_confirmed
       or not exists (select 1 from public.item_private p where p.item_id = p_item_id and p.imei_full is not null)
     ) then
    raise exception 'phones need an IMEI and a sign-out confirmation' using errcode = '22023';
  end if;

  v_severity := public.item_severity(p_item_id, v_item.title, v_item.description);
  if v_severity = 'block' then
    raise exception 'listing contains a banned keyword' using errcode = '22023';
  end if;

  v_next := case
    when v_item.type = 'other' or v_severity = 'flag' or v_item.requires_review then 'pending_review'
    else 'active'
  end;
  update public.items set status = v_next, review_note = null where id = p_item_id;  -- kích hoạt items_ready_rules
  return v_next;
end $$;

create or replace function public.withdraw_item(p_item_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.items set status = 'removed'
   where id = p_item_id and owner_id = auth.uid() and status in ('draft', 'pending_review', 'active');
  if not found then
    raise exception 'item not found or not withdrawable' using errcode = 'P0002';
  end if;
end $$;

-- Nhật ký quyết định duyệt món (SPEC mục 12: mọi quyết định ghi lý do). Chỉ thêm; không sửa.
create table public.item_reviews (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.items (id) on delete cascade,
  reviewer_id uuid references public.profiles (id) on delete set null,
  approved boolean not null,
  note text check (length(note) <= 500),
  created_at timestamptz not null default now()
);
create index item_reviews_item_idx on public.item_reviews (item_id, created_at);

create or replace function public.admin_review_item(p_item_id uuid, p_approve boolean, p_note text default null)
returns public.item_status
language plpgsql security definer set search_path = public as $$
declare
  v_item public.items;
  v_next public.item_status := case when p_approve then 'active' else 'removed' end;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  select * into v_item from public.items where id = p_item_id and status = 'pending_review' for update;
  if not found then
    raise exception 'item is not waiting for review' using errcode = 'P0002';
  end if;
  -- Nội dung hoặc danh sách từ cấm có thể đã đổi sau khi admin mở xem: kiểm lại trước khi cho lên.
  if p_approve and public.item_severity(p_item_id, v_item.title, v_item.description) = 'block' then
    raise exception 'listing contains a banned keyword' using errcode = '22023';
  end if;
  -- review_note trên món chỉ chứa lý do từ chối để chủ món đọc (món đã gỡ không ai khác thấy).
  -- Ghi chú khi duyệt là nội bộ, chỉ nằm trong nhật ký item_reviews.
  update public.items
     set status = v_next,
         review_note = case when p_approve then null else left(p_note, 500) end,
         requires_review = not p_approve
   where id = p_item_id;
  insert into public.item_reviews (item_id, reviewer_id, approved, note)
  values (p_item_id, auth.uid(), p_approve, left(p_note, 500));
  return v_next;
end $$;

-- Sửa món đã đăng.
-- Danh mục và cam kết thoát tài khoản quyết định điều kiện đăng (chứng từ, IMEI), nên chỉ đổi được khi món ở nháp
-- hoặc đã gỡ; nếu không, người dùng có thể đăng ở danh mục dễ rồi chuyển sang danh mục cần chứng từ.
-- Nội dung món đang hiển thị hoặc chờ duyệt được lọc lại: từ cấm thì chặn; từ cần duyệt thì quay về chờ duyệt.
-- Món loại "khác" được duyệt theo nội dung, nên đổi tên hoặc mô tả là phải duyệt lại.
create or replace function public.recheck_item_on_edit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_severity public.keyword_severity;
  v_listed boolean := old.status not in ('draft', 'removed');
begin
  if v_listed and new.category_id is distinct from old.category_id then
    raise exception 'withdraw the item before changing its category' using errcode = '22023';
  end if;
  if v_listed and new.signed_out_confirmed is distinct from old.signed_out_confirmed then
    raise exception 'withdraw the item before changing its sign-out confirmation' using errcode = '22023';
  end if;
  if old.status in ('active', 'pending_review')
     and (new.title is distinct from old.title or new.description is distinct from old.description) then
    v_severity := public.item_severity(new.id, new.title, new.description);
    if v_severity = 'block' then
      raise exception 'listing contains a banned keyword' using errcode = '22023';
    elsif new.status = 'active' and (v_severity = 'flag' or new.type = 'other') then
      new.status := 'pending_review';
    end if;
  end if;
  return new;
end $$;
create trigger items_recheck_on_edit before update of title, description, category_id, signed_out_confirmed on public.items
  for each row execute function public.recheck_item_on_edit();

-- ---------------------------------------------------------------------------
-- Quẹt, khớp, đề nghị (M2, M3) và giao dịch (M4). Tạo bảng ngay, chính sách RLS thêm ở mốc tương ứng.
-- ---------------------------------------------------------------------------
create table public.swipes (
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  direction public.swipe_direction not null,
  created_at timestamptz not null default now(),
  primary key (viewer_id, item_id)
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  item_a uuid references public.items (id) on delete set null,
  item_b uuid references public.items (id) on delete set null,
  created_at timestamptz not null default now(),
  check (user_a < user_b),
  unique (user_a, user_b)
);

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references public.matches (id) on delete set null,
  from_user uuid not null references public.profiles (id) on delete cascade,
  to_user uuid not null references public.profiles (id) on delete cascade,
  current_version integer not null default 1 check (current_version >= 1),
  status public.offer_status not null default 'offer_sent',
  expires_at timestamptz not null default now() + interval '48 hours',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_user <> to_user)
);
create trigger offers_updated_at before update on public.offers
  for each row execute function public.set_updated_at();

create table public.offer_versions (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id) on delete cascade,
  version integer not null check (version >= 1),
  author_id uuid not null references public.profiles (id) on delete cascade,
  topup_payer_id uuid references public.profiles (id),
  topup_vnd bigint not null default 0 check (topup_vnd between 0 and 10000000000),
  cash_only boolean not null default false,
  created_at timestamptz not null default now(),
  unique (offer_id, version),
  check ((topup_vnd = 0) = (topup_payer_id is null))
);

create table public.offer_items (
  offer_version_id uuid not null references public.offer_versions (id) on delete cascade,
  item_id uuid not null references public.items (id),
  side public.offer_side not null,
  primary key (offer_version_id, item_id)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  offer_version_id uuid not null unique references public.offer_versions (id),
  kind public.txn_kind not null,
  status public.txn_status not null default 'accepted',
  ship_first_user_id uuid references public.profiles (id),
  auto_complete_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger transactions_updated_at before update on public.transactions
  for each row execute function public.set_updated_at();

create table public.transaction_events (
  id bigint generated always as identity primary key,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  from_status public.txn_status,
  to_status public.txn_status not null,
  actor_id uuid references public.profiles (id),
  reason text check (length(reason) <= 500),
  created_at timestamptz not null default now()
);

-- Nhật ký chỉ được thêm, không sửa, không xóa.
create or replace function public.forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;
create trigger transaction_events_append_only before update or delete on public.transaction_events
  for each row execute function public.forbid_change();
create trigger item_reviews_append_only before update on public.item_reviews
  for each row execute function public.forbid_change();

create table public.escrow_payments (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  payer_id uuid not null references public.profiles (id),
  payee_id uuid references public.profiles (id),
  purpose public.escrow_purpose not null,
  amount_vnd bigint not null check (amount_vnd > 0),
  provider text not null default 'mock',
  provider_ref text,
  status public.escrow_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger escrow_payments_updated_at before update on public.escrow_payments
  for each row execute function public.set_updated_at();

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  sender_id uuid not null references public.profiles (id),
  carrier text,
  tracking_code text check (length(tracking_code) <= 60),
  status public.shipment_status not null default 'created',
  updated_at timestamptz not null default now()
);
create trigger shipments_updated_at before update on public.shipments
  for each row execute function public.set_updated_at();

create table public.vault_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  owner_id uuid not null references public.profiles (id),
  kind public.vault_kind not null,
  ciphertext bytea,
  file_path text,
  revealed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((kind = 'code' and ciphertext is not null) or (kind = 'file' and file_path is not null))
);

create table public.vault_access_logs (
  id bigint generated always as identity primary key,
  vault_entry_id uuid not null references public.vault_entries (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id),
  viewed_at timestamptz not null default now()
);
create trigger vault_access_logs_append_only before update or delete on public.vault_access_logs
  for each row execute function public.forbid_change();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text check (length(body) <= 2000),
  image_path text,
  masked boolean not null default false,
  created_at timestamptz not null default now(),
  check (body is not null or image_path is not null)
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id),
  reviewee_id uuid not null references public.profiles (id),
  rating smallint not null check (rating between 1 and 5),
  comment text check (length(comment) <= 500),
  created_at timestamptz not null default now(),
  unique (transaction_id, reviewer_id),
  check (reviewer_id <> reviewee_id)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type public.report_target not null,
  target_id uuid not null,
  reason text not null check (length(reason) between 3 and 500),
  status public.report_status not null default 'open',
  created_at timestamptz not null default now()
);

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  opened_by uuid not null references public.profiles (id),
  reason text not null check (length(reason) between 3 and 1000),
  evidence_paths text[] not null default '{}',
  status public.dispute_status not null default 'open',
  resolved_by uuid references public.profiles (id),
  resolution_note text check (length(resolution_note) <= 1000),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (length(type) <= 40),
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, read_at);

-- ---------------------------------------------------------------------------
-- Kiểm tra giả định: bộ lọc từ khóa cần LC_CTYPE hiểu Unicode. Sai thì dừng migration, không chạy tiếp âm thầm.
-- ---------------------------------------------------------------------------
do $$
begin
  if not ('ú' ~ '[[:alpha:]]' and lower('ĐẠN') = 'đạn') then
    raise exception 'LC_CTYPE của database phải hiểu Unicode (ví dụ C.UTF-8 hoặc en_US.UTF-8)';
  end if;
  if public.normalize_for_filter('Ma' || chr(160) || 'TÚY!' || chr(8203) || ' vape2') <> 'ma túy vape 2' then
    raise exception 'normalize_for_filter không hoạt động như mong đợi trên database này';
  end if;
end $$;

insert into app_meta.migrations (version, name, checksum) values ('20261122000100', 'schema', '2296637b8edb039f132011b97a31426d7a14d8ab60f2e82e5b50806ac7e6e150');

-- ===== 20261122000200_rls.sql =====
-- Exchangethings.vn, M1: quyền truy cập và Row Level Security.
-- Supabase mặc định cấp ALL trên bảng public cho anon/authenticated. Migration này thu hồi quyền ghi,
-- chỉ cấp lại đúng cột được phép, và để RLS quyết định từng dòng.

-- 1. Bật RLS cho mọi bảng public. Bảng chưa có chính sách thì bị từ chối mặc định.
do $$
declare
  r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;

-- 2. Quyền mức bảng và cột.
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to anon, authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;

-- Hàm dùng trong chính sách RLS và hàm nghiệp vụ được gọi từ ứng dụng.
create or replace function public.is_banned(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = p_user and p.banned_at is not null);
$$;

-- Hồ sơ đầy đủ của chính mình (các cột riêng tư không đọc được bằng SELECT thường, xem mục 4).
create or replace function public.my_profile() returns setof public.profiles
language sql stable security definer set search_path = public as $$
  select * from public.profiles where id = auth.uid();
$$;
-- Quyền gọi hàm được chốt ở mục 11, cuối file, sau khi mọi hàm đã được tạo.

-- 3. Dữ liệu tham chiếu: ai cũng đọc được, chỉ migration hoặc service role ghi.
create policy provinces_read on public.provinces for select to anon, authenticated using (true);
create policy wards_read on public.wards for select to anon, authenticated using (true);
create policy categories_read on public.categories for select to anon, authenticated using (true);
create policy platform_settings_read on public.platform_settings for select to anon, authenticated using (true);
create policy banned_keywords_admin_read on public.banned_keywords for select to authenticated using (public.is_admin());

-- 4. Hồ sơ công khai: tên, ảnh, tỉnh/thành, uy tín. Người dùng chỉ sửa được vài cột của chính mình.
-- Chỉ các cột công khai đọc được bằng SELECT. Phường/xã, vai trò, ngôn ngữ, số khiếu nại thua, ngày khóa là riêng tư:
-- chủ tài khoản đọc qua my_profile(), hệ thống đọc qua các hàm SECURITY DEFINER (is_admin, is_banned).
revoke select on public.profiles from anon, authenticated;
grant select (id, display_name, avatar_path, province_code, bio, trust_score, tier, completed_swaps,
  rating_avg, rating_count, created_at) on public.profiles to anon, authenticated;
grant update (display_name, avatar_path, province_code, ward_code, bio, locale) on public.profiles to authenticated;
create policy profiles_read on public.profiles for select to anon, authenticated
  using (banned_at is null or id = auth.uid() or public.is_admin());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- 5. Dữ liệu riêng tư: chỉ chủ sở hữu và admin. Ngày xác minh SĐT chỉ server đặt được.
grant update (phone_e164, street_address) on public.profile_private to authenticated;
create policy profile_private_read on public.profile_private for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profile_private_update_own on public.profile_private for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create or replace function public.reset_phone_verification() returns trigger
language plpgsql as $$
begin
  -- Người dùng đổi số (không có quyền ghi phone_verified_at) thì mất xác minh.
  -- Server đặt số và ngày xác minh cùng lúc sau khi kiểm tra OTP thì giữ nguyên.
  if new.phone_e164 is distinct from old.phone_e164
     and new.phone_verified_at is not distinct from old.phone_verified_at then
    new.phone_verified_at := null;
  end if;
  return new;
end $$;
create trigger profile_private_phone_reset before update of phone_e164 on public.profile_private
  for each row execute function public.reset_phone_verification();

-- 6. Món đồ. Không có quyền ghi status, requires_review: đổi trạng thái đi qua publish_item, withdraw_item,
-- admin_review_item. Không có quyền ghi imei_last4: cột này chỉ đồng bộ từ IMEI đầy đủ (mục 7).
grant insert (owner_id, type, category_id, title, description, condition, est_value_vnd, topup_pay_max_vnd,
  topup_receive_max_vnd, sell_price_vnd, delivery_methods, province_code, expires_on,
  signed_out_confirmed, transfer_right_confirmed, duration_minutes) on public.items to authenticated;
grant update (category_id, title, description, condition, est_value_vnd, topup_pay_max_vnd,
  topup_receive_max_vnd, sell_price_vnd, delivery_methods, province_code, expires_on,
  signed_out_confirmed, transfer_right_confirmed, duration_minutes) on public.items to authenticated;

create policy items_read on public.items for select to anon, authenticated
  using ((status = 'active' and not public.is_banned(owner_id)) or owner_id = auth.uid() or public.is_admin());
create policy items_insert_own on public.items for insert to authenticated
  with check (owner_id = auth.uid() and public.is_active_user());
-- Món đang giao dịch (reserved) hoặc đã đổi xong (swapped) bị khóa. Món đã gỡ sửa được để đăng lại.
create policy items_update_own on public.items for update to authenticated
  using (owner_id = auth.uid() and status in ('draft', 'pending_review', 'active', 'removed'))
  with check (owner_id = auth.uid());

-- 7. IMEI đầy đủ: chỉ chủ món và admin. 4 số cuối trên items luôn đồng bộ theo IMEI đầy đủ.
grant insert (item_id, owner_id, imei_full), update (imei_full) on public.item_private to authenticated;
create policy item_private_read on public.item_private for select to authenticated
  using (owner_id = auth.uid() or public.is_admin());
create policy item_private_insert_own on public.item_private for insert to authenticated
  with check (owner_id = auth.uid() and exists (
    select 1 from public.items i where i.id = item_id and i.owner_id = auth.uid()));
create policy item_private_update_own on public.item_private for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- IMEI là điều kiện đăng của điện thoại: chỉ khai hoặc đổi khi món ở nháp hoặc đã gỡ.
create or replace function public.guard_item_private() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_status public.item_status;
begin
  if tg_op = 'UPDATE' and new.imei_full is not distinct from old.imei_full then
    return new;
  end if;
  select status into v_status from public.items where id = new.item_id for update;
  if found and v_status not in ('draft', 'removed') then
    raise exception 'withdraw the item before changing its IMEI' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger item_private_guard before insert or update of imei_full on public.item_private
  for each row execute function public.guard_item_private();

create or replace function public.sync_imei_last4() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.items set imei_last4 = right(new.imei_full, 4) where id = new.item_id;
  return new;
end $$;
create trigger item_private_sync_last4 after insert or update of imei_full on public.item_private
  for each row execute function public.sync_imei_last4();

-- 8. Ảnh: chỉ server (service role) được ghi, sau khi đã xóa EXIF. Ảnh chứng từ chỉ chủ món và admin xem.
create policy item_media_read on public.item_media for select to anon, authenticated
  using (
    (kind = 'photo' and exists (select 1 from public.items i where i.id = item_id and i.status = 'active'))
    or owner_id = auth.uid()
    or public.is_admin()
  );

-- 8b. Nhật ký duyệt món: admin đọc tất cả; chủ món chỉ đọc lý do từ chối món của mình. Chỉ admin_review_item ghi.
create policy item_reviews_admin_read on public.item_reviews for select to authenticated using (public.is_admin());
create policy item_reviews_owner_read on public.item_reviews for select to authenticated
  using (not approved and exists (select 1 from public.items i where i.id = item_id and i.owner_id = auth.uid()));

-- 9. Mong muốn đổi lấy: hiện theo quyền xem món; chỉ chủ món thêm hoặc xóa.
grant insert (item_id, want_type, wanted_item_id, category_id, keyword), delete on public.item_wants to authenticated;
create policy item_wants_read on public.item_wants for select to anon, authenticated
  using (exists (select 1 from public.items i where i.id = item_id));
create policy item_wants_insert_own on public.item_wants for insert to authenticated
  with check (exists (select 1 from public.items i where i.id = item_id and i.owner_id = auth.uid()));
create policy item_wants_delete_own on public.item_wants for delete to authenticated
  using (exists (select 1 from public.items i where i.id = item_id and i.owner_id = auth.uid()));

-- 10. Supabase Storage: tệp đọc được khi dòng item_media tương ứng đọc được. Chỉ service role ghi.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects') then
    insert into storage.buckets (id, name, public) values ('item-media', 'item-media', false)
      on conflict (id) do nothing;
    insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true)
      on conflict (id) do nothing;
    execute $policy$
      create policy "item media readable like item_media rows" on storage.objects for select to anon, authenticated
      using (bucket_id = 'item-media' and exists (
        select 1 from public.item_media m where m.storage_path = storage.objects.name))
    $policy$;
  end if;
end $$;

-- 11. Chốt quyền gọi hàm. Đặt cuối file vì Supabase mặc định cho anon và authenticated gọi mọi hàm MỚI TẠO trong
-- schema public: thu hồi sớm thì các hàm tạo sau đó vẫn hở. Thu hồi tất cả, rồi cấp lại đúng danh sách cần thiết.
-- Bộ lọc từ khóa (banned_keyword_severity, texts_severity, item_severity) chỉ chạy bên trong hàm và trigger
-- SECURITY DEFINER, không cấp cho người dùng, để không ai dò được danh sách từ cấm bằng cách gọi hàm.
-- Migration sau này tạo hàm mới phải lặp lại bước thu hồi này; tests/db/hardening.test.ts canh danh sách.
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
grant execute on function public.is_admin(), public.is_active_user(), public.is_banned(uuid) to anon, authenticated;
grant execute on function public.publish_item(uuid), public.withdraw_item(uuid),
  public.admin_review_item(uuid, boolean, text), public.my_profile(), public.my_item_severity(uuid) to authenticated;

insert into app_meta.migrations (version, name, checksum) values ('20261122000200', 'rls', '20d7cc1df873dc2e87a0c1f1545d7a552bcf4c5ee5beff25db6c95917d6e24e5');

-- ===== 20261122000300_reference_data.sql =====
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

insert into app_meta.migrations (version, name, checksum) values ('20261122000300', 'reference_data', '807f79d916d5783319d24a3b911b767934fcb3a4b3759b4afe04451030f9ff6a');

-- ===== 20261122000310_admin_units.sql =====
-- Exchangethings.vn: đơn vị hành chính Việt Nam từ 01/07/2025 (34 tỉnh/thành, 3.321 phường/xã).
-- Nguồn: vietnam-address-database 1.0.0 (npm), MIT License, (c) Quang Tam Vu; theo Nghị quyết 202/2025/QH15, hiệu lực 01/07/2025.
-- File này được sinh bởi scripts/generate-admin-units-sql.mjs; không sửa tay.

insert into public.provinces (code, name, short_name, place_type, region) values
  ('01', 'Thành phố Hà Nội', 'Hà Nội', 'Thành phố Trung Ương', 'north'),
  ('04', 'Cao Bằng', 'Cao Bằng', 'Tỉnh', 'north'),
  ('08', 'Tuyên Quang', 'Tuyên Quang', 'Tỉnh', 'north'),
  ('11', 'Điện Biên', 'Điện Biên', 'Tỉnh', 'north'),
  ('12', 'Lai Châu', 'Lai Châu', 'Tỉnh', 'north'),
  ('14', 'Sơn La', 'Sơn La', 'Tỉnh', 'north'),
  ('15', 'Lào Cai', 'Lào Cai', 'Tỉnh', 'north'),
  ('19', 'Thái Nguyên', 'Thái Nguyên', 'Tỉnh', 'north'),
  ('20', 'Lạng Sơn', 'Lạng Sơn', 'Tỉnh', 'north'),
  ('22', 'Quảng Ninh', 'Quảng Ninh', 'Tỉnh', 'north'),
  ('24', 'Bắc Ninh', 'Bắc Ninh', 'Tỉnh', 'north'),
  ('25', 'Phú Thọ', 'Phú Thọ', 'Tỉnh', 'north'),
  ('31', 'Thành phố Hải Phòng', 'Hải Phòng', 'Thành phố Trung Ương', 'north'),
  ('33', 'Hưng Yên', 'Hưng Yên', 'Tỉnh', 'north'),
  ('37', 'Ninh Bình', 'Ninh Bình', 'Tỉnh', 'north'),
  ('38', 'Thanh Hóa', 'Thanh Hóa', 'Tỉnh', 'central'),
  ('40', 'Nghệ An', 'Nghệ An', 'Tỉnh', 'central'),
  ('42', 'Hà Tĩnh', 'Hà Tĩnh', 'Tỉnh', 'central'),
  ('44', 'Quảng Trị', 'Quảng Trị', 'Tỉnh', 'central'),
  ('46', 'Thành phố Huế', 'Huế', 'Thành phố Trung Ương', 'central'),
  ('48', 'Thành phố Đà Nẵng', 'Đà Nẵng', 'Thành phố Trung Ương', 'central'),
  ('51', 'Quảng Ngãi', 'Quảng Ngãi', 'Tỉnh', 'central'),
  ('52', 'Gia Lai', 'Gia Lai', 'Tỉnh', 'central'),
  ('56', 'Khánh Hòa', 'Khánh Hòa', 'Tỉnh', 'central'),
  ('66', 'Đắk Lắk', 'Đắk Lắk', 'Tỉnh', 'central'),
  ('68', 'Lâm Đồng', 'Lâm Đồng', 'Tỉnh', 'central'),
  ('75', 'Đồng Nai', 'Đồng Nai', 'Tỉnh', 'south'),
  ('79', 'Thành phố Hồ Chí Minh', 'TP.HCM', 'Thành phố Trung Ương', 'south'),
  ('80', 'Tây Ninh', 'Tây Ninh', 'Tỉnh', 'south'),
  ('82', 'Đồng Tháp', 'Đồng Tháp', 'Tỉnh', 'south'),
  ('86', 'Vĩnh Long', 'Vĩnh Long', 'Tỉnh', 'south'),
  ('91', 'An Giang', 'An Giang', 'Tỉnh', 'south'),
  ('92', 'Thành phố Cần Thơ', 'Cần Thơ', 'Thành phố Trung Ương', 'south'),
  ('96', 'Cà Mau', 'Cà Mau', 'Tỉnh', 'south');

insert into public.wards (code, name, province_code) values
  ('00004', 'Phường Ba Đình', '01'),
  ('00008', 'Phường Ngọc Hà', '01'),
  ('00025', 'Phường Giảng Võ', '01'),
  ('00070', 'Phường Hoàn Kiếm', '01'),
  ('00082', 'Phường Cửa Nam', '01'),
  ('00091', 'Phường Phú Thượng', '01'),
  ('00097', 'Phường Hồng Hà', '01'),
  ('00103', 'Phường Tây Hồ', '01'),
  ('00118', 'Phường Bồ Đề', '01'),
  ('00127', 'Phường Việt Hưng', '01'),
  ('00136', 'Phường Phúc Lợi', '01'),
  ('00145', 'Phường Long Biên', '01'),
  ('00160', 'Phường Nghĩa Đô', '01'),
  ('00166', 'Phường Cầu Giấy', '01'),
  ('00175', 'Phường Yên Hòa', '01'),
  ('00190', 'Phường Ô Chợ Dừa', '01'),
  ('00199', 'Phường Láng', '01'),
  ('00226', 'Phường Văn Miếu - Quốc Tử Giám', '01'),
  ('00229', 'Phường Kim Liên', '01'),
  ('00235', 'Phường Đống Đa', '01'),
  ('00256', 'Phường Hai Bà Trưng', '01'),
  ('00283', 'Phường Vĩnh Tuy', '01'),
  ('00292', 'Phường Bạch Mai', '01'),
  ('00301', 'Phường Vĩnh Hưng', '01'),
  ('00316', 'Phường Định Công', '01'),
  ('00322', 'Phường Tương Mai', '01'),
  ('00328', 'Phường Lĩnh Nam', '01'),
  ('00331', 'Phường Hoàng Mai', '01'),
  ('00337', 'Phường Hoàng Liệt', '01'),
  ('00340', 'Phường Yên Sở', '01'),
  ('00352', 'Phường Phương Liệt', '01'),
  ('00364', 'Phường Khương Đình', '01'),
  ('00367', 'Phường Thanh Xuân', '01'),
  ('00376', 'Xã Sóc Sơn', '01'),
  ('00382', 'Xã Kim Anh', '01'),
  ('00385', 'Xã Trung Giã', '01'),
  ('00430', 'Xã Đa Phúc', '01'),
  ('00433', 'Xã Nội Bài', '01'),
  ('00454', 'Xã Đông Anh', '01'),
  ('00466', 'Xã Phúc Thịnh', '01'),
  ('00475', 'Xã Thư Lâm', '01'),
  ('00493', 'Xã Thiên Lộc', '01'),
  ('00508', 'Xã Vĩnh Thanh', '01'),
  ('00541', 'Xã Phù Đổng', '01'),
  ('00562', 'Xã Thuận An', '01'),
  ('00565', 'Xã Gia Lâm', '01'),
  ('00577', 'Xã Bát Tràng', '01'),
  ('00592', 'Phường Từ Liêm', '01'),
  ('00598', 'Phường Thượng Cát', '01'),
  ('00602', 'Phường Đông Ngạc', '01'),
  ('00611', 'Phường Xuân Đỉnh', '01'),
  ('00613', 'Phường Tây Tựu', '01'),
  ('00619', 'Phường Phú Diễn', '01'),
  ('00622', 'Phường Xuân Phương', '01'),
  ('00634', 'Phường Tây Mỗ', '01'),
  ('00637', 'Phường Đại Mỗ', '01'),
  ('00640', 'Xã Thanh Trì', '01'),
  ('00643', 'Phường Thanh Liệt', '01'),
  ('00664', 'Xã Đại Thanh', '01'),
  ('00679', 'Xã Ngọc Hồi', '01'),
  ('00685', 'Xã Nam Phù', '01'),
  ('00691', 'Phường Hà Giang 2', '08'),
  ('00694', 'Phường Hà Giang 1', '08'),
  ('00700', 'Xã Ngọc Đường', '08'),
  ('00706', 'Xã Phú Linh', '08'),
  ('00715', 'Xã Lũng Cú', '08'),
  ('00721', 'Xã Đồng Văn', '08'),
  ('00733', 'Xã Sà Phìn', '08'),
  ('00745', 'Xã Phố Bảng', '08'),
  ('00763', 'Xã Lũng Phìn', '08'),
  ('00769', 'Xã Mèo Vạc', '08'),
  ('00778', 'Xã Sơn Vĩ', '08'),
  ('00787', 'Xã Sủng Máng', '08'),
  ('00802', 'Xã Khâu Vai', '08'),
  ('00808', 'Xã Tát Ngà', '08'),
  ('00817', 'Xã Niêm Sơn', '08'),
  ('00820', 'Xã Yên Minh', '08'),
  ('00829', 'Xã Thắng Mố', '08'),
  ('00832', 'Xã Bạch Đích', '08'),
  ('00847', 'Xã Mậu Duệ', '08'),
  ('00859', 'Xã Ngọc Long', '08'),
  ('00865', 'Xã Đường Thượng', '08'),
  ('00871', 'Xã Du Già', '08'),
  ('00874', 'Xã Quản Bạ', '08'),
  ('00883', 'Xã Cán Tỷ', '08'),
  ('00889', 'Xã Nghĩa Thuận', '08'),
  ('00892', 'Xã Tùng Vài', '08'),
  ('00901', 'Xã Lùng Tám', '08'),
  ('00913', 'Xã Vị Xuyên', '08'),
  ('00919', 'Xã Minh Tân', '08'),
  ('00922', 'Xã Thuận Hòa', '08'),
  ('00925', 'Xã Tùng Bá', '08'),
  ('00928', 'Xã Thanh Thủy', '08'),
  ('00937', 'Xã Lao Chải', '08'),
  ('00952', 'Xã Cao Bồ', '08'),
  ('00958', 'Xã Thượng Sơn', '08'),
  ('00967', 'Xã Việt Lâm', '08'),
  ('00970', 'Xã Linh Hồ', '08'),
  ('00976', 'Xã Bạch Ngọc', '08'),
  ('00982', 'Xã Minh Sơn', '08'),
  ('00985', 'Xã Giáp Trung', '08'),
  ('00991', 'Xã Bắc Mê', '08'),
  ('00994', 'Xã Minh Ngọc', '08'),
  ('01006', 'Xã Yên Cường', '08'),
  ('01012', 'Xã Đường Hồng', '08'),
  ('01021', 'Xã Hoàng Su Phì', '08'),
  ('01024', 'Xã Bản Máy', '08'),
  ('01033', 'Xã Thàng Tín', '08'),
  ('01051', 'Xã Tân Tiến', '08'),
  ('01057', 'Xã Pờ Ly Ngài', '08'),
  ('01075', 'Xã Nậm Dịch', '08'),
  ('01084', 'Xã Hồ Thầu', '08'),
  ('01090', 'Xã Thông Nguyên', '08'),
  ('01096', 'Xã Pà Vầy Sủ', '08'),
  ('01108', 'Xã Xín Mần', '08'),
  ('01117', 'Xã Trung Thịnh', '08'),
  ('01141', 'Xã Nấm Dẩn', '08'),
  ('01144', 'Xã Quảng Nguyên', '08'),
  ('01147', 'Xã Khuôn Lùng', '08'),
  ('01153', 'Xã Bắc Quang', '08'),
  ('01156', 'Xã Vĩnh Tuy', '08'),
  ('01165', 'Xã Đồng Tâm', '08'),
  ('01171', 'Xã Tân Quang', '08'),
  ('01180', 'Xã Bằng Hành', '08'),
  ('01192', 'Xã Liên Hiệp', '08'),
  ('01201', 'Xã Hùng An', '08'),
  ('01216', 'Xã Đồng Yên', '08'),
  ('01225', 'Xã Tiên Nguyên', '08'),
  ('01234', 'Xã Yên Thành', '08'),
  ('01237', 'Xã Quang Bình', '08'),
  ('01243', 'Xã Tân Trịnh', '08'),
  ('01246', 'Xã Bằng Lang', '08'),
  ('01255', 'Xã Xuân Giang', '08'),
  ('01261', 'Xã Tiên Yên', '08'),
  ('01273', 'Phường Thục Phán', '04'),
  ('01279', 'Phường Nùng Trí Cao', '04'),
  ('01288', 'Phường Tân Giang', '04'),
  ('01290', 'Xã Bảo Lâm', '04'),
  ('01294', 'Xã Lý Bôn', '04'),
  ('01297', 'Xã Nam Quang', '04'),
  ('01304', 'Xã Quảng Lâm', '04'),
  ('01318', 'Xã Yên Thổ', '04'),
  ('01321', 'Xã Bảo Lạc', '04'),
  ('01324', 'Xã Cốc Pàng', '04'),
  ('01327', 'Xã Cô Ba', '04'),
  ('01336', 'Xã Khánh Xuân', '04'),
  ('01339', 'Xã Xuân Trường', '04'),
  ('01351', 'Xã Hưng Đạo', '04'),
  ('01354', 'Xã Huy Giáp', '04'),
  ('01360', 'Xã Sơn Lộ', '04'),
  ('01363', 'Xã Thông Nông', '04'),
  ('01366', 'Xã Cần Yên', '04'),
  ('01387', 'Xã Thanh Long', '04'),
  ('01392', 'Xã Trường Hà', '04'),
  ('01393', 'Xã Lũng Nặm', '04'),
  ('01414', 'Xã Tổng Cọt', '04'),
  ('01438', 'Xã Hà Quảng', '04'),
  ('01447', 'Xã Trà Lĩnh', '04'),
  ('01456', 'Xã Quang Hán', '04'),
  ('01465', 'Xã Quang Trung', '04'),
  ('01477', 'Xã Trùng Khánh', '04'),
  ('01489', 'Xã Đình Phong', '04'),
  ('01501', 'Xã Đàm Thủy', '04'),
  ('01525', 'Xã Đoài Dương', '04'),
  ('01537', 'Xã Lý Quốc', '04'),
  ('01552', 'Xã Quang Long', '04'),
  ('01558', 'Xã Hạ Lang', '04'),
  ('01561', 'Xã Vinh Quý', '04'),
  ('01576', 'Xã Quảng Uyên', '04'),
  ('01594', 'Xã Độc Lập', '04'),
  ('01618', 'Xã Hạnh Phúc', '04'),
  ('01636', 'Xã Bế Văn Đàn', '04'),
  ('01648', 'Xã Phục Hòa', '04'),
  ('01654', 'Xã Hòa An', '04'),
  ('01660', 'Xã Nam Tuấn', '04'),
  ('01699', 'Xã Nguyễn Huệ', '04'),
  ('01708', 'Xã Bạch Đằng', '04'),
  ('01726', 'Xã Nguyên Bình', '04'),
  ('01729', 'Xã Tĩnh Túc', '04'),
  ('01738', 'Xã Ca Thành', '04'),
  ('01747', 'Xã Minh Tâm', '04'),
  ('01768', 'Xã Phan Thanh', '04'),
  ('01774', 'Xã Tam Kim', '04'),
  ('01777', 'Xã Thành Công', '04'),
  ('01786', 'Xã Đông Khê', '04'),
  ('01789', 'Xã Canh Tân', '04'),
  ('01792', 'Xã Kim Đồng', '04'),
  ('01795', 'Xã Minh Khai', '04'),
  ('01807', 'Xã Thạch An', '04'),
  ('01822', 'Xã Đức Long', '04'),
  ('01840', 'Phường Đức Xuân', '19'),
  ('01843', 'Phường Bắc Kạn', '19'),
  ('01849', 'Xã Phong Quang', '19'),
  ('01864', 'Xã Bằng Thành', '19'),
  ('01879', 'Xã Cao Minh', '19'),
  ('01882', 'Xã Nghiên Loan', '19'),
  ('01894', 'Xã Phúc Lộc', '19'),
  ('01906', 'Xã Ba Bể', '19'),
  ('01912', 'Xã Chợ Rã', '19'),
  ('01921', 'Xã Thượng Minh', '19'),
  ('01933', 'Xã Đồng Phúc', '19'),
  ('01936', 'Xã Nà Phặc', '19'),
  ('01942', 'Xã Bằng Vân', '19'),
  ('01954', 'Xã Ngân Sơn', '19'),
  ('01957', 'Xã Thượng Quan', '19'),
  ('01960', 'Xã Hiệp Lực', '19'),
  ('01969', 'Xã Phủ Thông', '19'),
  ('01981', 'Xã Vĩnh Thông', '19'),
  ('02008', 'Xã Cẩm Giàng', '19'),
  ('02014', 'Xã Bạch Thông', '19'),
  ('02020', 'Xã Chợ Đồn', '19'),
  ('02026', 'Xã Nam Cường', '19'),
  ('02038', 'Xã Quảng Bạch', '19'),
  ('02044', 'Xã Yên Thịnh', '19'),
  ('02071', 'Xã Nghĩa Tá', '19'),
  ('02083', 'Xã Yên Phong', '19'),
  ('02086', 'Xã Chợ Mới', '19'),
  ('02101', 'Xã Thanh Mai', '19'),
  ('02104', 'Xã Tân Kỳ', '19'),
  ('02107', 'Xã Thanh Thịnh', '19'),
  ('02116', 'Xã Yên Bình', '19'),
  ('02143', 'Xã Văn Lang', '19'),
  ('02152', 'Xã Cường Lợi', '19'),
  ('02155', 'Xã Na Rì', '19'),
  ('02176', 'Xã Trần Phú', '19'),
  ('02185', 'Xã Côn Minh', '19'),
  ('02191', 'Xã Xuân Dương', '19'),
  ('02212', 'Phường Nông Tiến', '08'),
  ('02215', 'Phường Minh Xuân', '08'),
  ('02221', 'Xã Nà Hang', '08'),
  ('02239', 'Xã Thượng Nông', '08'),
  ('02245', 'Xã Côn Lôn', '08'),
  ('02248', 'Xã Yên Hoa', '08'),
  ('02260', 'Xã Hồng Thái', '08'),
  ('02266', 'Xã Lâm Bình', '08'),
  ('02269', 'Xã Thượng Lâm', '08'),
  ('02287', 'Xã Chiêm Hóa', '08'),
  ('02296', 'Xã Bình An', '08'),
  ('02302', 'Xã Minh Quang', '08'),
  ('02305', 'Xã Trung Hà', '08'),
  ('02308', 'Xã Tân Mỹ', '08'),
  ('02317', 'Xã Yên Lập', '08'),
  ('02320', 'Xã Tân An', '08'),
  ('02332', 'Xã Kiên Đài', '08'),
  ('02350', 'Xã Kim Bình', '08'),
  ('02353', 'Xã Hòa An', '08'),
  ('02359', 'Xã Tri Phú', '08'),
  ('02365', 'Xã Yên Nguyên', '08'),
  ('02374', 'Xã Hàm Yên', '08'),
  ('02380', 'Xã Bạch Xa', '08'),
  ('02392', 'Xã Phù Lưu', '08'),
  ('02398', 'Xã Yên Phú', '08'),
  ('02404', 'Xã Bình Xa', '08'),
  ('02407', 'Xã Thái Sơn', '08'),
  ('02419', 'Xã Thái Hòa', '08'),
  ('02425', 'Xã Hùng Đức', '08'),
  ('02434', 'Xã Lực Hành', '08'),
  ('02437', 'Xã Kiến Thiết', '08'),
  ('02449', 'Xã Xuân Vân', '08'),
  ('02455', 'Xã Hùng Lợi', '08'),
  ('02458', 'Xã Trung Sơn', '08'),
  ('02470', 'Xã Tân Long', '08'),
  ('02473', 'Xã Yên Sơn', '08'),
  ('02494', 'Xã Thái Bình', '08'),
  ('02509', 'Phường Mỹ Lâm', '08'),
  ('02512', 'Phường An Tường', '08'),
  ('02524', 'Phường Bình Thuận', '08'),
  ('02530', 'Xã Nhữ Khê', '08'),
  ('02536', 'Xã Sơn Dương', '08'),
  ('02545', 'Xã Tân Trào', '08'),
  ('02548', 'Xã Bình Ca', '08'),
  ('02554', 'Xã Minh Thanh', '08'),
  ('02572', 'Xã Đông Thọ', '08'),
  ('02578', 'Xã Tân Thanh', '08'),
  ('02608', 'Xã Hồng Sơn', '08'),
  ('02611', 'Xã Phú Lương', '08'),
  ('02620', 'Xã Sơn Thủy', '08'),
  ('02623', 'Xã Trường Sinh', '08'),
  ('02647', 'Phường Lào Cai', '15'),
  ('02671', 'Phường Cam Đường', '15'),
  ('02680', 'Xã Hợp Thành', '15'),
  ('02683', 'Xã Bát Xát', '15'),
  ('02686', 'Xã A Mú Sung', '15'),
  ('02695', 'Xã Trịnh Tường', '15'),
  ('02701', 'Xã Y Tý', '15'),
  ('02707', 'Xã Dền Sáng', '15'),
  ('02725', 'Xã Bản Xèo', '15'),
  ('02728', 'Xã Mường Hum', '15'),
  ('02746', 'Xã Cốc San', '15'),
  ('02752', 'Xã Pha Long', '15'),
  ('02761', 'Xã Mường Khương', '15'),
  ('02782', 'Xã Cao Sơn', '15'),
  ('02788', 'Xã Bản Lầu', '15'),
  ('02809', 'Xã Si Ma Cai', '15'),
  ('02824', 'Xã Sín Chéng', '15'),
  ('02839', 'Xã Bắc Hà', '15'),
  ('02842', 'Xã Tả Củ Tỷ', '15'),
  ('02848', 'Xã Lùng Phình', '15'),
  ('02869', 'Xã Bản Liền', '15'),
  ('02890', 'Xã Bảo Nhai', '15'),
  ('02896', 'Xã Cốc Lầu', '15'),
  ('02902', 'Xã Phong Hải', '15'),
  ('02905', 'Xã Bảo Thắng', '15'),
  ('02908', 'Xã Tằng Loỏng', '15'),
  ('02923', 'Xã Gia Phú', '15'),
  ('02926', 'Xã Xuân Quang', '15'),
  ('02947', 'Xã Bảo Yên', '15'),
  ('02953', 'Xã Nghĩa Đô', '15'),
  ('02962', 'Xã Xuân Hòa', '15'),
  ('02968', 'Xã Thượng Hà', '15'),
  ('02989', 'Xã Bảo Hà', '15'),
  ('02998', 'Xã Phúc Khánh', '15'),
  ('03004', 'Xã Ngũ Chỉ Sơn', '15'),
  ('03006', 'Phường Sa Pa', '15'),
  ('03013', 'Xã Tả Phìn', '15'),
  ('03037', 'Xã Tả Van', '15'),
  ('03043', 'Xã Mường Bo', '15'),
  ('03046', 'Xã Bản Hồ', '15'),
  ('03061', 'Xã Võ Lao', '15'),
  ('03076', 'Xã Nậm Chày', '15'),
  ('03082', 'Xã Văn Bàn', '15'),
  ('03085', 'Xã Nậm Xé', '15'),
  ('03091', 'Xã Chiềng Ken', '15'),
  ('03103', 'Xã Khánh Yên', '15'),
  ('03106', 'Xã Dương Quỳ', '15'),
  ('03121', 'Xã Minh Lương', '15'),
  ('03127', 'Phường Điện Biên Phủ', '11'),
  ('03151', 'Phường Mường Lay', '11'),
  ('03158', 'Xã Sín Thầu', '11'),
  ('03160', 'Xã Mường Nhé', '11'),
  ('03162', 'Xã Nậm Kè', '11'),
  ('03163', 'Xã Mường Toong', '11'),
  ('03164', 'Xã Quảng Lâm', '11'),
  ('03166', 'Xã Mường Chà', '11'),
  ('03169', 'Xã Nà Hỳ', '11'),
  ('03172', 'Xã Na Sang', '11'),
  ('03175', 'Xã Chà Tở', '11'),
  ('03176', 'Xã Nà Bủng', '11'),
  ('03181', 'Xã Mường Tùng', '11'),
  ('03193', 'Xã Pa Ham', '11'),
  ('03194', 'Xã Nậm Nèn', '11'),
  ('03199', 'Xã Si Pa Phìn', '11'),
  ('03202', 'Xã Mường Pồn', '11'),
  ('03203', 'Xã Na Son', '11'),
  ('03208', 'Xã Xa Dung', '11'),
  ('03214', 'Xã Mường Luân', '11'),
  ('03217', 'Xã Tủa Chùa', '11'),
  ('03220', 'Xã Tủa Thàng', '11'),
  ('03226', 'Xã Sín Chải', '11'),
  ('03241', 'Xã Sính Phình', '11'),
  ('03244', 'Xã Sáng Nhè', '11'),
  ('03253', 'Xã Tuần Giáo', '11'),
  ('03256', 'Xã Mường Ảng', '11'),
  ('03260', 'Xã Pú Nhung', '11'),
  ('03268', 'Xã Mường Mùn', '11'),
  ('03283', 'Xã Chiềng Sinh', '11'),
  ('03295', 'Xã Quài Tở', '11'),
  ('03301', 'Xã Búng Lao', '11'),
  ('03313', 'Xã Mường Lạn', '11'),
  ('03316', 'Xã Nà Tấu', '11'),
  ('03325', 'Xã Mường Phăng', '11'),
  ('03328', 'Xã Thanh Nưa', '11'),
  ('03334', 'Phường Mường Thanh', '11'),
  ('03349', 'Xã Thanh Yên', '11'),
  ('03352', 'Xã Thanh An', '11'),
  ('03356', 'Xã Sam Mứn', '11'),
  ('03358', 'Xã Núa Ngam', '11'),
  ('03368', 'Xã Mường Nhà', '11'),
  ('03370', 'Xã Pu Nhi', '11'),
  ('03382', 'Xã Phình Giàng', '11'),
  ('03385', 'Xã Tìa Dình', '11'),
  ('03388', 'Phường Đoàn Kết', '12'),
  ('03390', 'Xã Bình Lư', '12'),
  ('03394', 'Xã Sin Suối Hồ', '12'),
  ('03405', 'Xã Tả Lèng', '12'),
  ('03408', 'Phường Tân Phong', '12'),
  ('03424', 'Xã Bản Bo', '12'),
  ('03430', 'Xã Khun Há', '12'),
  ('03433', 'Xã Bum Tở', '12'),
  ('03434', 'Xã Nậm Hàng', '12'),
  ('03439', 'Xã Thu Lũm', '12'),
  ('03442', 'Xã Pa Ủ', '12'),
  ('03445', 'Xã Mường Tè', '12'),
  ('03451', 'Xã Mù Cả', '12'),
  ('03460', 'Xã Hua Bum', '12'),
  ('03463', 'Xã Tà Tổng', '12'),
  ('03466', 'Xã Bum Nưa', '12'),
  ('03472', 'Xã Mường Mô', '12'),
  ('03478', 'Xã Sìn Hồ', '12'),
  ('03487', 'Xã Lê Lợi', '12'),
  ('03503', 'Xã Pa Tần', '12'),
  ('03508', 'Xã Hồng Thu', '12'),
  ('03517', 'Xã Nậm Tăm', '12'),
  ('03529', 'Xã Tủa Sín Chải', '12'),
  ('03532', 'Xã Pu Sam Cáp', '12'),
  ('03538', 'Xã Nậm Mạ', '12'),
  ('03544', 'Xã Nậm Cuổi', '12'),
  ('03549', 'Xã Phong Thổ', '12'),
  ('03562', 'Xã Sì Lở Lầu', '12'),
  ('03571', 'Xã Dào San', '12'),
  ('03583', 'Xã Khổng Lào', '12'),
  ('03595', 'Xã Than Uyên', '12'),
  ('03598', 'Xã Tân Uyên', '12'),
  ('03601', 'Xã Mường Khoa', '12'),
  ('03613', 'Xã Nậm Sỏ', '12'),
  ('03616', 'Xã Pắc Ta', '12'),
  ('03618', 'Xã Mường Than', '12'),
  ('03637', 'Xã Mường Kim', '12'),
  ('03640', 'Xã Khoen On', '12'),
  ('03646', 'Phường Tô Hiệu', '14'),
  ('03664', 'Phường Chiềng An', '14'),
  ('03670', 'Phường Chiềng Cơi', '14'),
  ('03679', 'Phường Chiềng Sinh', '14'),
  ('03688', 'Xã Mường Chiên', '14'),
  ('03694', 'Xã Mường Giôn', '14'),
  ('03703', 'Xã Quỳnh Nhai', '14'),
  ('03712', 'Xã Mường Sại', '14'),
  ('03721', 'Xã Thuận Châu', '14'),
  ('03724', 'Xã Bình Thuận', '14'),
  ('03727', 'Xã Mường É', '14'),
  ('03754', 'Xã Chiềng La', '14'),
  ('03757', 'Xã Mường Khiêng', '14'),
  ('03760', 'Xã Mường Bám', '14'),
  ('03763', 'Xã Long Hẹ', '14'),
  ('03781', 'Xã Co Mạ', '14'),
  ('03784', 'Xã Nậm Lầu', '14'),
  ('03799', 'Xã Muổi Nọi', '14'),
  ('03808', 'Xã Mường La', '14'),
  ('03814', 'Xã Chiềng Lao', '14'),
  ('03820', 'Xã Ngọc Chiến', '14'),
  ('03847', 'Xã Mường Bú', '14'),
  ('03850', 'Xã Chiềng Hoa', '14'),
  ('03856', 'Xã Bắc Yên', '14'),
  ('03862', 'Xã Xím Vàng', '14'),
  ('03868', 'Xã Tà Xùa', '14'),
  ('03871', 'Xã Pắc Ngà', '14'),
  ('03880', 'Xã Tạ Khoa', '14'),
  ('03892', 'Xã Chiềng Sại', '14'),
  ('03901', 'Xã Suối Tọ', '14'),
  ('03907', 'Xã Mường Cơi', '14'),
  ('03910', 'Xã Phù Yên', '14'),
  ('03922', 'Xã Gia Phù', '14'),
  ('03943', 'Xã Mường Bang', '14'),
  ('03958', 'Xã Tường Hạ', '14'),
  ('03961', 'Xã Kim Bon', '14'),
  ('03970', 'Xã Tân Phong', '14'),
  ('03979', 'Phường Mộc Sơn', '14'),
  ('03980', 'Phường Mộc Châu', '14'),
  ('03982', 'Phường Thảo Nguyên', '14'),
  ('03985', 'Xã Chiềng Sơn', '14'),
  ('03997', 'Xã Tân Yên', '14'),
  ('04000', 'Xã Đoàn Kết', '14'),
  ('04006', 'Xã Song Khủa', '14'),
  ('04018', 'Xã Tô Múa', '14'),
  ('04033', 'Phường Vân Sơn', '14'),
  ('04045', 'Xã Lóng Sập', '14'),
  ('04048', 'Xã Vân Hồ', '14'),
  ('04057', 'Xã Xuân Nha', '14'),
  ('04075', 'Xã Yên Châu', '14'),
  ('04078', 'Xã Chiềng Hặc', '14'),
  ('04087', 'Xã Yên Sơn', '14'),
  ('04096', 'Xã Lóng Phiêng', '14'),
  ('04099', 'Xã Phiêng Khoài', '14'),
  ('04105', 'Xã Mai Sơn', '14'),
  ('04108', 'Xã Chiềng Sung', '14'),
  ('04117', 'Xã Mường Chanh', '14'),
  ('04123', 'Xã Chiềng Mung', '14'),
  ('04132', 'Xã Chiềng Mai', '14'),
  ('04136', 'Xã Tà Hộc', '14'),
  ('04144', 'Xã Phiêng Cằm', '14'),
  ('04159', 'Xã Phiêng Pằn', '14'),
  ('04168', 'Xã Sông Mã', '14'),
  ('04171', 'Xã Bó Sinh', '14'),
  ('04183', 'Xã Mường Lầm', '14'),
  ('04186', 'Xã Nậm Ty', '14'),
  ('04195', 'Xã Chiềng Sơ', '14'),
  ('04204', 'Xã Chiềng Khoong', '14'),
  ('04210', 'Xã Huổi Một', '14'),
  ('04219', 'Xã Mường Hung', '14'),
  ('04222', 'Xã Chiềng Khương', '14'),
  ('04228', 'Xã Púng Bánh', '14'),
  ('04231', 'Xã Sốp Cộp', '14'),
  ('04240', 'Xã Mường Lèo', '14'),
  ('04246', 'Xã Mường Lạn', '14'),
  ('04252', 'Phường Yên Bái', '15'),
  ('04273', 'Phường Nam Cường', '15'),
  ('04279', 'Phường Văn Phú', '15'),
  ('04288', 'Phường Nghĩa Lộ', '15'),
  ('04303', 'Xã Lục Yên', '15'),
  ('04309', 'Xã Lâm Thượng', '15'),
  ('04336', 'Xã Tân Lĩnh', '15'),
  ('04342', 'Xã Khánh Hòa', '15'),
  ('04345', 'Xã Mường Lai', '15'),
  ('04363', 'Xã Phúc Lợi', '15'),
  ('04375', 'Xã Mậu A', '15'),
  ('04381', 'Xã Lâm Giang', '15'),
  ('04387', 'Xã Châu Quế', '15'),
  ('04399', 'Xã Đông Cuông', '15'),
  ('04402', 'Xã Phong Dụ Hạ', '15'),
  ('04423', 'Xã Phong Dụ Thượng', '15');

insert into public.wards (code, name, province_code) values
  ('04429', 'Xã Tân Hợp', '15'),
  ('04441', 'Xã Xuân Ái', '15'),
  ('04450', 'Xã Mỏ Vàng', '15'),
  ('04456', 'Xã Mù Cang Chải', '15'),
  ('04462', 'Xã Nậm Có', '15'),
  ('04465', 'Xã Khao Mang', '15'),
  ('04474', 'Xã Lao Chải', '15'),
  ('04489', 'Xã Chế Tạo', '15'),
  ('04492', 'Xã Púng Luông', '15'),
  ('04498', 'Xã Trấn Yên', '15'),
  ('04531', 'Xã Quy Mông', '15'),
  ('04537', 'Xã Lương Thịnh', '15'),
  ('04543', 'Phường Âu Lâu', '15'),
  ('04564', 'Xã Việt Hồng', '15'),
  ('04576', 'Xã Hưng Khánh', '15'),
  ('04585', 'Xã Hạnh Phúc', '15'),
  ('04603', 'Xã Tà Xi Láng', '15'),
  ('04606', 'Xã Trạm Tấu', '15'),
  ('04609', 'Xã Phình Hồ', '15'),
  ('04630', 'Xã Tú Lệ', '15'),
  ('04636', 'Xã Gia Hội', '15'),
  ('04651', 'Xã Sơn Lương', '15'),
  ('04660', 'Xã Liên Sơn', '15'),
  ('04663', 'Phường Trung Tâm', '15'),
  ('04672', 'Xã Văn Chấn', '15'),
  ('04681', 'Phường Cầu Thia', '15'),
  ('04693', 'Xã Cát Thịnh', '15'),
  ('04699', 'Xã Chấn Thịnh', '15'),
  ('04705', 'Xã Thượng Bằng La', '15'),
  ('04711', 'Xã Nghĩa Tâm', '15'),
  ('04714', 'Xã Yên Bình', '15'),
  ('04717', 'Xã Thác Bà', '15'),
  ('04726', 'Xã Cảm Nhân', '15'),
  ('04744', 'Xã Yên Thành', '15'),
  ('04750', 'Xã Bảo Ái', '15'),
  ('04792', 'Phường Tân Hòa', '25'),
  ('04795', 'Phường Hòa Bình', '25'),
  ('04828', 'Phường Thống Nhất', '25'),
  ('04831', 'Xã Đà Bắc', '25'),
  ('04846', 'Xã Đức Nhàn', '25'),
  ('04849', 'Xã Tân Pheo', '25'),
  ('04873', 'Xã Quy Đức', '25'),
  ('04876', 'Xã Cao Sơn', '25'),
  ('04891', 'Xã Tiền Phong', '25'),
  ('04894', 'Phường Kỳ Sơn', '25'),
  ('04897', 'Xã Thịnh Minh', '25'),
  ('04924', 'Xã Lương Sơn', '25'),
  ('04930', 'Xã Yên Xuân', '01'),
  ('04960', 'Xã Liên Sơn', '25'),
  ('04978', 'Xã Kim Bôi', '25'),
  ('04990', 'Xã Nật Sơn', '25'),
  ('05014', 'Xã Mường Động', '25'),
  ('05047', 'Xã Cao Dương', '25'),
  ('05068', 'Xã Hợp Kim', '25'),
  ('05086', 'Xã Dũng Tiến', '25'),
  ('05089', 'Xã Cao Phong', '25'),
  ('05092', 'Xã Thung Nai', '25'),
  ('05116', 'Xã Mường Thàng', '25'),
  ('05128', 'Xã Tân Lạc', '25'),
  ('05134', 'Xã Mường Hoa', '25'),
  ('05152', 'Xã Vân Sơn', '25'),
  ('05158', 'Xã Mường Bi', '25'),
  ('05191', 'Xã Toàn Thắng', '25'),
  ('05200', 'Xã Mai Châu', '25'),
  ('05206', 'Xã Tân Mai', '25'),
  ('05212', 'Xã Pà Cò', '25'),
  ('05245', 'Xã Bao La', '25'),
  ('05251', 'Xã Mai Hạ', '25'),
  ('05266', 'Xã Lạc Sơn', '25'),
  ('05287', 'Xã Mường Vang', '25'),
  ('05290', 'Xã Nhân Nghĩa', '25'),
  ('05293', 'Xã Thượng Cốc', '25'),
  ('05305', 'Xã Yên Phú', '25'),
  ('05323', 'Xã Quyết Thắng', '25'),
  ('05329', 'Xã Ngọc Sơn', '25'),
  ('05347', 'Xã Đại Đồng', '25'),
  ('05353', 'Xã Yên Thủy', '25'),
  ('05362', 'Xã Lạc Lương', '25'),
  ('05386', 'Xã Yên Trị', '25'),
  ('05392', 'Xã Lạc Thủy', '25'),
  ('05395', 'Xã An Nghĩa', '25'),
  ('05425', 'Xã An Bình', '25'),
  ('05443', 'Phường Phan Đình Phùng', '19'),
  ('05455', 'Phường Quyết Thắng', '19'),
  ('05467', 'Phường Gia Sàng', '19'),
  ('05482', 'Phường Quan Triều', '19'),
  ('05488', 'Xã Đại Phúc', '19'),
  ('05500', 'Phường Tích Lương', '19'),
  ('05503', 'Xã Tân Cương', '19'),
  ('05518', 'Phường Sông Công', '19'),
  ('05528', 'Phường Bách Quang', '19'),
  ('05533', 'Phường Bá Xuyên', '19'),
  ('05542', 'Xã Lam Vỹ', '19'),
  ('05551', 'Xã Kim Phượng', '19'),
  ('05563', 'Xã Phượng Tiến', '19'),
  ('05569', 'Xã Định Hóa', '19'),
  ('05581', 'Xã Trung Hội', '19'),
  ('05587', 'Xã Bình Yên', '19'),
  ('05602', 'Xã Phú Đình', '19'),
  ('05605', 'Xã Bình Thành', '19'),
  ('05611', 'Xã Phú Lương', '19'),
  ('05620', 'Xã Yên Trạch', '19'),
  ('05632', 'Xã Hợp Thành', '19'),
  ('05641', 'Xã Vô Tranh', '19'),
  ('05662', 'Xã Trại Cau', '19'),
  ('05665', 'Xã Văn Lăng', '19'),
  ('05674', 'Xã Quang Sơn', '19'),
  ('05680', 'Xã Văn Hán', '19'),
  ('05692', 'Xã Đồng Hỷ', '19'),
  ('05707', 'Xã Nam Hòa', '19'),
  ('05710', 'Phường Linh Sơn', '19'),
  ('05716', 'Xã Võ Nhai', '19'),
  ('05719', 'Xã Sảng Mộc', '19'),
  ('05722', 'Xã Nghinh Tường', '19'),
  ('05725', 'Xã Thần Sa', '19'),
  ('05740', 'Xã La Hiên', '19'),
  ('05746', 'Xã Tràng Xá', '19'),
  ('05755', 'Xã Dân Tiến', '19'),
  ('05773', 'Xã Phú Xuyên', '19'),
  ('05776', 'Xã Đức Lương', '19'),
  ('05788', 'Xã Phú Lạc', '19'),
  ('05800', 'Xã Phú Thịnh', '19'),
  ('05809', 'Xã An Khánh', '19'),
  ('05818', 'Xã La Bằng', '19'),
  ('05830', 'Xã Đại Từ', '19'),
  ('05845', 'Xã Vạn Phú', '19'),
  ('05851', 'Xã Quân Chu', '19'),
  ('05857', 'Phường Phúc Thuận', '19'),
  ('05860', 'Phường Phổ Yên', '19'),
  ('05881', 'Xã Thành Công', '19'),
  ('05890', 'Phường Vạn Xuân', '19'),
  ('05899', 'Phường Trung Thành', '19'),
  ('05908', 'Xã Phú Bình', '19'),
  ('05917', 'Xã Tân Khánh', '19'),
  ('05923', 'Xã Tân Thành', '19'),
  ('05941', 'Xã Điềm Thụy', '19'),
  ('05953', 'Xã Kha Sơn', '19'),
  ('05977', 'Phường Đông Kinh', '20'),
  ('05983', 'Phường Lương Văn Tri', '20'),
  ('05986', 'Phường Tam Thanh', '20'),
  ('06001', 'Xã Đoàn Kết', '20'),
  ('06004', 'Xã Quốc Khánh', '20'),
  ('06019', 'Xã Tân Tiến', '20'),
  ('06037', 'Xã Kháng Chiến', '20'),
  ('06040', 'Xã Thất Khê', '20'),
  ('06046', 'Xã Tràng Định', '20'),
  ('06058', 'Xã Quốc Việt', '20'),
  ('06073', 'Xã Hoa Thám', '20'),
  ('06076', 'Xã Quý Hòa', '20'),
  ('06079', 'Xã Hồng Phong', '20'),
  ('06085', 'Xã Thiện Hòa', '20'),
  ('06091', 'Xã Thiện Thuật', '20'),
  ('06103', 'Xã Thiện Long', '20'),
  ('06112', 'Xã Bình Gia', '20'),
  ('06115', 'Xã Tân Văn', '20'),
  ('06124', 'Xã Na Sầm', '20'),
  ('06148', 'Xã Thụy Hùng', '20'),
  ('06151', 'Xã Hội Hoan', '20'),
  ('06154', 'Xã Văn Lãng', '20'),
  ('06172', 'Xã Hoàng Văn Thụ', '20'),
  ('06184', 'Xã Đồng Đăng', '20'),
  ('06187', 'Phường Kỳ Lừa', '20'),
  ('06196', 'Xã Ba Sơn', '20'),
  ('06211', 'Xã Cao Lộc', '20'),
  ('06220', 'Xã Công Sơn', '20'),
  ('06253', 'Xã Văn Quan', '20'),
  ('06280', 'Xã Điềm He', '20'),
  ('06286', 'Xã Khánh Khê', '20'),
  ('06298', 'Xã Yên Phúc', '20'),
  ('06313', 'Xã Tri Lễ', '20'),
  ('06316', 'Xã Tân Đoàn', '20'),
  ('06325', 'Xã Bắc Sơn', '20'),
  ('06337', 'Xã Tân Tri', '20'),
  ('06349', 'Xã Hưng Vũ', '20'),
  ('06364', 'Xã Vũ Lễ', '20'),
  ('06367', 'Xã Vũ Lăng', '20'),
  ('06376', 'Xã Nhất Hòa', '20'),
  ('06385', 'Xã Hữu Lũng', '20'),
  ('06391', 'Xã Yên Bình', '20'),
  ('06400', 'Xã Hữu Liên', '20'),
  ('06415', 'Xã Vân Nham', '20'),
  ('06427', 'Xã Cai Kinh', '20'),
  ('06436', 'Xã Thiện Tân', '20'),
  ('06445', 'Xã Tân Thành', '20'),
  ('06457', 'Xã Tuấn Sơn', '20'),
  ('06463', 'Xã Chi Lăng', '20'),
  ('06475', 'Xã Bằng Mạc', '20'),
  ('06481', 'Xã Chiến Thắng', '20'),
  ('06496', 'Xã Nhân Lý', '20'),
  ('06505', 'Xã Vạn Linh', '20'),
  ('06517', 'Xã Quan Sơn', '20'),
  ('06526', 'Xã Na Dương', '20'),
  ('06529', 'Xã Lộc Bình', '20'),
  ('06541', 'Xã Mẫu Sơn', '20'),
  ('06565', 'Xã Khuất Xá', '20'),
  ('06577', 'Xã Thống Nhất', '20'),
  ('06601', 'Xã Lợi Bác', '20'),
  ('06607', 'Xã Xuân Dương', '20'),
  ('06613', 'Xã Đình Lập', '20'),
  ('06616', 'Xã Thái Bình', '20'),
  ('06625', 'Xã Kiên Mộc', '20'),
  ('06637', 'Xã Châu Sơn', '20'),
  ('06652', 'Phường Hà Tu', '22'),
  ('06658', 'Phường Cao Xanh', '22'),
  ('06661', 'Phường Việt Hưng', '22'),
  ('06673', 'Phường Bãi Cháy', '22'),
  ('06676', 'Phường Hà Lầm', '22'),
  ('06685', 'Phường Hồng Gai', '22'),
  ('06688', 'Phường Hạ Long', '22'),
  ('06706', 'Phường Tuần Châu', '22'),
  ('06709', 'Phường Móng Cái 2', '22'),
  ('06712', 'Phường Móng Cái 1', '22'),
  ('06724', 'Xã Hải Sơn', '22'),
  ('06733', 'Xã Hải Ninh', '22'),
  ('06736', 'Phường Móng Cái 3', '22'),
  ('06757', 'Xã Vĩnh Thực', '22'),
  ('06760', 'Phường Mông Dương', '22'),
  ('06778', 'Phường Quang Hanh', '22'),
  ('06781', 'Phường Cửa Ông', '22'),
  ('06793', 'Phường Cẩm Phả', '22'),
  ('06799', 'Xã Hải Hòa', '22'),
  ('06811', 'Phường Uông Bí', '22'),
  ('06820', 'Phường Vàng Danh', '22'),
  ('06832', 'Phường Yên Tử', '22'),
  ('06838', 'Xã Bình Liêu', '22'),
  ('06841', 'Xã Hoành Mô', '22'),
  ('06856', 'Xã Lục Hồn', '22'),
  ('06862', 'Xã Tiên Yên', '22'),
  ('06874', 'Xã Điền Xá', '22'),
  ('06877', 'Xã Đông Ngũ', '22'),
  ('06886', 'Xã Hải Lạng', '22'),
  ('06895', 'Xã Đầm Hà', '22'),
  ('06913', 'Xã Quảng Tân', '22'),
  ('06922', 'Xã Quảng Hà', '22'),
  ('06931', 'Xã Quảng Đức', '22'),
  ('06946', 'Xã Đường Hoa', '22'),
  ('06967', 'Xã Cái Chiên', '22'),
  ('06970', 'Xã Ba Chẽ', '22'),
  ('06979', 'Xã Kỳ Thượng', '22'),
  ('06985', 'Xã Lương Minh', '22'),
  ('06994', 'Đặc khu Vân Đồn', '22'),
  ('07030', 'Phường Hoành Bồ', '22'),
  ('07054', 'Xã Quảng La', '22'),
  ('07060', 'Xã Thống Nhất', '22'),
  ('07069', 'Phường Mạo Khê', '22'),
  ('07081', 'Phường Bình Khê', '22'),
  ('07090', 'Phường An Sinh', '22'),
  ('07093', 'Phường Đông Triều', '22'),
  ('07114', 'Phường Hoàng Quế', '22'),
  ('07132', 'Phường Quảng Yên', '22'),
  ('07135', 'Phường Đông Mai', '22'),
  ('07147', 'Phường Hiệp Hòa', '22'),
  ('07168', 'Phường Hà An', '22'),
  ('07180', 'Phường Liên Hòa', '22'),
  ('07183', 'Phường Phong Cốc', '22'),
  ('07192', 'Đặc khu Cô Tô', '22'),
  ('07210', 'Phường Bắc Giang', '24'),
  ('07228', 'Phường Đa Mai', '24'),
  ('07246', 'Xã Xuân Lương', '24'),
  ('07264', 'Xã Tam Tiến', '24'),
  ('07282', 'Xã Đồng Kỳ', '24'),
  ('07288', 'Xã Yên Thế', '24'),
  ('07294', 'Xã Bố Hạ', '24'),
  ('07306', 'Xã Nhã Nam', '24'),
  ('07330', 'Xã Phúc Hòa', '24'),
  ('07333', 'Xã Quang Trung', '24'),
  ('07339', 'Xã Tân Yên', '24'),
  ('07351', 'Xã Ngọc Thiện', '24'),
  ('07375', 'Xã Lạng Giang', '24'),
  ('07381', 'Xã Tiên Lục', '24'),
  ('07399', 'Xã Kép', '24'),
  ('07420', 'Xã Mỹ Thái', '24'),
  ('07432', 'Xã Tân Dĩnh', '24'),
  ('07444', 'Xã Lục Nam', '24'),
  ('07450', 'Xã Đông Phú', '24'),
  ('07462', 'Xã Bảo Đài', '24'),
  ('07486', 'Xã Nghĩa Phương', '24'),
  ('07489', 'Xã Trường Sơn', '24'),
  ('07492', 'Xã Lục Sơn', '24'),
  ('07498', 'Xã Bắc Lũng', '24'),
  ('07519', 'Xã Cẩm Lý', '24'),
  ('07525', 'Phường Chũ', '24'),
  ('07531', 'Xã Tân Sơn', '24'),
  ('07534', 'Xã Sa Lý', '24'),
  ('07537', 'Xã Biên Sơn', '24'),
  ('07543', 'Xã Sơn Hải', '24'),
  ('07552', 'Xã Kiên Lao', '24'),
  ('07573', 'Xã Biển Động', '24'),
  ('07582', 'Xã Lục Ngạn', '24'),
  ('07594', 'Xã Đèo Gia', '24'),
  ('07603', 'Xã Nam Dương', '24'),
  ('07612', 'Phường Phượng Sơn', '24'),
  ('07615', 'Xã Sơn Động', '24'),
  ('07616', 'Xã Tây Yên Tử', '24'),
  ('07621', 'Xã Vân Sơn', '24'),
  ('07627', 'Xã Đại Sơn', '24'),
  ('07642', 'Xã Yên Định', '24'),
  ('07654', 'Xã An Lạc', '24'),
  ('07663', 'Xã Tuấn Đạo', '24'),
  ('07672', 'Xã Dương Hưu', '24'),
  ('07681', 'Phường Yên Dũng', '24'),
  ('07682', 'Phường Tân An', '24'),
  ('07696', 'Phường Tiền Phong', '24'),
  ('07699', 'Phường Tân Tiến', '24'),
  ('07735', 'Xã Đồng Việt', '24'),
  ('07738', 'Phường Cảnh Thụy', '24'),
  ('07774', 'Phường Tự Lạn', '24'),
  ('07777', 'Phường Việt Yên', '24'),
  ('07795', 'Phường Nếnh', '24'),
  ('07798', 'Phường Vân Hà', '24'),
  ('07822', 'Xã Hoàng Vân', '24'),
  ('07840', 'Xã Hiệp Hòa', '24'),
  ('07864', 'Xã Hợp Thịnh', '24'),
  ('07870', 'Xã Xuân Cẩm', '24'),
  ('07894', 'Phường Nông Trang', '25'),
  ('07900', 'Phường Việt Trì', '25'),
  ('07909', 'Phường Thanh Miếu', '25'),
  ('07918', 'Phường Vân Phú', '25'),
  ('07942', 'Phường Phú Thọ', '25'),
  ('07948', 'Phường Âu Cơ', '25'),
  ('07954', 'Phường Phong Châu', '25'),
  ('07969', 'Xã Đoan Hùng', '25'),
  ('07996', 'Xã Bằng Luân', '25'),
  ('07999', 'Xã Chí Đám', '25'),
  ('08023', 'Xã Tây Cốc', '25'),
  ('08038', 'Xã Chân Mộng', '25'),
  ('08053', 'Xã Hạ Hòa', '25'),
  ('08071', 'Xã Đan Thượng', '25'),
  ('08110', 'Xã Hiền Lương', '25'),
  ('08113', 'Xã Yên Kỳ', '25'),
  ('08134', 'Xã Văn Lang', '25'),
  ('08143', 'Xã Vĩnh Chân', '25'),
  ('08152', 'Xã Thanh Ba', '25'),
  ('08173', 'Xã Quảng Yên', '25'),
  ('08203', 'Xã Hoàng Cương', '25'),
  ('08209', 'Xã Đông Thành', '25'),
  ('08218', 'Xã Chí Tiên', '25'),
  ('08227', 'Xã Liên Minh', '25'),
  ('08230', 'Xã Phù Ninh', '25'),
  ('08236', 'Xã Phú Mỹ', '25'),
  ('08245', 'Xã Trạm Thản', '25'),
  ('08254', 'Xã Dân Chủ', '25'),
  ('08275', 'Xã Bình Phú', '25'),
  ('08290', 'Xã Yên Lập', '25'),
  ('08296', 'Xã Sơn Lương', '25'),
  ('08305', 'Xã Xuân Viên', '25'),
  ('08311', 'Xã Trung Sơn', '25'),
  ('08323', 'Xã Thượng Long', '25'),
  ('08338', 'Xã Minh Hòa', '25'),
  ('08341', 'Xã Cẩm Khê', '25'),
  ('08344', 'Xã Tiên Lương', '25'),
  ('08377', 'Xã Vân Bán', '25'),
  ('08398', 'Xã Phú Khê', '25'),
  ('08416', 'Xã Hùng Việt', '25'),
  ('08431', 'Xã Đồng Lương', '25'),
  ('08434', 'Xã Tam Nông', '25'),
  ('08443', 'Xã Hiền Quan', '25'),
  ('08467', 'Xã Vạn Xuân', '25'),
  ('08479', 'Xã Thọ Văn', '25'),
  ('08494', 'Xã Lâm Thao', '25'),
  ('08500', 'Xã Xuân Lũng', '25'),
  ('08515', 'Xã Hy Cương', '25'),
  ('08521', 'Xã Phùng Nguyên', '25'),
  ('08527', 'Xã Bản Nguyên', '25'),
  ('08542', 'Xã Thanh Sơn', '25'),
  ('08545', 'Xã Thu Cúc', '25'),
  ('08560', 'Xã Lai Đồng', '25'),
  ('08566', 'Xã Tân Sơn', '25'),
  ('08584', 'Xã Võ Miếu', '25'),
  ('08590', 'Xã Xuân Đài', '25'),
  ('08593', 'Xã Minh Đài', '25'),
  ('08611', 'Xã Văn Miếu', '25'),
  ('08614', 'Xã Cự Đồng', '25'),
  ('08620', 'Xã Long Cốc', '25'),
  ('08632', 'Xã Hương Cần', '25'),
  ('08635', 'Xã Khả Cửu', '25'),
  ('08656', 'Xã Yên Sơn', '25'),
  ('08662', 'Xã Đào Xá', '25'),
  ('08674', 'Xã Thanh Thủy', '25'),
  ('08686', 'Xã Tu Vũ', '25'),
  ('08707', 'Phường Vĩnh Yên', '25'),
  ('08716', 'Phường Vĩnh Phúc', '25'),
  ('08740', 'Phường Phúc Yên', '25'),
  ('08746', 'Phường Xuân Hòa', '25'),
  ('08761', 'Xã Lập Thạch', '25'),
  ('08770', 'Xã Hợp Lý', '25'),
  ('08773', 'Xã Yên Lãng', '25'),
  ('08782', 'Xã Hải Lựu', '25'),
  ('08788', 'Xã Thái Hòa', '25'),
  ('08812', 'Xã Liên Hòa', '25'),
  ('08824', 'Xã Tam Sơn', '25'),
  ('08842', 'Xã Tiên Lữ', '25'),
  ('08848', 'Xã Sông Lô', '25'),
  ('08866', 'Xã Sơn Đông', '25'),
  ('08869', 'Xã Tam Dương', '25'),
  ('08872', 'Xã Tam Dương Bắc', '25'),
  ('08896', 'Xã Hoàng An', '25'),
  ('08905', 'Xã Hội Thịnh', '25'),
  ('08911', 'Xã Tam Đảo', '25'),
  ('08914', 'Xã Đạo Trù', '25'),
  ('08923', 'Xã Đại Đình', '25'),
  ('08935', 'Xã Bình Nguyên', '25'),
  ('08944', 'Xã Bình Tuyền', '25'),
  ('08950', 'Xã Bình Xuyên', '25'),
  ('08971', 'Xã Xuân Lãng', '25'),
  ('08974', 'Xã Quang Minh', '01'),
  ('08980', 'Xã Yên Lãng', '01'),
  ('08995', 'Xã Tiến Thắng', '01'),
  ('09022', 'Xã Mê Linh', '01'),
  ('09025', 'Xã Yên Lạc', '25'),
  ('09040', 'Xã Tề Lỗ', '25'),
  ('09043', 'Xã Tam Hồng', '25'),
  ('09052', 'Xã Nguyệt Đức', '25'),
  ('09064', 'Xã Liên Châu', '25'),
  ('09076', 'Xã Vĩnh Tường', '25'),
  ('09079', 'Xã Vĩnh An', '25'),
  ('09100', 'Xã Vĩnh Hưng', '25'),
  ('09106', 'Xã Vĩnh Thành', '25'),
  ('09112', 'Xã Thổ Tang', '25'),
  ('09154', 'Xã Vĩnh Phú', '25'),
  ('09169', 'Phường Vũ Ninh', '24'),
  ('09187', 'Phường Kinh Bắc', '24'),
  ('09190', 'Phường Võ Cường', '24'),
  ('09193', 'Xã Yên Phong', '24'),
  ('09202', 'Xã Tam Giang', '24'),
  ('09205', 'Xã Yên Trung', '24'),
  ('09208', 'Xã Tam Đa', '24'),
  ('09238', 'Xã Văn Môn', '24'),
  ('09247', 'Phường Quế Võ', '24'),
  ('09253', 'Phường Nhân Hòa', '24'),
  ('09265', 'Phường Phương Liễu', '24'),
  ('09286', 'Phường Nam Sơn', '24'),
  ('09292', 'Xã Phù Lãng', '24'),
  ('09295', 'Phường Bồng Lai', '24'),
  ('09301', 'Phường Đào Viên', '24'),
  ('09313', 'Xã Chi Lăng', '24'),
  ('09319', 'Xã Tiên Du', '24'),
  ('09325', 'Phường Hạp Lĩnh', '24'),
  ('09334', 'Xã Liên Bão', '24'),
  ('09340', 'Xã Đại Đồng', '24'),
  ('09343', 'Xã Tân Chi', '24'),
  ('09349', 'Xã Phật Tích', '24'),
  ('09367', 'Phường Từ Sơn', '24'),
  ('09370', 'Phường Tam Sơn', '24'),
  ('09379', 'Phường Phù Khê', '24'),
  ('09385', 'Phường Đồng Nguyên', '24'),
  ('09400', 'Phường Thuận Thành', '24'),
  ('09409', 'Phường Mão Điền', '24'),
  ('09427', 'Phường Trí Quả', '24'),
  ('09430', 'Phường Trạm Lộ', '24'),
  ('09433', 'Phường Song Liễu', '24'),
  ('09445', 'Phường Ninh Xá', '24'),
  ('09454', 'Xã Gia Bình', '24'),
  ('09466', 'Xã Cao Đức', '24'),
  ('09469', 'Xã Đại Lai', '24'),
  ('09475', 'Xã Nhân Thắng', '24'),
  ('09487', 'Xã Đông Cứu', '24'),
  ('09496', 'Xã Lương Tài', '24'),
  ('09499', 'Xã Trung Kênh', '24'),
  ('09523', 'Xã Trung Chính', '24'),
  ('09529', 'Xã Lâm Thao', '24'),
  ('09552', 'Phường Kiến Hưng', '01'),
  ('09556', 'Phường Hà Đông', '01'),
  ('09562', 'Phường Yên Nghĩa', '01'),
  ('09568', 'Phường Phú Lương', '01'),
  ('09574', 'Phường Sơn Tây', '01'),
  ('09604', 'Phường Tùng Thiện', '01'),
  ('09616', 'Xã Đoài Phương', '01'),
  ('09619', 'Xã Quảng Oai', '01'),
  ('09634', 'Xã Cổ Đô', '01'),
  ('09661', 'Xã Minh Châu', '01'),
  ('09664', 'Xã Vật Lại', '01'),
  ('09676', 'Xã Bất Bạt', '01'),
  ('09694', 'Xã Suối Hai', '01'),
  ('09700', 'Xã Ba Vì', '01'),
  ('09706', 'Xã Yên Bài', '01'),
  ('09715', 'Xã Phúc Thọ', '01'),
  ('09739', 'Xã Phúc Lộc', '01'),
  ('09772', 'Xã Hát Môn', '01'),
  ('09784', 'Xã Đan Phượng', '01'),
  ('09787', 'Xã Liên Minh', '01'),
  ('09817', 'Xã Ô Diên', '01'),
  ('09832', 'Xã Hoài Đức', '01'),
  ('09856', 'Xã Dương Hòa', '01'),
  ('09871', 'Xã Sơn Đồng', '01'),
  ('09877', 'Xã An Khánh', '01'),
  ('09886', 'Phường Dương Nội', '01'),
  ('09895', 'Xã Quốc Oai', '01'),
  ('09910', 'Xã Kiều Phú', '01'),
  ('09931', 'Xã Hưng Đạo', '01'),
  ('09952', 'Xã Phú Cát', '01'),
  ('09955', 'Xã Thạch Thất', '01'),
  ('09982', 'Xã Hạ Bằng', '01'),
  ('09988', 'Xã Hòa Lạc', '01'),
  ('10003', 'Xã Tây Phương', '01'),
  ('10015', 'Phường Chương Mỹ', '01'),
  ('10030', 'Xã Phú Nghĩa', '01'),
  ('10045', 'Xã Xuân Mai', '01'),
  ('10072', 'Xã Quảng Bị', '01'),
  ('10081', 'Xã Trần Phú', '01');

insert into public.wards (code, name, province_code) values
  ('10096', 'Xã Hòa Phú', '01'),
  ('10114', 'Xã Thanh Oai', '01'),
  ('10126', 'Xã Bình Minh', '01'),
  ('10144', 'Xã Tam Hưng', '01'),
  ('10180', 'Xã Dân Hòa', '01'),
  ('10183', 'Xã Thường Tín', '01'),
  ('10210', 'Xã Hồng Vân', '01'),
  ('10231', 'Xã Thượng Phúc', '01'),
  ('10237', 'Xã Chương Dương', '01'),
  ('10273', 'Xã Phú Xuyên', '01'),
  ('10279', 'Xã Phượng Dực', '01'),
  ('10330', 'Xã Chuyên Mỹ', '01'),
  ('10342', 'Xã Đại Xuyên', '01'),
  ('10354', 'Xã Vân Đình', '01'),
  ('10369', 'Xã Ứng Thiên', '01'),
  ('10402', 'Xã Ứng Hòa', '01'),
  ('10417', 'Xã Hòa Xá', '01'),
  ('10441', 'Xã Mỹ Đức', '01'),
  ('10459', 'Xã Phúc Sơn', '01'),
  ('10465', 'Xã Hồng Sơn', '01'),
  ('10489', 'Xã Hương Sơn', '01'),
  ('10507', 'Phường Thành Đông', '31'),
  ('10525', 'Phường Hải Dương', '31'),
  ('10532', 'Phường Lê Thanh Nghị', '31'),
  ('10537', 'Phường Tân Hưng', '31'),
  ('10543', 'Phường Việt Hòa', '31'),
  ('10546', 'Phường Chí Linh', '31'),
  ('10549', 'Phường Chu Văn An', '31'),
  ('10552', 'Phường Nguyễn Trãi', '31'),
  ('10570', 'Phường Trần Hưng Đạo', '31'),
  ('10573', 'Phường Trần Nhân Tông', '31'),
  ('10603', 'Phường Lê Đại Hành', '31'),
  ('10606', 'Xã Nam Sách', '31'),
  ('10615', 'Xã Hợp Tiến', '31'),
  ('10633', 'Xã Trần Phú', '31'),
  ('10642', 'Xã Thái Tân', '31'),
  ('10645', 'Xã An Phú', '31'),
  ('10660', 'Phường Ái Quốc', '31'),
  ('10675', 'Phường Kinh Môn', '31'),
  ('10678', 'Phường Bắc An Phụ', '31'),
  ('10705', 'Xã Nam An Phụ', '31'),
  ('10714', 'Phường Nhị Chiểu', '31'),
  ('10726', 'Phường Phạm Sư Mạnh', '31'),
  ('10729', 'Phường Trần Liễu', '31'),
  ('10744', 'Phường Nguyễn Đại Năng', '31'),
  ('10750', 'Xã Phú Thái', '31'),
  ('10756', 'Xã Lai Khê', '31'),
  ('10792', 'Xã An Thành', '31'),
  ('10804', 'Xã Kim Thành', '31'),
  ('10813', 'Xã Thanh Hà', '31'),
  ('10816', 'Xã Hà Bắc', '31'),
  ('10837', 'Phường Nam Đồng', '31'),
  ('10843', 'Xã Hà Nam', '31'),
  ('10846', 'Xã Hà Tây', '31'),
  ('10882', 'Xã Hà Đông', '31'),
  ('10888', 'Xã Cẩm Giang', '31'),
  ('10891', 'Phường Tứ Minh', '31'),
  ('10903', 'Xã Cẩm Giàng', '31'),
  ('10909', 'Xã Tuệ Tĩnh', '31'),
  ('10930', 'Xã Mao Điền', '31'),
  ('10945', 'Xã Kẻ Sặt', '31'),
  ('10966', 'Xã Bình Giang', '31'),
  ('10972', 'Xã Đường An', '31'),
  ('10993', 'Xã Thượng Hồng', '31'),
  ('10999', 'Xã Gia Lộc', '31'),
  ('11002', 'Phường Thạch Khôi', '31'),
  ('11020', 'Xã Yết Kiêu', '31'),
  ('11050', 'Xã Gia Phúc', '31'),
  ('11065', 'Xã Trường Tân', '31'),
  ('11074', 'Xã Tứ Kỳ', '31'),
  ('11086', 'Xã Đại Sơn', '31'),
  ('11113', 'Xã Tân Kỳ', '31'),
  ('11131', 'Xã Chí Minh', '31'),
  ('11140', 'Xã Lạc Phượng', '31'),
  ('11146', 'Xã Nguyên Giáp', '31'),
  ('11164', 'Xã Vĩnh Lại', '31'),
  ('11167', 'Xã Tân An', '31'),
  ('11203', 'Xã Ninh Giang', '31'),
  ('11218', 'Xã Hồng Châu', '31'),
  ('11224', 'Xã Khúc Thừa Dụ', '31'),
  ('11239', 'Xã Thanh Miện', '31'),
  ('11242', 'Xã Nguyễn Lương Bằng', '31'),
  ('11254', 'Xã Bắc Thanh Miện', '31'),
  ('11257', 'Xã Hải Hưng', '31'),
  ('11284', 'Xã Nam Thanh Miện', '31'),
  ('11311', 'Phường Hồng Bàng', '31'),
  ('11329', 'Phường Ngô Quyền', '31'),
  ('11359', 'Phường Gia Viên', '31'),
  ('11383', 'Phường Lê Chân', '31'),
  ('11407', 'Phường An Biên', '31'),
  ('11411', 'Phường Đông Hải', '31'),
  ('11413', 'Phường Hải An', '31'),
  ('11443', 'Phường Kiến An', '31'),
  ('11446', 'Phường Phù Liễn', '31'),
  ('11455', 'Phường Đồ Sơn', '31'),
  ('11473', 'Phường Bạch Đằng', '31'),
  ('11488', 'Phường Lưu Kiếm', '31'),
  ('11503', 'Xã Việt Khê', '31'),
  ('11506', 'Phường Lê Ích Mộc', '31'),
  ('11533', 'Phường Hòa Bình', '31'),
  ('11542', 'Phường Nam Triệu', '31'),
  ('11557', 'Phường Thiên Hương', '31'),
  ('11560', 'Phường Thủy Nguyên', '31'),
  ('11581', 'Phường An Dương', '31'),
  ('11593', 'Phường An Phong', '31'),
  ('11602', 'Phường Hồng An', '31'),
  ('11617', 'Phường An Hải', '31'),
  ('11629', 'Xã An Lão', '31'),
  ('11635', 'Xã An Trường', '31'),
  ('11647', 'Xã An Quang', '31'),
  ('11668', 'Xã An Khánh', '31'),
  ('11674', 'Xã An Hưng', '31'),
  ('11680', 'Xã Kiến Thụy', '31'),
  ('11689', 'Phường Hưng Đạo', '31'),
  ('11692', 'Phường Dương Kinh', '31'),
  ('11713', 'Xã Nghi Dương', '31'),
  ('11725', 'Xã Kiến Minh', '31'),
  ('11728', 'Xã Kiến Hưng', '31'),
  ('11737', 'Phường Nam Đồ Sơn', '31'),
  ('11749', 'Xã Kiến Hải', '31'),
  ('11755', 'Xã Tiên Lãng', '31'),
  ('11761', 'Xã Quyết Thắng', '31'),
  ('11779', 'Xã Tân Minh', '31'),
  ('11791', 'Xã Tiên Minh', '31'),
  ('11806', 'Xã Chấn Hưng', '31'),
  ('11809', 'Xã Hùng Thắng', '31'),
  ('11824', 'Xã Vĩnh Bảo', '31'),
  ('11836', 'Xã Vĩnh Thịnh', '31'),
  ('11842', 'Xã Vĩnh Thuận', '31'),
  ('11848', 'Xã Vĩnh Hòa', '31'),
  ('11875', 'Xã Vĩnh Hải', '31'),
  ('11887', 'Xã Vĩnh Am', '31'),
  ('11911', 'Xã Nguyễn Bỉnh Khiêm', '31'),
  ('11914', 'Đặc khu Cát Hải', '31'),
  ('11948', 'Đặc khu Bạch Long Vĩ', '31'),
  ('11953', 'Phường Phố Hiến', '33'),
  ('11977', 'Xã Tân Hưng', '33'),
  ('11980', 'Phường Hồng Châu', '33'),
  ('11983', 'Phường Sơn Nam', '33'),
  ('11992', 'Xã Lạc Đạo', '33'),
  ('11995', 'Xã Đại Đồng', '33'),
  ('12004', 'Xã Như Quỳnh', '33'),
  ('12019', 'Xã Văn Giang', '33'),
  ('12025', 'Xã Phụng Công', '33'),
  ('12031', 'Xã Nghĩa Trụ', '33'),
  ('12049', 'Xã Mễ Sở', '33'),
  ('12064', 'Xã Nguyễn Văn Linh', '33'),
  ('12070', 'Xã Hoàn Long', '33'),
  ('12073', 'Xã Yên Mỹ', '33'),
  ('12091', 'Xã Việt Yên', '33'),
  ('12103', 'Phường Mỹ Hào', '33'),
  ('12127', 'Phường Thượng Hồng', '33'),
  ('12133', 'Phường Đường Hào', '33'),
  ('12142', 'Xã Ân Thi', '33'),
  ('12148', 'Xã Phạm Ngũ Lão', '33'),
  ('12166', 'Xã Xuân Trúc', '33'),
  ('12184', 'Xã Nguyễn Trãi', '33'),
  ('12196', 'Xã Hồng Quang', '33'),
  ('12205', 'Xã Khoái Châu', '33'),
  ('12223', 'Xã Triệu Việt Vương', '33'),
  ('12238', 'Xã Việt Tiến', '33'),
  ('12247', 'Xã Châu Ninh', '33'),
  ('12271', 'Xã Chí Minh', '33'),
  ('12280', 'Xã Lương Bằng', '33'),
  ('12286', 'Xã Nghĩa Dân', '33'),
  ('12313', 'Xã Đức Hợp', '33'),
  ('12322', 'Xã Hiệp Cường', '33'),
  ('12337', 'Xã Hoàng Hoa Thám', '33'),
  ('12361', 'Xã Tiên Hoa', '33'),
  ('12364', 'Xã Tiên Lữ', '33'),
  ('12391', 'Xã Quang Hưng', '33'),
  ('12406', 'Xã Đoàn Đào', '33'),
  ('12424', 'Xã Tiên Tiến', '33'),
  ('12427', 'Xã Tống Trân', '33'),
  ('12452', 'Phường Trần Hưng Đạo', '33'),
  ('12454', 'Phường Trần Lãm', '33'),
  ('12466', 'Phường Vũ Phúc', '33'),
  ('12472', 'Xã Quỳnh Phụ', '33'),
  ('12499', 'Xã A Sào', '33'),
  ('12511', 'Xã Minh Thọ', '33'),
  ('12517', 'Xã Ngọc Lâm', '33'),
  ('12523', 'Xã Phụ Dực', '33'),
  ('12526', 'Xã Đồng Bằng', '33'),
  ('12532', 'Xã Nguyễn Du', '33'),
  ('12577', 'Xã Quỳnh An', '33'),
  ('12583', 'Xã Tân Tiến', '33'),
  ('12586', 'Xã Hưng Hà', '33'),
  ('12595', 'Xã Ngự Thiên', '33'),
  ('12613', 'Xã Long Hưng', '33'),
  ('12619', 'Xã Diên Hà', '33'),
  ('12631', 'Xã Thần Khê', '33'),
  ('12634', 'Xã Tiên La', '33'),
  ('12676', 'Xã Lê Quý Đôn', '33'),
  ('12685', 'Xã Hồng Minh', '33'),
  ('12688', 'Xã Đông Hưng', '33'),
  ('12694', 'Xã Bắc Đông Hưng', '33'),
  ('12700', 'Xã Bắc Tiên Hưng', '33'),
  ('12736', 'Xã Đông Tiên Hưng', '33'),
  ('12745', 'Xã Bắc Đông Quan', '33'),
  ('12754', 'Xã Tiên Hưng', '33'),
  ('12763', 'Xã Nam Tiên Hưng', '33'),
  ('12775', 'Xã Nam Đông Hưng', '33'),
  ('12793', 'Xã Đông Quan', '33'),
  ('12817', 'Phường Trà Lý', '33'),
  ('12826', 'Xã Thái Thụy', '33'),
  ('12850', 'Xã Tây Thụy Anh', '33'),
  ('12859', 'Xã Bắc Thụy Anh', '33'),
  ('12862', 'Xã Đông Thụy Anh', '33'),
  ('12865', 'Xã Thụy Anh', '33'),
  ('12904', 'Xã Nam Thụy Anh', '33'),
  ('12916', 'Xã Bắc Thái Ninh', '33'),
  ('12919', 'Xã Tây Thái Ninh', '33'),
  ('12922', 'Xã Thái Ninh', '33'),
  ('12943', 'Xã Đông Thái Ninh', '33'),
  ('12961', 'Xã Nam Thái Ninh', '33'),
  ('12970', 'Xã Tiền Hải', '33'),
  ('12988', 'Xã Đông Tiền Hải', '33'),
  ('13003', 'Xã Đồng Châu', '33'),
  ('13021', 'Xã Ái Quốc', '33'),
  ('13039', 'Xã Tây Tiền Hải', '33'),
  ('13057', 'Xã Nam Cường', '33'),
  ('13063', 'Xã Nam Tiền Hải', '33'),
  ('13066', 'Xã Hưng Phú', '33'),
  ('13075', 'Xã Kiến Xương', '33'),
  ('13093', 'Xã Trà Giang', '33'),
  ('13096', 'Xã Bình Nguyên', '33'),
  ('13120', 'Xã Lê Lợi', '33'),
  ('13132', 'Xã Quang Lịch', '33'),
  ('13141', 'Xã Vũ Quý', '33'),
  ('13159', 'Xã Hồng Vũ', '33'),
  ('13183', 'Xã Bình Thanh', '33'),
  ('13186', 'Xã Bình Định', '33'),
  ('13192', 'Xã Vũ Thư', '33'),
  ('13219', 'Xã Vạn Xuân', '33'),
  ('13222', 'Xã Thư Trì', '33'),
  ('13225', 'Phường Thái Bình', '33'),
  ('13246', 'Xã Tân Thuận', '33'),
  ('13264', 'Xã Thư Vũ', '33'),
  ('13279', 'Xã Vũ Tiên', '33'),
  ('13285', 'Phường Phủ Lý', '37'),
  ('13291', 'Phường Phù Vân', '37'),
  ('13318', 'Phường Châu Sơn', '37'),
  ('13324', 'Phường Duy Tiên', '37'),
  ('13330', 'Phường Duy Tân', '37'),
  ('13336', 'Phường Duy Hà', '37'),
  ('13348', 'Phường Đồng Văn', '37'),
  ('13363', 'Phường Tiên Sơn', '37'),
  ('13366', 'Phường Hà Nam', '37'),
  ('13384', 'Phường Kim Bảng', '37'),
  ('13393', 'Phường Lê Hồ', '37'),
  ('13396', 'Phường Nguyễn Úy', '37'),
  ('13402', 'Phường Kim Thanh', '37'),
  ('13420', 'Phường Tam Chúc', '37'),
  ('13435', 'Phường Lý Thường Kiệt', '37'),
  ('13444', 'Phường Liêm Tuyền', '37'),
  ('13456', 'Xã Liêm Hà', '37'),
  ('13474', 'Xã Tân Thanh', '37'),
  ('13483', 'Xã Thanh Bình', '37'),
  ('13489', 'Xã Thanh Lâm', '37'),
  ('13495', 'Xã Thanh Liêm', '37'),
  ('13501', 'Xã Bình Mỹ', '37'),
  ('13504', 'Xã Bình Lục', '37'),
  ('13531', 'Xã Bình Giang', '37'),
  ('13540', 'Xã Bình An', '37'),
  ('13558', 'Xã Bình Sơn', '37'),
  ('13573', 'Xã Lý Nhân', '37'),
  ('13579', 'Xã Bắc Lý', '37'),
  ('13591', 'Xã Nam Xang', '37'),
  ('13594', 'Xã Trần Thương', '37'),
  ('13597', 'Xã Vĩnh Trụ', '37'),
  ('13609', 'Xã Nhân Hà', '37'),
  ('13627', 'Xã Nam Lý', '37'),
  ('13669', 'Phường Nam Định', '37'),
  ('13684', 'Phường Thiên Trường', '37'),
  ('13693', 'Phường Đông A', '37'),
  ('13699', 'Phường Thành Nam', '37'),
  ('13708', 'Phường Mỹ Lộc', '37'),
  ('13741', 'Xã Vụ Bản', '37'),
  ('13750', 'Xã Minh Tân', '37'),
  ('13753', 'Xã Hiển Khánh', '37'),
  ('13777', 'Phường Trường Thi', '37'),
  ('13786', 'Xã Liên Minh', '37'),
  ('13795', 'Xã Ý Yên', '37'),
  ('13807', 'Xã Tân Minh', '37'),
  ('13822', 'Xã Phong Doanh', '37'),
  ('13834', 'Xã Vũ Dương', '37'),
  ('13864', 'Xã Vạn Thắng', '37'),
  ('13870', 'Xã Yên Cường', '37'),
  ('13879', 'Xã Yên Đồng', '37'),
  ('13891', 'Xã Nghĩa Hưng', '37'),
  ('13894', 'Xã Rạng Đông', '37'),
  ('13900', 'Xã Đồng Thịnh', '37'),
  ('13918', 'Xã Nghĩa Sơn', '37'),
  ('13927', 'Xã Hồng Phong', '37'),
  ('13939', 'Xã Quỹ Nhất', '37'),
  ('13957', 'Xã Nghĩa Lâm', '37'),
  ('13966', 'Xã Nam Trực', '37'),
  ('13972', 'Phường Vị Khê', '37'),
  ('13984', 'Phường Hồng Quang', '37'),
  ('13987', 'Xã Nam Hồng', '37'),
  ('14005', 'Xã Nam Ninh', '37'),
  ('14011', 'Xã Nam Minh', '37'),
  ('14014', 'Xã Nam Đồng', '37'),
  ('14026', 'Xã Cổ Lễ', '37'),
  ('14038', 'Xã Ninh Giang', '37'),
  ('14053', 'Xã Trực Ninh', '37'),
  ('14056', 'Xã Cát Thành', '37'),
  ('14062', 'Xã Quang Hưng', '37'),
  ('14071', 'Xã Minh Thái', '37'),
  ('14077', 'Xã Ninh Cường', '37'),
  ('14089', 'Xã Xuân Trường', '37'),
  ('14095', 'Xã Xuân Hồng', '37'),
  ('14104', 'Xã Xuân Giang', '37'),
  ('14122', 'Xã Xuân Hưng', '37'),
  ('14161', 'Xã Giao Minh', '37'),
  ('14167', 'Xã Giao Thủy', '37'),
  ('14179', 'Xã Giao Hưng', '37'),
  ('14182', 'Xã Giao Hòa', '37'),
  ('14194', 'Xã Giao Bình', '37'),
  ('14203', 'Xã Giao Phúc', '37'),
  ('14212', 'Xã Giao Ninh', '37'),
  ('14215', 'Xã Hải Hậu', '37'),
  ('14218', 'Xã Hải Tiến', '37'),
  ('14221', 'Xã Hải Thịnh', '37'),
  ('14236', 'Xã Hải Anh', '37'),
  ('14248', 'Xã Hải Hưng', '37'),
  ('14281', 'Xã Hải An', '37'),
  ('14287', 'Xã Hải Quang', '37'),
  ('14308', 'Xã Hải Xuân', '37'),
  ('14329', 'Phường Hoa Lư', '37'),
  ('14359', 'Phường Nam Hoa Lư', '37'),
  ('14362', 'Phường Tam Điệp', '37'),
  ('14365', 'Phường Trung Sơn', '37'),
  ('14371', 'Phường Yên Sơn', '37'),
  ('14389', 'Xã Gia Lâm', '37'),
  ('14401', 'Xã Gia Tường', '37'),
  ('14404', 'Xã Cúc Phương', '37'),
  ('14407', 'Xã Phú Sơn', '37'),
  ('14428', 'Xã Nho Quan', '37'),
  ('14434', 'Xã Thanh Sơn', '37'),
  ('14452', 'Xã Quỳnh Lưu', '37'),
  ('14458', 'Xã Phú Long', '37'),
  ('14464', 'Xã Gia Viễn', '37'),
  ('14482', 'Xã Gia Hưng', '37'),
  ('14488', 'Xã Gia Vân', '37'),
  ('14494', 'Xã Gia Trấn', '37'),
  ('14500', 'Xã Đại Hoàng', '37'),
  ('14524', 'Xã Gia Phong', '37'),
  ('14533', 'Phường Tây Hoa Lư', '37'),
  ('14560', 'Xã Yên Khánh', '37'),
  ('14563', 'Xã Khánh Thiện', '37'),
  ('14566', 'Phường Đông Hoa Lư', '37'),
  ('14608', 'Xã Khánh Trung', '37'),
  ('14611', 'Xã Khánh Nhạc', '37'),
  ('14614', 'Xã Khánh Hội', '37'),
  ('14620', 'Xã Phát Diệm', '37'),
  ('14623', 'Xã Bình Minh', '37'),
  ('14638', 'Xã Kim Sơn', '37'),
  ('14647', 'Xã Quang Thiện', '37'),
  ('14653', 'Xã Chất Bình', '37'),
  ('14674', 'Xã Lai Thành', '37'),
  ('14677', 'Xã Định Hóa', '37'),
  ('14698', 'Xã Kim Đông', '37'),
  ('14701', 'Xã Yên Mô', '37'),
  ('14725', 'Phường Yên Thắng', '37'),
  ('14728', 'Xã Yên Từ', '37'),
  ('14743', 'Xã Yên Mạc', '37'),
  ('14746', 'Xã Đồng Thái', '37'),
  ('14758', 'Phường Hàm Rồng', '38'),
  ('14797', 'Phường Hạc Thành', '38'),
  ('14812', 'Phường Bỉm Sơn', '38'),
  ('14818', 'Phường Quang Trung', '38'),
  ('14845', 'Xã Mường Lát', '38'),
  ('14848', 'Xã Tam Chung', '38'),
  ('14854', 'Xã Mường Lý', '38'),
  ('14857', 'Xã Trung Lý', '38'),
  ('14860', 'Xã Quang Chiểu', '38'),
  ('14863', 'Xã Pù Nhi', '38'),
  ('14864', 'Xã Nhi Sơn', '38'),
  ('14866', 'Xã Mường Chanh', '38'),
  ('14869', 'Xã Hồi Xuân', '38'),
  ('14872', 'Xã Trung Thành', '38'),
  ('14875', 'Xã Trung Sơn', '38'),
  ('14878', 'Xã Phú Lệ', '38'),
  ('14890', 'Xã Phú Xuân', '38'),
  ('14896', 'Xã Hiền Kiệt', '38'),
  ('14902', 'Xã Nam Xuân', '38'),
  ('14908', 'Xã Thiên Phủ', '38'),
  ('14923', 'Xã Bá Thước', '38'),
  ('14932', 'Xã Điền Quang', '38'),
  ('14950', 'Xã Điền Lư', '38'),
  ('14953', 'Xã Quý Lương', '38'),
  ('14956', 'Xã Pù Luông', '38'),
  ('14959', 'Xã Cổ Lũng', '38'),
  ('14974', 'Xã Văn Nho', '38'),
  ('14980', 'Xã Thiết Ống', '38'),
  ('15001', 'Xã Trung Hạ', '38'),
  ('15007', 'Xã Tam Thanh', '38'),
  ('15010', 'Xã Sơn Thủy', '38'),
  ('15013', 'Xã Na Mèo', '38'),
  ('15016', 'Xã Quan Sơn', '38'),
  ('15019', 'Xã Tam Lư', '38'),
  ('15022', 'Xã Sơn Điện', '38'),
  ('15025', 'Xã Mường Mìn', '38'),
  ('15031', 'Xã Yên Khương', '38'),
  ('15034', 'Xã Yên Thắng', '38'),
  ('15043', 'Xã Giao An', '38'),
  ('15049', 'Xã Văn Phú', '38'),
  ('15055', 'Xã Linh Sơn', '38'),
  ('15058', 'Xã Đồng Lương', '38'),
  ('15061', 'Xã Ngọc Lặc', '38'),
  ('15085', 'Xã Thạch Lập', '38'),
  ('15091', 'Xã Ngọc Liên', '38'),
  ('15106', 'Xã Nguyệt Ấn', '38'),
  ('15112', 'Xã Kiên Thọ', '38'),
  ('15124', 'Xã Minh Sơn', '38'),
  ('15127', 'Xã Cẩm Thủy', '38'),
  ('15142', 'Xã Cẩm Thạch', '38'),
  ('15148', 'Xã Cẩm Tú', '38'),
  ('15163', 'Xã Cẩm Vân', '38'),
  ('15178', 'Xã Cẩm Tân', '38'),
  ('15187', 'Xã Kim Tân', '38'),
  ('15190', 'Xã Vân Du', '38'),
  ('15199', 'Xã Thạch Quảng', '38'),
  ('15211', 'Xã Thạch Bình', '38'),
  ('15229', 'Xã Thành Vinh', '38'),
  ('15250', 'Xã Ngọc Trạo', '38'),
  ('15271', 'Xã Hà Trung', '38'),
  ('15274', 'Xã Hà Long', '38'),
  ('15286', 'Xã Hoạt Giang', '38'),
  ('15298', 'Xã Lĩnh Toại', '38'),
  ('15316', 'Xã Tống Sơn', '38'),
  ('15349', 'Xã Vĩnh Lộc', '38'),
  ('15361', 'Xã Tây Đô', '38'),
  ('15382', 'Xã Biện Thượng', '38'),
  ('15409', 'Xã Yên Phú', '38'),
  ('15412', 'Xã Quý Lộc', '38'),
  ('15421', 'Xã Yên Trường', '38'),
  ('15442', 'Xã Yên Ninh', '38'),
  ('15448', 'Xã Định Hòa', '38'),
  ('15457', 'Xã Định Tân', '38'),
  ('15469', 'Xã Yên Định', '38'),
  ('15499', 'Xã Thọ Xuân', '38'),
  ('15505', 'Xã Thọ Long', '38'),
  ('15520', 'Xã Xuân Hòa', '38'),
  ('15544', 'Xã Lam Sơn', '38'),
  ('15553', 'Xã Sao Vàng', '38'),
  ('15568', 'Xã Thọ Lập', '38'),
  ('15574', 'Xã Xuân Tín', '38'),
  ('15592', 'Xã Xuân Lập', '38'),
  ('15607', 'Xã Bát Mọt', '38'),
  ('15610', 'Xã Yên Nhân', '38'),
  ('15622', 'Xã Vạn Xuân', '38'),
  ('15628', 'Xã Lương Sơn', '38'),
  ('15634', 'Xã Luận Thành', '38'),
  ('15643', 'Xã Thắng Lộc', '38'),
  ('15646', 'Xã Thường Xuân', '38'),
  ('15658', 'Xã Xuân Chinh', '38'),
  ('15661', 'Xã Tân Thành', '38'),
  ('15664', 'Xã Triệu Sơn', '38'),
  ('15667', 'Xã Thọ Bình', '38'),
  ('15682', 'Xã Hợp Tiến', '38'),
  ('15715', 'Xã Tân Ninh', '38'),
  ('15724', 'Xã Đồng Tiến', '38'),
  ('15754', 'Xã Thọ Ngọc', '38'),
  ('15763', 'Xã Thọ Phú', '38'),
  ('15766', 'Xã An Nông', '38'),
  ('15772', 'Xã Thiệu Hóa', '38'),
  ('15778', 'Xã Thiệu Tiến', '38'),
  ('15796', 'Xã Thiệu Quang', '38'),
  ('15820', 'Xã Thiệu Toán', '38'),
  ('15835', 'Xã Thiệu Trung', '38'),
  ('15853', 'Phường Đông Tiến', '38'),
  ('15865', 'Xã Hoằng Hóa', '38'),
  ('15880', 'Xã Hoằng Giang', '38'),
  ('15889', 'Xã Hoằng Phú', '38'),
  ('15910', 'Xã Hoằng Sơn', '38'),
  ('15925', 'Phường Nguyệt Viên', '38'),
  ('15961', 'Xã Hoằng Lộc', '38'),
  ('15976', 'Xã Hoằng Châu', '38'),
  ('15991', 'Xã Hoằng Tiến', '38'),
  ('16000', 'Xã Hoằng Thanh', '38'),
  ('16012', 'Xã Hậu Lộc', '38'),
  ('16021', 'Xã Triệu Lộc', '38'),
  ('16033', 'Xã Đông Thành', '38'),
  ('16072', 'Xã Hoa Lộc', '38'),
  ('16078', 'Xã Vạn Lộc', '38'),
  ('16093', 'Xã Nga Sơn', '38'),
  ('16108', 'Xã Tân Tiến', '38'),
  ('16114', 'Xã Nga Thắng', '38'),
  ('16138', 'Xã Hồ Vương', '38'),
  ('16144', 'Xã Nga An', '38'),
  ('16171', 'Xã Ba Đình', '38'),
  ('16174', 'Xã Như Xuân', '38'),
  ('16177', 'Xã Xuân Bình', '38'),
  ('16186', 'Xã Hóa Quỳ', '38'),
  ('16213', 'Xã Thanh Phong', '38'),
  ('16222', 'Xã Thanh Quân', '38'),
  ('16225', 'Xã Thượng Ninh', '38'),
  ('16228', 'Xã Như Thanh', '38');

insert into public.wards (code, name, province_code) values
  ('16234', 'Xã Xuân Du', '38'),
  ('16249', 'Xã Mậu Lâm', '38'),
  ('16258', 'Xã Xuân Thái', '38'),
  ('16264', 'Xã Yên Thọ', '38'),
  ('16273', 'Xã Thanh Kỳ', '38'),
  ('16279', 'Xã Nông Cống', '38'),
  ('16297', 'Xã Trung Chính', '38'),
  ('16309', 'Xã Thắng Lợi', '38'),
  ('16342', 'Xã Thăng Bình', '38'),
  ('16348', 'Xã Trường Văn', '38'),
  ('16363', 'Xã Tượng Lĩnh', '38'),
  ('16369', 'Xã Công Chính', '38'),
  ('16378', 'Phường Đông Sơn', '38'),
  ('16417', 'Phường Đông Quang', '38'),
  ('16438', 'Xã Lưu Vệ', '38'),
  ('16480', 'Xã Quảng Yên', '38'),
  ('16489', 'Xã Quảng Chính', '38'),
  ('16498', 'Xã Quảng Ngọc', '38'),
  ('16516', 'Phường Nam Sầm Sơn', '38'),
  ('16522', 'Phường Quảng Phú', '38'),
  ('16531', 'Phường Sầm Sơn', '38'),
  ('16540', 'Xã Quảng Ninh', '38'),
  ('16543', 'Xã Quảng Bình', '38'),
  ('16549', 'Xã Tiên Trang', '38'),
  ('16561', 'Phường Tĩnh Gia', '38'),
  ('16576', 'Phường Ngọc Sơn', '38'),
  ('16591', 'Xã Các Sơn', '38'),
  ('16594', 'Phường Tân Dân', '38'),
  ('16597', 'Phường Hải Lĩnh', '38'),
  ('16609', 'Phường Đào Duy Từ', '38'),
  ('16624', 'Phường Trúc Lâm', '38'),
  ('16636', 'Xã Trường Lâm', '38'),
  ('16645', 'Phường Hải Bình', '38'),
  ('16654', 'Phường Nghi Sơn', '38'),
  ('16681', 'Phường Thành Vinh', '40'),
  ('16690', 'Phường Trường Vinh', '40'),
  ('16702', 'Phường Vinh Phú', '40'),
  ('16708', 'Phường Vinh Lộc', '40'),
  ('16732', 'Phường Cửa Lò', '40'),
  ('16738', 'Xã Quế Phong', '40'),
  ('16744', 'Xã Thông Thụ', '40'),
  ('16750', 'Xã Tiền Phong', '40'),
  ('16756', 'Xã Tri Lễ', '40'),
  ('16774', 'Xã Mường Quàng', '40'),
  ('16777', 'Xã Quỳ Châu', '40'),
  ('16792', 'Xã Châu Tiến', '40'),
  ('16801', 'Xã Hùng Chân', '40'),
  ('16804', 'Xã Châu Bình', '40'),
  ('16813', 'Xã Mường Xén', '40'),
  ('16816', 'Xã Mỹ Lý', '40'),
  ('16819', 'Xã Bắc Lý', '40'),
  ('16822', 'Xã Keng Đu', '40'),
  ('16828', 'Xã Huồi Tụ', '40'),
  ('16831', 'Xã Mường Lống', '40'),
  ('16834', 'Xã Na Loi', '40'),
  ('16837', 'Xã Nậm Cắn', '40'),
  ('16849', 'Xã Hữu Kiệm', '40'),
  ('16855', 'Xã Chiêu Lưu', '40'),
  ('16858', 'Xã Mường Típ', '40'),
  ('16870', 'Xã Na Ngoi', '40'),
  ('16876', 'Xã Tương Dương', '40'),
  ('16882', 'Xã Nhôn Mai', '40'),
  ('16885', 'Xã Hữu Khuông', '40'),
  ('16903', 'Xã Nga My', '40'),
  ('16906', 'Xã Lượng Minh', '40'),
  ('16909', 'Xã Yên Hòa', '40'),
  ('16912', 'Xã Yên Na', '40'),
  ('16933', 'Xã Tam Quang', '40'),
  ('16936', 'Xã Tam Thái', '40'),
  ('16939', 'Phường Thái Hòa', '40'),
  ('16941', 'Xã Nghĩa Đàn', '40'),
  ('16951', 'Xã Nghĩa Lâm', '40'),
  ('16969', 'Xã Nghĩa Thọ', '40'),
  ('16972', 'Xã Nghĩa Hưng', '40'),
  ('16975', 'Xã Nghĩa Mai', '40'),
  ('17011', 'Phường Tây Hiếu', '40'),
  ('17017', 'Xã Đông Hiếu', '40'),
  ('17029', 'Xã Nghĩa Lộc', '40'),
  ('17032', 'Xã Nghĩa Khánh', '40'),
  ('17035', 'Xã Quỳ Hợp', '40'),
  ('17044', 'Xã Châu Hồng', '40'),
  ('17056', 'Xã Châu Lộc', '40'),
  ('17059', 'Xã Tam Hợp', '40'),
  ('17071', 'Xã Minh Hợp', '40'),
  ('17077', 'Xã Mường Ham', '40'),
  ('17089', 'Xã Mường Chọng', '40'),
  ('17110', 'Phường Hoàng Mai', '40'),
  ('17125', 'Phường Quỳnh Mai', '40'),
  ('17128', 'Phường Tân Mai', '40'),
  ('17143', 'Xã Quỳnh Văn', '40'),
  ('17149', 'Xã Quỳnh Tam', '40'),
  ('17170', 'Xã Quỳnh Sơn', '40'),
  ('17176', 'Xã Quỳnh Anh', '40'),
  ('17179', 'Xã Quỳnh Lưu', '40'),
  ('17212', 'Xã Quỳnh Phú', '40'),
  ('17224', 'Xã Quỳnh Thắng', '40'),
  ('17230', 'Xã Bình Chuẩn', '40'),
  ('17239', 'Xã Mậu Thạch', '40'),
  ('17242', 'Xã Cam Phục', '40'),
  ('17248', 'Xã Châu Khê', '40'),
  ('17254', 'Xã Con Cuông', '40'),
  ('17263', 'Xã Môn Sơn', '40'),
  ('17266', 'Xã Tân Kỳ', '40'),
  ('17272', 'Xã Tân Phú', '40'),
  ('17278', 'Xã Giai Xuân', '40'),
  ('17284', 'Xã Nghĩa Đồng', '40'),
  ('17287', 'Xã Tiên Đồng', '40'),
  ('17305', 'Xã Tân An', '40'),
  ('17326', 'Xã Nghĩa Hành', '40'),
  ('17329', 'Xã Anh Sơn', '40'),
  ('17335', 'Xã Thành Bình Thọ', '40'),
  ('17344', 'Xã Nhân Hòa', '40'),
  ('17357', 'Xã Vĩnh Tường', '40'),
  ('17365', 'Xã Anh Sơn Đông', '40'),
  ('17380', 'Xã Yên Xuân', '40'),
  ('17395', 'Xã Hùng Châu', '40'),
  ('17416', 'Xã Đức Châu', '40'),
  ('17419', 'Xã Hải Châu', '40'),
  ('17443', 'Xã Quảng Châu', '40'),
  ('17464', 'Xã Diễn Châu', '40'),
  ('17476', 'Xã Minh Châu', '40'),
  ('17479', 'Xã An Châu', '40'),
  ('17488', 'Xã Tân Châu', '40'),
  ('17506', 'Xã Yên Thành', '40'),
  ('17515', 'Xã Bình Minh', '40'),
  ('17521', 'Xã Quang Đồng', '40'),
  ('17524', 'Xã Giai Lạc', '40'),
  ('17530', 'Xã Đông Thành', '40'),
  ('17560', 'Xã Vân Du', '40'),
  ('17569', 'Xã Quan Thành', '40'),
  ('17605', 'Xã Hợp Minh', '40'),
  ('17611', 'Xã Vân Tụ', '40'),
  ('17623', 'Xã Bạch Ngọc', '40'),
  ('17641', 'Xã Lương Sơn', '40'),
  ('17662', 'Xã Đô Lương', '40'),
  ('17677', 'Xã Văn Hiến', '40'),
  ('17689', 'Xã Thuần Trung', '40'),
  ('17707', 'Xã Bạch Hà', '40'),
  ('17713', 'Xã Đại Đồng', '40'),
  ('17722', 'Xã Hạnh Lâm', '40'),
  ('17728', 'Xã Cát Ngạn', '40'),
  ('17743', 'Xã Tam Đồng', '40'),
  ('17759', 'Xã Sơn Lâm', '40'),
  ('17770', 'Xã Hoa Quân', '40'),
  ('17779', 'Xã Xuân Lâm', '40'),
  ('17791', 'Xã Kim Bảng', '40'),
  ('17818', 'Xã Bích Hào', '40'),
  ('17827', 'Xã Nghi Lộc', '40'),
  ('17833', 'Xã Hải Lộc', '40'),
  ('17842', 'Xã Thần Lĩnh', '40'),
  ('17854', 'Xã Văn Kiều', '40'),
  ('17857', 'Xã Phúc Lộc', '40'),
  ('17866', 'Xã Trung Lộc', '40'),
  ('17878', 'Xã Đông Lộc', '40'),
  ('17920', 'Phường Vinh Hưng', '40'),
  ('17935', 'Xã Nam Đàn', '40'),
  ('17944', 'Xã Đại Huệ', '40'),
  ('17950', 'Xã Vạn An', '40'),
  ('17971', 'Xã Kim Liên', '40'),
  ('17989', 'Xã Thiên Nhẫn', '40'),
  ('18001', 'Xã Hưng Nguyên', '40'),
  ('18007', 'Xã Yên Trung', '40'),
  ('18028', 'Xã Hưng Nguyên Nam', '40'),
  ('18040', 'Xã Lam Thành', '40'),
  ('18073', 'Phường Thành Sen', '42'),
  ('18100', 'Phường Trần Phú', '42'),
  ('18115', 'Phường Bắc Hồng Lĩnh', '42'),
  ('18118', 'Phường Nam Hồng Lĩnh', '42'),
  ('18133', 'Xã Hương Sơn', '42'),
  ('18160', 'Xã Sơn Hồng', '42'),
  ('18163', 'Xã Sơn Tiến', '42'),
  ('18172', 'Xã Sơn Tây', '42'),
  ('18184', 'Xã Sơn Giang', '42'),
  ('18196', 'Xã Sơn Kim 1', '42'),
  ('18199', 'Xã Sơn Kim 2', '42'),
  ('18202', 'Xã Tứ Mỹ', '42'),
  ('18223', 'Xã Kim Hoa', '42'),
  ('18229', 'Xã Đức Thọ', '42'),
  ('18244', 'Xã Đức Minh', '42'),
  ('18262', 'Xã Đức Quang', '42'),
  ('18277', 'Xã Đức Thịnh', '42'),
  ('18304', 'Xã Đức Đồng', '42'),
  ('18313', 'Xã Vũ Quang', '42'),
  ('18322', 'Xã Mai Hoa', '42'),
  ('18328', 'Xã Thượng Đức', '42'),
  ('18352', 'Xã Nghi Xuân', '42'),
  ('18364', 'Xã Đan Hải', '42'),
  ('18373', 'Xã Tiên Điền', '42'),
  ('18394', 'Xã Cổ Đạm', '42'),
  ('18406', 'Xã Can Lộc', '42'),
  ('18409', 'Xã Hồng Lộc', '42'),
  ('18418', 'Xã Tùng Lộc', '42'),
  ('18436', 'Xã Trường Lưu', '42'),
  ('18466', 'Xã Gia Hanh', '42'),
  ('18481', 'Xã Xuân Lộc', '42'),
  ('18484', 'Xã Đồng Lộc', '42'),
  ('18496', 'Xã Hương Khê', '42'),
  ('18502', 'Xã Hà Linh', '42'),
  ('18523', 'Xã Hương Bình', '42'),
  ('18532', 'Xã Hương Phố', '42'),
  ('18544', 'Xã Hương Xuân', '42'),
  ('18547', 'Xã Phúc Trạch', '42'),
  ('18550', 'Xã Hương Đô', '42'),
  ('18562', 'Xã Thạch Hà', '42'),
  ('18568', 'Xã Lộc Hà', '42'),
  ('18583', 'Xã Mai Phụ', '42'),
  ('18586', 'Xã Đông Kinh', '42'),
  ('18601', 'Xã Việt Xuyên', '42'),
  ('18604', 'Xã Thạch Khê', '42'),
  ('18619', 'Xã Đồng Tiến', '42'),
  ('18628', 'Xã Thạch Lạc', '42'),
  ('18634', 'Xã Toàn Lưu', '42'),
  ('18652', 'Phường Hà Huy Tập', '42'),
  ('18667', 'Xã Thạch Xuân', '42'),
  ('18673', 'Xã Cẩm Xuyên', '42'),
  ('18676', 'Xã Thiên Cầm', '42'),
  ('18682', 'Xã Yên Hòa', '42'),
  ('18685', 'Xã Cẩm Bình', '42'),
  ('18736', 'Xã Cẩm Hưng', '42'),
  ('18739', 'Xã Cẩm Duệ', '42'),
  ('18742', 'Xã Cẩm Trung', '42'),
  ('18748', 'Xã Cẩm Lạc', '42'),
  ('18754', 'Phường Sông Trí', '42'),
  ('18766', 'Xã Kỳ Xuân', '42'),
  ('18775', 'Xã Kỳ Anh', '42'),
  ('18781', 'Phường Hải Ninh', '42'),
  ('18787', 'Xã Kỳ Văn', '42'),
  ('18790', 'Xã Kỳ Khang', '42'),
  ('18814', 'Xã Kỳ Hoa', '42'),
  ('18823', 'Phường Vũng Áng', '42'),
  ('18832', 'Phường Hoành Sơn', '42'),
  ('18838', 'Xã Kỳ Lạc', '42'),
  ('18844', 'Xã Kỳ Thượng', '42'),
  ('18859', 'Phường Đồng Thuận', '44'),
  ('18871', 'Phường Đồng Sơn', '44'),
  ('18880', 'Phường Đồng Hới', '44'),
  ('18901', 'Xã Minh Hóa', '44'),
  ('18904', 'Xã Dân Hóa', '44'),
  ('18919', 'Xã Tân Thành', '44'),
  ('18922', 'Xã Kim Điền', '44'),
  ('18943', 'Xã Kim Phú', '44'),
  ('18949', 'Xã Đồng Lê', '44'),
  ('18952', 'Xã Tuyên Sơn', '44'),
  ('18958', 'Xã Tuyên Lâm', '44'),
  ('18985', 'Xã Tuyên Phú', '44'),
  ('18991', 'Xã Tuyên Bình', '44'),
  ('18997', 'Xã Tuyên Hóa', '44'),
  ('19009', 'Phường Ba Đồn', '44'),
  ('19021', 'Xã Phú Trạch', '44'),
  ('19030', 'Xã Trung Thuần', '44'),
  ('19033', 'Xã Hòa Trạch', '44'),
  ('19051', 'Xã Tân Gianh', '44'),
  ('19057', 'Xã Quảng Trạch', '44'),
  ('19066', 'Phường Bắc Gianh', '44'),
  ('19075', 'Xã Nam Ba Đồn', '44'),
  ('19093', 'Xã Nam Gianh', '44'),
  ('19111', 'Xã Hoàn Lão', '44'),
  ('19126', 'Xã Bắc Trạch', '44'),
  ('19138', 'Xã Phong Nha', '44'),
  ('19141', 'Xã Bố Trạch', '44'),
  ('19147', 'Xã Thượng Trạch', '44'),
  ('19159', 'Xã Đông Trạch', '44'),
  ('19198', 'Xã Nam Trạch', '44'),
  ('19204', 'Xã Trường Sơn', '44'),
  ('19207', 'Xã Quảng Ninh', '44'),
  ('19225', 'Xã Ninh Châu', '44'),
  ('19237', 'Xã Trường Ninh', '44'),
  ('19246', 'Xã Lệ Ninh', '44'),
  ('19249', 'Xã Lệ Thủy', '44'),
  ('19255', 'Xã Cam Hồng', '44'),
  ('19288', 'Xã Sen Ngư', '44'),
  ('19291', 'Xã Tân Mỹ', '44'),
  ('19309', 'Xã Trường Phú', '44'),
  ('19318', 'Xã Kim Ngân', '44'),
  ('19333', 'Phường Đông Hà', '44'),
  ('19351', 'Phường Nam Đông Hà', '44'),
  ('19360', 'Phường Quảng Trị', '44'),
  ('19363', 'Xã Vĩnh Linh', '44'),
  ('19366', 'Xã Bến Quan', '44'),
  ('19372', 'Xã Vĩnh Hoàng', '44'),
  ('19405', 'Xã Vĩnh Thủy', '44'),
  ('19414', 'Xã Cửa Tùng', '44'),
  ('19429', 'Xã Khe Sanh', '44'),
  ('19432', 'Xã Lao Bảo', '44'),
  ('19435', 'Xã Hướng Lập', '44'),
  ('19441', 'Xã Hướng Phùng', '44'),
  ('19462', 'Xã Tân Lập', '44'),
  ('19483', 'Xã A Dơi', '44'),
  ('19489', 'Xã Lìa', '44'),
  ('19495', 'Xã Gio Linh', '44'),
  ('19496', 'Xã Cửa Việt', '44'),
  ('19501', 'Xã Bến Hải', '44'),
  ('19537', 'Xã Cồn Tiên', '44'),
  ('19555', 'Xã Hướng Hiệp', '44'),
  ('19564', 'Xã Đakrông', '44'),
  ('19567', 'Xã Ba Lòng', '44'),
  ('19588', 'Xã Tà Rụt', '44'),
  ('19594', 'Xã La Lay', '44'),
  ('19597', 'Xã Cam Lộ', '44'),
  ('19603', 'Xã Hiếu Giang', '44'),
  ('19624', 'Xã Triệu Phong', '44'),
  ('19639', 'Xã Nam Cửa Việt', '44'),
  ('19645', 'Xã Triệu Bình', '44'),
  ('19654', 'Xã Triệu Cơ', '44'),
  ('19669', 'Xã Ái Tử', '44'),
  ('19681', 'Xã Diên Sanh', '44'),
  ('19699', 'Xã Vĩnh Định', '44'),
  ('19702', 'Xã Hải Lăng', '44'),
  ('19735', 'Xã Nam Hải Lăng', '44'),
  ('19741', 'Xã Mỹ Thủy', '44'),
  ('19742', 'Đặc khu Cồn Cỏ', '44'),
  ('19753', 'Phường Phú Xuân', '46'),
  ('19774', 'Phường Kim Long', '46'),
  ('19777', 'Phường Vỹ Dạ', '46'),
  ('19789', 'Phường Thuận Hóa', '46'),
  ('19804', 'Phường Hương An', '46'),
  ('19813', 'Phường Thủy Xuân', '46'),
  ('19815', 'Phường An Cựu', '46'),
  ('19819', 'Phường Phong Điền', '46'),
  ('19828', 'Phường Phong Phú', '46'),
  ('19831', 'Phường Phong Dinh', '46'),
  ('19858', 'Phường Phong Thái', '46'),
  ('19867', 'Xã Quảng Điền', '46'),
  ('19873', 'Phường Phong Quảng', '46'),
  ('19885', 'Xã Đan Điền', '46'),
  ('19900', 'Phường Thuận An', '46'),
  ('19909', 'Phường Dương Nỗ', '46'),
  ('19918', 'Xã Phú Hồ', '46'),
  ('19930', 'Phường Mỹ Thượng', '46'),
  ('19942', 'Xã Phú Vang', '46'),
  ('19945', 'Xã Phú Vinh', '46'),
  ('19960', 'Phường Phú Bài', '46'),
  ('19969', 'Phường Thanh Thủy', '46'),
  ('19975', 'Phường Hương Thủy', '46'),
  ('19996', 'Phường Hương Trà', '46'),
  ('20014', 'Phường Hóa Châu', '46'),
  ('20017', 'Phường Kim Trà', '46'),
  ('20035', 'Xã Bình Điền', '46'),
  ('20044', 'Xã A Lưới 2', '46'),
  ('20050', 'Xã A Lưới 5', '46'),
  ('20056', 'Xã A Lưới 1', '46'),
  ('20071', 'Xã A Lưới 3', '46'),
  ('20101', 'Xã A Lưới 4', '46'),
  ('20107', 'Xã Phú Lộc', '46'),
  ('20122', 'Xã Vinh Lộc', '46'),
  ('20131', 'Xã Hưng Lộc', '46'),
  ('20137', 'Xã Chân Mây - Lăng Cô', '46'),
  ('20140', 'Xã Lộc An', '46'),
  ('20161', 'Xã Khe Tre', '46'),
  ('20179', 'Xã Nam Đông', '46'),
  ('20182', 'Xã Long Quảng', '46'),
  ('20194', 'Phường Hải Vân', '48'),
  ('20197', 'Phường Liên Chiểu', '48'),
  ('20200', 'Phường Hòa Khánh', '48'),
  ('20209', 'Phường Thanh Khê', '48'),
  ('20242', 'Phường Hải Châu', '48'),
  ('20257', 'Phường Hòa Cường', '48'),
  ('20260', 'Phường Cẩm Lệ', '48'),
  ('20263', 'Phường Sơn Trà', '48'),
  ('20275', 'Phường An Hải', '48'),
  ('20285', 'Phường Ngũ Hành Sơn', '48'),
  ('20305', 'Phường An Khê', '48'),
  ('20308', 'Xã Bà Nà', '48'),
  ('20314', 'Phường Hòa Xuân', '48'),
  ('20320', 'Xã Hòa Vang', '48'),
  ('20332', 'Xã Hòa Tiến', '48'),
  ('20333', 'Đặc khu Hoàng Sa', '48'),
  ('20335', 'Phường Bàn Thạch', '48'),
  ('20341', 'Phường Tam Kỳ', '48'),
  ('20350', 'Phường Hương Trà', '48'),
  ('20356', 'Phường Quảng Phú', '48'),
  ('20364', 'Xã Chiên Đàn', '48'),
  ('20380', 'Xã Tây Hồ', '48'),
  ('20392', 'Xã Phú Ninh', '48'),
  ('20401', 'Phường Hội An Tây', '48'),
  ('20410', 'Phường Hội An', '48'),
  ('20413', 'Phường Hội An Đông', '48'),
  ('20434', 'Xã Tân Hiệp', '48'),
  ('20443', 'Xã Hùng Sơn', '48'),
  ('20455', 'Xã Tây Giang', '48'),
  ('20458', 'Xã Avương', '48'),
  ('20467', 'Xã Đông Giang', '48'),
  ('20476', 'Xã Sông Kôn', '48'),
  ('20485', 'Xã Sông Vàng', '48'),
  ('20494', 'Xã Bến Hiên', '48'),
  ('20500', 'Xã Đại Lộc', '48'),
  ('20506', 'Xã Thượng Đức', '48'),
  ('20515', 'Xã Hà Nha', '48'),
  ('20539', 'Xã Vu Gia', '48'),
  ('20542', 'Xã Phú Thuận', '48'),
  ('20551', 'Phường Điện Bàn', '48'),
  ('20557', 'Phường Điện Bàn Bắc', '48'),
  ('20569', 'Xã Điện Bàn Tây', '48'),
  ('20575', 'Phường An Thắng', '48'),
  ('20579', 'Phường Điện Bàn Đông', '48'),
  ('20587', 'Xã Gò Nổi', '48'),
  ('20599', 'Xã Nam Phước', '48'),
  ('20611', 'Xã Thu Bồn', '48'),
  ('20623', 'Xã Duy Xuyên', '48'),
  ('20635', 'Xã Duy Nghĩa', '48'),
  ('20641', 'Xã Quế Sơn', '48'),
  ('20650', 'Xã Xuân Phú', '48'),
  ('20656', 'Xã Nông Sơn', '48'),
  ('20662', 'Xã Quế Sơn Trung', '48'),
  ('20669', 'Xã Quế Phước', '48'),
  ('20695', 'Xã Thạnh Mỹ', '48'),
  ('20698', 'Xã La Êê', '48'),
  ('20704', 'Xã La Dêê', '48'),
  ('20707', 'Xã Nam Giang', '48'),
  ('20710', 'Xã Bến Giằng', '48'),
  ('20716', 'Xã Đắc Pring', '48'),
  ('20722', 'Xã Khâm Đức', '48'),
  ('20728', 'Xã Phước Hiệp', '48'),
  ('20734', 'Xã Phước Năng', '48'),
  ('20740', 'Xã Phước Chánh', '48'),
  ('20752', 'Xã Phước Thành', '48'),
  ('20767', 'Xã Việt An', '48'),
  ('20770', 'Xã Phước Trà', '48'),
  ('20779', 'Xã Hiệp Đức', '48'),
  ('20791', 'Xã Thăng Bình', '48'),
  ('20794', 'Xã Thăng An', '48'),
  ('20818', 'Xã Đồng Dương', '48'),
  ('20827', 'Xã Thăng Phú', '48'),
  ('20836', 'Xã Thăng Trường', '48'),
  ('20848', 'Xã Thăng Điền', '48'),
  ('20854', 'Xã Tiên Phước', '48'),
  ('20857', 'Xã Sơn Cẩm Hà', '48'),
  ('20875', 'Xã Lãnh Ngọc', '48'),
  ('20878', 'Xã Thạnh Bình', '48'),
  ('20900', 'Xã Trà My', '48'),
  ('20908', 'Xã Trà Liên', '48'),
  ('20920', 'Xã Trà Đốc', '48'),
  ('20923', 'Xã Trà Tân', '48'),
  ('20929', 'Xã Trà Giáp', '48'),
  ('20938', 'Xã Trà Leng', '48'),
  ('20941', 'Xã Trà Tập', '48'),
  ('20944', 'Xã Nam Trà My', '48'),
  ('20950', 'Xã Trà Linh', '48'),
  ('20959', 'Xã Trà Vân', '48'),
  ('20965', 'Xã Núi Thành', '48'),
  ('20971', 'Xã Tam Xuân', '48'),
  ('20977', 'Xã Đức Phú', '48'),
  ('20984', 'Xã Tam Anh', '48'),
  ('20992', 'Xã Tam Hải', '48'),
  ('21004', 'Xã Tam Mỹ', '48'),
  ('21025', 'Phường Cẩm Thành', '51'),
  ('21028', 'Phường Nghĩa Lộ', '51'),
  ('21034', 'Xã An Phú', '51'),
  ('21040', 'Xã Bình Sơn', '51'),
  ('21061', 'Xã Vạn Tường', '51'),
  ('21085', 'Xã Bình Minh', '51'),
  ('21100', 'Xã Bình Chương', '51'),
  ('21109', 'Xã Đông Sơn', '51'),
  ('21115', 'Xã Trà Bồng', '51'),
  ('21124', 'Xã Thanh Bồng', '51'),
  ('21127', 'Xã Đông Trà Bồng', '51'),
  ('21136', 'Xã Cà Đam', '51'),
  ('21154', 'Xã Tây Trà', '51'),
  ('21157', 'Xã Tây Trà Bồng', '51'),
  ('21172', 'Phường Trương Quang Trọng', '51'),
  ('21181', 'Xã Thọ Phong', '51'),
  ('21196', 'Xã Trường Giang', '51'),
  ('21205', 'Xã Ba Gia', '51'),
  ('21211', 'Xã Tịnh Khê', '51'),
  ('21220', 'Xã Sơn Tịnh', '51'),
  ('21235', 'Xã Tư Nghĩa', '51'),
  ('21238', 'Xã Vệ Giang', '51'),
  ('21244', 'Xã Trà Giang', '51'),
  ('21250', 'Xã Nghĩa Giang', '51'),
  ('21289', 'Xã Sơn Hà', '51'),
  ('21292', 'Xã Sơn Hạ', '51'),
  ('21307', 'Xã Sơn Linh', '51'),
  ('21319', 'Xã Sơn Thủy', '51'),
  ('21325', 'Xã Sơn Kỳ', '51'),
  ('21334', 'Xã Sơn Tây Thượng', '51'),
  ('21340', 'Xã Sơn Tây', '51'),
  ('21343', 'Xã Sơn Tây Hạ', '51'),
  ('21349', 'Xã Sơn Mai', '51'),
  ('21361', 'Xã Minh Long', '51'),
  ('21364', 'Xã Nghĩa Hành', '51'),
  ('21370', 'Xã Phước Giang', '51'),
  ('21385', 'Xã Đình Cương', '51'),
  ('21388', 'Xã Thiện Tín', '51'),
  ('21400', 'Xã Mộ Đức', '51'),
  ('21409', 'Xã Long Phụng', '51'),
  ('21421', 'Xã Mỏ Cày', '51'),
  ('21433', 'Xã Lân Phong', '51'),
  ('21439', 'Phường Đức Phổ', '51'),
  ('21451', 'Phường Trà Câu', '51'),
  ('21457', 'Xã Nguyễn Nghiêm', '51'),
  ('21472', 'Xã Khánh Cường', '51'),
  ('21478', 'Phường Sa Huỳnh', '51'),
  ('21484', 'Xã Ba Tơ', '51'),
  ('21490', 'Xã Ba Vinh', '51'),
  ('21496', 'Xã Ba Động', '51'),
  ('21499', 'Xã Ba Dinh', '51'),
  ('21520', 'Xã Đặng Thùy Trâm', '51'),
  ('21523', 'Xã Ba Tô', '51'),
  ('21529', 'Xã Ba Vì', '51'),
  ('21538', 'Xã Ba Xa', '51');

insert into public.wards (code, name, province_code) values
  ('21548', 'Đặc khu Lý Sơn', '51'),
  ('21553', 'Phường Quy Nhơn Bắc', '52'),
  ('21583', 'Phường Quy Nhơn', '52'),
  ('21589', 'Phường Quy Nhơn Tây', '52'),
  ('21592', 'Phường Quy Nhơn Nam', '52'),
  ('21601', 'Phường Quy Nhơn Đông', '52'),
  ('21607', 'Xã Nhơn Châu', '52'),
  ('21609', 'Xã An Lão', '52'),
  ('21616', 'Xã An Vinh', '52'),
  ('21622', 'Xã An Toàn', '52'),
  ('21628', 'Xã An Hòa', '52'),
  ('21637', 'Phường Tam Quan', '52'),
  ('21640', 'Phường Bồng Sơn', '52'),
  ('21655', 'Phường Hoài Nhơn Bắc', '52'),
  ('21661', 'Phường Hoài Nhơn Tây', '52'),
  ('21664', 'Phường Hoài Nhơn', '52'),
  ('21670', 'Phường Hoài Nhơn Đông', '52'),
  ('21673', 'Phường Hoài Nhơn Nam', '52'),
  ('21688', 'Xã Hoài Ân', '52'),
  ('21697', 'Xã Ân Hảo', '52'),
  ('21703', 'Xã Vạn Đức', '52'),
  ('21715', 'Xã Ân Tường', '52'),
  ('21727', 'Xã Kim Sơn', '52'),
  ('21730', 'Xã Phù Mỹ', '52'),
  ('21733', 'Xã Bình Dương', '52'),
  ('21739', 'Xã Phù Mỹ Bắc', '52'),
  ('21751', 'Xã Phù Mỹ Đông', '52'),
  ('21757', 'Xã Phù Mỹ Tây', '52'),
  ('21769', 'Xã An Lương', '52'),
  ('21775', 'Xã Phù Mỹ Nam', '52'),
  ('21786', 'Xã Vĩnh Thạnh', '52'),
  ('21787', 'Xã Vĩnh Sơn', '52'),
  ('21796', 'Xã Vĩnh Thịnh', '52'),
  ('21805', 'Xã Vĩnh Quang', '52'),
  ('21808', 'Xã Tây Sơn', '52'),
  ('21817', 'Xã Bình Hiệp', '52'),
  ('21820', 'Xã Bình Khê', '52'),
  ('21829', 'Xã Bình An', '52'),
  ('21835', 'Xã Bình Phú', '52'),
  ('21853', 'Xã Phù Cát', '52'),
  ('21859', 'Xã Đề Gi', '52'),
  ('21868', 'Xã Hội Sơn', '52'),
  ('21871', 'Xã Hòa Hội', '52'),
  ('21880', 'Xã Cát Tiến', '52'),
  ('21892', 'Xã Xuân An', '52'),
  ('21901', 'Xã Ngô Mây', '52'),
  ('21907', 'Phường Bình Định', '52'),
  ('21910', 'Phường An Nhơn', '52'),
  ('21925', 'Phường An Nhơn Bắc', '52'),
  ('21934', 'Phường An Nhơn Đông', '52'),
  ('21940', 'Xã An Nhơn Tây', '52'),
  ('21943', 'Phường An Nhơn Nam', '52'),
  ('21952', 'Xã Tuy Phước', '52'),
  ('21964', 'Xã Tuy Phước Bắc', '52'),
  ('21970', 'Xã Tuy Phước Đông', '52'),
  ('21985', 'Xã Tuy Phước Tây', '52'),
  ('21994', 'Xã Vân Canh', '52'),
  ('21997', 'Xã Canh Liên', '52'),
  ('22006', 'Xã Canh Vinh', '52'),
  ('22015', 'Phường Tuy Hòa', '66'),
  ('22045', 'Phường Bình Kiến', '66'),
  ('22051', 'Phường Sông Cầu', '66'),
  ('22057', 'Xã Xuân Lộc', '66'),
  ('22060', 'Xã Xuân Cảnh', '66'),
  ('22075', 'Xã Xuân Thọ', '66'),
  ('22076', 'Phường Xuân Đài', '66'),
  ('22081', 'Xã Đồng Xuân', '66'),
  ('22090', 'Xã Xuân Lãnh', '66'),
  ('22096', 'Xã Phú Mỡ', '66'),
  ('22111', 'Xã Xuân Phước', '66'),
  ('22114', 'Xã Tuy An Bắc', '66'),
  ('22120', 'Xã Tuy An Đông', '66'),
  ('22132', 'Xã Tuy An Tây', '66'),
  ('22147', 'Xã Ô Loan', '66'),
  ('22153', 'Xã Tuy An Nam', '66'),
  ('22165', 'Xã Sơn Hòa', '66'),
  ('22171', 'Xã Tây Sơn', '66'),
  ('22177', 'Xã Vân Hòa', '66'),
  ('22192', 'Xã Suối Trai', '66'),
  ('22207', 'Xã Sông Hinh', '66'),
  ('22222', 'Xã Đức Bình', '66'),
  ('22225', 'Xã Ea Bá', '66'),
  ('22237', 'Xã Ea Ly', '66'),
  ('22240', 'Phường Phú Yên', '66'),
  ('22250', 'Xã Sơn Thành', '66'),
  ('22255', 'Xã Tây Hòa', '66'),
  ('22258', 'Phường Đông Hòa', '66'),
  ('22261', 'Phường Hòa Hiệp', '66'),
  ('22276', 'Xã Hòa Thịnh', '66'),
  ('22285', 'Xã Hòa Mỹ', '66'),
  ('22291', 'Xã Hòa Xuân', '66'),
  ('22303', 'Xã Phú Hòa 2', '66'),
  ('22319', 'Xã Phú Hòa 1', '66'),
  ('22333', 'Phường Bắc Nha Trang', '56'),
  ('22366', 'Phường Nha Trang', '56'),
  ('22390', 'Phường Tây Nha Trang', '56'),
  ('22402', 'Phường Nam Nha Trang', '56'),
  ('22411', 'Phường Bắc Cam Ranh', '56'),
  ('22420', 'Phường Cam Ranh', '56'),
  ('22423', 'Phường Ba Ngòi', '56'),
  ('22432', 'Phường Cam Linh', '56'),
  ('22435', 'Xã Cam Hiệp', '56'),
  ('22453', 'Xã Cam Lâm', '56'),
  ('22465', 'Xã Cam An', '56'),
  ('22480', 'Xã Nam Cam Ranh', '56'),
  ('22489', 'Xã Vạn Ninh', '56'),
  ('22498', 'Xã Tu Bông', '56'),
  ('22504', 'Xã Đại Lãnh', '56'),
  ('22516', 'Xã Vạn Thắng', '56'),
  ('22525', 'Xã Vạn Hưng', '56'),
  ('22528', 'Phường Ninh Hòa', '56'),
  ('22546', 'Xã Bắc Ninh Hòa', '56'),
  ('22552', 'Xã Tây Ninh Hòa', '56'),
  ('22558', 'Xã Hòa Trí', '56'),
  ('22561', 'Phường Đông Ninh Hòa', '56'),
  ('22576', 'Xã Tân Định', '56'),
  ('22591', 'Phường Hòa Thắng', '56'),
  ('22597', 'Xã Nam Ninh Hòa', '56'),
  ('22609', 'Xã Khánh Vĩnh', '56'),
  ('22612', 'Xã Trung Khánh Vĩnh', '56'),
  ('22615', 'Xã Bắc Khánh Vĩnh', '56'),
  ('22624', 'Xã Tây Khánh Vĩnh', '56'),
  ('22648', 'Xã Nam Khánh Vĩnh', '56'),
  ('22651', 'Xã Diên Khánh', '56'),
  ('22657', 'Xã Diên Điền', '56'),
  ('22660', 'Xã Diên Lâm', '56'),
  ('22672', 'Xã Diên Thọ', '56'),
  ('22678', 'Xã Diên Lạc', '56'),
  ('22702', 'Xã Suối Hiệp', '56'),
  ('22708', 'Xã Suối Dầu', '56'),
  ('22714', 'Xã Khánh Sơn', '56'),
  ('22720', 'Xã Tây Khánh Sơn', '56'),
  ('22732', 'Xã Đông Khánh Sơn', '56'),
  ('22736', 'Đặc khu Trường Sa', '56'),
  ('22738', 'Phường Đô Vinh', '56'),
  ('22741', 'Phường Bảo An', '56'),
  ('22759', 'Phường Phan Rang', '56'),
  ('22780', 'Phường Đông Hải', '56'),
  ('22786', 'Xã Bác Ái Tây', '56'),
  ('22795', 'Xã Bác Ái', '56'),
  ('22801', 'Xã Bác Ái Đông', '56'),
  ('22810', 'Xã Ninh Sơn', '56'),
  ('22813', 'Xã Lâm Sơn', '56'),
  ('22822', 'Xã Mỹ Sơn', '56'),
  ('22828', 'Xã Anh Dũng', '56'),
  ('22834', 'Phường Ninh Chử', '56'),
  ('22840', 'Xã Công Hải', '56'),
  ('22846', 'Xã Vĩnh Hải', '56'),
  ('22849', 'Xã Thuận Bắc', '56'),
  ('22852', 'Xã Ninh Hải', '56'),
  ('22861', 'Xã Xuân Hải', '56'),
  ('22870', 'Xã Ninh Phước', '56'),
  ('22873', 'Xã Phước Hậu', '56'),
  ('22888', 'Xã Phước Dinh', '56'),
  ('22891', 'Xã Phước Hữu', '56'),
  ('22897', 'Xã Thuận Nam', '56'),
  ('22900', 'Xã Phước Hà', '56'),
  ('22909', 'Xã Cà Ná', '56'),
  ('22918', 'Phường Mũi Né', '68'),
  ('22924', 'Phường Phú Thủy', '68'),
  ('22933', 'Phường Hàm Thắng', '68'),
  ('22945', 'Phường Phan Thiết', '68'),
  ('22954', 'Phường Tiến Thành', '68'),
  ('22960', 'Phường Bình Thuận', '68'),
  ('22963', 'Xã Tuyên Quang', '68'),
  ('22969', 'Xã Liên Hương', '68'),
  ('22972', 'Xã Phan Rí Cửa', '68'),
  ('22978', 'Xã Tuy Phong', '68'),
  ('22981', 'Xã Vĩnh Hảo', '68'),
  ('23005', 'Xã Bắc Bình', '68'),
  ('23008', 'Xã Phan Sơn', '68'),
  ('23020', 'Xã Hải Ninh', '68'),
  ('23023', 'Xã Sông Lũy', '68'),
  ('23032', 'Xã Lương Sơn', '68'),
  ('23041', 'Xã Hồng Thái', '68'),
  ('23053', 'Xã Hòa Thắng', '68'),
  ('23059', 'Xã Hàm Thuận', '68'),
  ('23065', 'Xã La Dạ', '68'),
  ('23074', 'Xã Đông Giang', '68'),
  ('23086', 'Xã Hồng Sơn', '68'),
  ('23089', 'Xã Hàm Thuận Bắc', '68'),
  ('23095', 'Xã Hàm Liêm', '68'),
  ('23110', 'Xã Hàm Thuận Nam', '68'),
  ('23122', 'Xã Hàm Thạnh', '68'),
  ('23128', 'Xã Hàm Kiệm', '68'),
  ('23134', 'Xã Tân Lập', '68'),
  ('23143', 'Xã Tân Thành', '68'),
  ('23149', 'Xã Tánh Linh', '68'),
  ('23152', 'Xã Bắc Ruộng', '68'),
  ('23158', 'Xã Nghị Đức', '68'),
  ('23173', 'Xã Đồng Kho', '68'),
  ('23188', 'Xã Suối Kiết', '68'),
  ('23191', 'Xã Đức Linh', '68'),
  ('23194', 'Xã Hoài Đức', '68'),
  ('23200', 'Xã Nam Thành', '68'),
  ('23227', 'Xã Trà Tân', '68'),
  ('23230', 'Xã Tân Minh', '68'),
  ('23231', 'Phường Phước Hội', '68'),
  ('23235', 'Phường La Gi', '68'),
  ('23236', 'Xã Hàm Tân', '68'),
  ('23246', 'Xã Tân Hải', '68'),
  ('23266', 'Xã Sơn Mỹ', '68'),
  ('23272', 'Đặc khu Phú Quý', '68'),
  ('23284', 'Phường Đăk Cấm', '51'),
  ('23293', 'Phường Kon Tum', '51'),
  ('23302', 'Phường Đăk Bla', '51'),
  ('23317', 'Xã Ngọk Bay', '51'),
  ('23326', 'Xã Ia Chim', '51'),
  ('23332', 'Xã Đăk Rơ Wa', '51'),
  ('23341', 'Xã Đăk Pék', '51'),
  ('23344', 'Xã Đăk Plô', '51'),
  ('23356', 'Xã Xốp', '51'),
  ('23365', 'Xã Ngọc Linh', '51'),
  ('23368', 'Xã Đăk Long', '51'),
  ('23374', 'Xã Đăk Môn', '51'),
  ('23377', 'Xã Bờ Y', '51'),
  ('23383', 'Xã Dục Nông', '51'),
  ('23392', 'Xã Sa Loong', '51'),
  ('23401', 'Xã Đăk Tô', '51'),
  ('23416', 'Xã Đăk Sao', '51'),
  ('23419', 'Xã Đăk Tờ Kan', '51'),
  ('23425', 'Xã Tu Mơ Rông', '51'),
  ('23428', 'Xã Ngọk Tụ', '51'),
  ('23430', 'Xã Kon Đào', '51'),
  ('23446', 'Xã Măng Ri', '51'),
  ('23455', 'Xã Măng Bút', '51'),
  ('23473', 'Xã Măng Đen', '51'),
  ('23476', 'Xã Kon Plông', '51'),
  ('23479', 'Xã Đăk Rve', '51'),
  ('23485', 'Xã Đăk Kôi', '51'),
  ('23497', 'Xã Kon Braih', '51'),
  ('23500', 'Xã Đăk Hà', '51'),
  ('23504', 'Xã Đăk Pxi', '51'),
  ('23510', 'Xã Đăk Ui', '51'),
  ('23512', 'Xã Đăk Mar', '51'),
  ('23515', 'Xã Ngọk Réo', '51'),
  ('23527', 'Xã Sa Thầy', '51'),
  ('23530', 'Xã Rờ Kơi', '51'),
  ('23534', 'Xã Sa Bình', '51'),
  ('23535', 'Xã Ia Đal', '51'),
  ('23536', 'Xã Mô Rai', '51'),
  ('23538', 'Xã Ia Tơi', '51'),
  ('23548', 'Xã Ya Ly', '51'),
  ('23563', 'Phường Diên Hồng', '52'),
  ('23575', 'Phường Pleiku', '52'),
  ('23584', 'Phường Thống Nhất', '52'),
  ('23586', 'Phường Hội Phú', '52'),
  ('23590', 'Xã Biển Hồ', '52'),
  ('23602', 'Phường An Phú', '52'),
  ('23611', 'Xã Gào', '52'),
  ('23614', 'Phường An Bình', '52'),
  ('23617', 'Phường An Khê', '52'),
  ('23629', 'Xã Cửu An', '52'),
  ('23638', 'Xã Kbang', '52'),
  ('23644', 'Xã Đak Rong', '52'),
  ('23647', 'Xã Sơn Lang', '52'),
  ('23650', 'Xã Krong', '52'),
  ('23668', 'Xã Tơ Tung', '52'),
  ('23674', 'Xã Kông Bơ La', '52'),
  ('23677', 'Xã Đak Đoa', '52'),
  ('23683', 'Xã Đak Sơmei', '52'),
  ('23701', 'Xã Kon Gang', '52'),
  ('23710', 'Xã Ia Băng', '52'),
  ('23714', 'Xã KDang', '52'),
  ('23722', 'Xã Chư Păh', '52'),
  ('23728', 'Xã Ia Khươl', '52'),
  ('23734', 'Xã Ia Ly', '52'),
  ('23737', 'Xã Ia Mơ', '52'),
  ('23749', 'Xã Ia Phí', '52'),
  ('23764', 'Xã Ia Grai', '52'),
  ('23767', 'Xã Ia Hrung', '52'),
  ('23776', 'Xã Ia Krái', '52'),
  ('23782', 'Xã Ia O', '52'),
  ('23788', 'Xã Ia Chia', '52'),
  ('23794', 'Xã Mang Yang', '52'),
  ('23798', 'Xã Ayun', '52'),
  ('23799', 'Xã Hra', '52'),
  ('23812', 'Xã Lơ Pang', '52'),
  ('23818', 'Xã Kon Chiêng', '52'),
  ('23824', 'Xã Kông Chro', '52'),
  ('23830', 'Xã Chư Krey', '52'),
  ('23833', 'Xã Ya Ma', '52'),
  ('23839', 'Xã SRó', '52'),
  ('23842', 'Xã Đăk Song', '52'),
  ('23851', 'Xã Chơ Long', '52'),
  ('23857', 'Xã Đức Cơ', '52'),
  ('23866', 'Xã Ia Krêl', '52'),
  ('23869', 'Xã Ia Dơk', '52'),
  ('23872', 'Xã Ia Dom', '52'),
  ('23881', 'Xã Ia Pnôn', '52'),
  ('23884', 'Xã Ia Nan', '52'),
  ('23887', 'Xã Chư Prông', '52'),
  ('23896', 'Xã Bàu Cạn', '52'),
  ('23908', 'Xã Ia Tôr', '52'),
  ('23911', 'Xã Ia Boòng', '52'),
  ('23917', 'Xã Ia Púch', '52'),
  ('23926', 'Xã Ia Pia', '52'),
  ('23935', 'Xã Ia Lâu', '52'),
  ('23941', 'Xã Chư Sê', '52'),
  ('23942', 'Xã Chư Pưh', '52'),
  ('23947', 'Xã Bờ Ngoong', '52'),
  ('23954', 'Xã Al Bá', '52'),
  ('23971', 'Xã Ia Hrú', '52'),
  ('23977', 'Xã Ia Ko', '52'),
  ('23986', 'Xã Ia Le', '52'),
  ('23995', 'Xã Đak Pơ', '52'),
  ('24007', 'Xã Ya Hội', '52'),
  ('24013', 'Xã Pờ Tó', '52'),
  ('24022', 'Xã Ia Pa', '52'),
  ('24028', 'Xã Ia Tul', '52'),
  ('24043', 'Xã Phú Thiện', '52'),
  ('24044', 'Phường Ayun Pa', '52'),
  ('24049', 'Xã Chư A Thai', '52'),
  ('24061', 'Xã Ia Hiao', '52'),
  ('24065', 'Xã Ia Rbol', '52'),
  ('24073', 'Xã Ia Sao', '52'),
  ('24076', 'Xã Phú Túc', '52'),
  ('24100', 'Xã Ia Dreh', '52'),
  ('24109', 'Xã Uar', '52'),
  ('24112', 'Xã Ia Rsai', '52'),
  ('24121', 'Phường Tân Lập', '66'),
  ('24133', 'Phường Buôn Ma Thuột', '66'),
  ('24154', 'Phường Thành Nhất', '66'),
  ('24163', 'Phường Tân An', '66'),
  ('24169', 'Phường Ea Kao', '66'),
  ('24175', 'Xã Hòa Phú', '66'),
  ('24181', 'Xã Ea Drăng', '66'),
  ('24184', 'Xã Ea H’Leo', '66'),
  ('24187', 'Xã Ea Hiao', '66'),
  ('24193', 'Xã Ea Wy', '66'),
  ('24208', 'Xã Ea Khăl', '66'),
  ('24211', 'Xã Ea Súp', '66'),
  ('24214', 'Xã Ia Lốp', '66'),
  ('24217', 'Xã Ea Rốk', '66'),
  ('24221', 'Xã Ia Rvê', '66'),
  ('24229', 'Xã Ea Bung', '66'),
  ('24235', 'Xã Buôn Đôn', '66'),
  ('24241', 'Xã Ea Wer', '66'),
  ('24250', 'Xã Ea Nuôl', '66'),
  ('24259', 'Xã Quảng Phú', '66'),
  ('24265', 'Xã Ea Kiết', '66'),
  ('24277', 'Xã Ea Tul', '66'),
  ('24280', 'Xã Cư M’gar', '66'),
  ('24286', 'Xã Ea M’Droh', '66'),
  ('24301', 'Xã Cuôr Đăng', '66'),
  ('24305', 'Phường Buôn Hồ', '66'),
  ('24310', 'Xã Krông Búk', '66'),
  ('24313', 'Xã Cư Pơng', '66'),
  ('24316', 'Xã Pơng Drang', '66'),
  ('24328', 'Xã Ea Drông', '66'),
  ('24340', 'Phường Cư Bao', '66'),
  ('24343', 'Xã Krông Năng', '66'),
  ('24346', 'Xã Dliê Ya', '66'),
  ('24352', 'Xã Tam Giang', '66'),
  ('24364', 'Xã Phú Xuân', '66'),
  ('24373', 'Xã Ea Kar', '66'),
  ('24376', 'Xã Ea Knốp', '66'),
  ('24400', 'Xã Ea Păl', '66'),
  ('24403', 'Xã Ea Ô', '66'),
  ('24406', 'Xã Cư Yang', '66'),
  ('24412', 'Xã M’Drắk', '66'),
  ('24415', 'Xã Cư Prao', '66'),
  ('24433', 'Xã Ea Riêng', '66'),
  ('24436', 'Xã Cư M’ta', '66'),
  ('24444', 'Xã Krông Á', '66'),
  ('24445', 'Xã Ea Trang', '66'),
  ('24448', 'Xã Krông Bông', '66'),
  ('24454', 'Xã Dang Kang', '66'),
  ('24472', 'Xã Hòa Sơn', '66'),
  ('24478', 'Xã Cư Pui', '66'),
  ('24484', 'Xã Yang Mao', '66'),
  ('24490', 'Xã Krông Pắc', '66'),
  ('24496', 'Xã Ea Kly', '66'),
  ('24502', 'Xã Ea Phê', '66'),
  ('24505', 'Xã Ea Knuếc', '66'),
  ('24526', 'Xã Tân Tiến', '66'),
  ('24529', 'Xã Vụ Bổn', '66'),
  ('24538', 'Xã Krông Ana', '66'),
  ('24540', 'Xã Ea Ning', '66'),
  ('24544', 'Xã Ea Ktur', '66'),
  ('24559', 'Xã Ea Na', '66'),
  ('24561', 'Xã Dray Bhăng', '66'),
  ('24568', 'Xã Dur Kmăl', '66'),
  ('24580', 'Xã Liên Sơn Lắk', '66'),
  ('24595', 'Xã Đắk Liêng', '66'),
  ('24598', 'Xã Đắk Phơi', '66'),
  ('24604', 'Xã Krông Nô', '66'),
  ('24607', 'Xã Nam Ka', '66'),
  ('24611', 'Phường Bắc Gia Nghĩa', '68'),
  ('24615', 'Phường Nam Gia Nghĩa', '68'),
  ('24616', 'Xã Quảng Sơn', '68'),
  ('24617', 'Phường Đông Gia Nghĩa', '68'),
  ('24620', 'Xã Quảng Hòa', '68'),
  ('24631', 'Xã Quảng Khê', '68'),
  ('24637', 'Xã Tà Đùng', '68'),
  ('24640', 'Xã Cư Jút', '68'),
  ('24646', 'Xã Đắk Wil', '68'),
  ('24649', 'Xã Nam Dong', '68'),
  ('24664', 'Xã Đức Lập', '68'),
  ('24670', 'Xã Đắk Mil', '68'),
  ('24678', 'Xã Đắk Sắk', '68'),
  ('24682', 'Xã Thuận An', '68'),
  ('24688', 'Xã Krông Nô', '68'),
  ('24697', 'Xã Nam Đà', '68'),
  ('24703', 'Xã Nâm Nung', '68'),
  ('24712', 'Xã Quảng Phú', '68'),
  ('24717', 'Xã Đức An', '68'),
  ('24718', 'Xã Đắk Song', '68'),
  ('24722', 'Xã Thuận Hạnh', '68'),
  ('24730', 'Xã Trường Xuân', '68'),
  ('24733', 'Xã Kiến Đức', '68'),
  ('24736', 'Xã Quảng Trực', '68'),
  ('24739', 'Xã Tuy Đức', '68'),
  ('24748', 'Xã Quảng Tân', '68'),
  ('24751', 'Xã Nhân Cơ', '68'),
  ('24760', 'Xã Quảng Tín', '68'),
  ('24778', 'Phường Lâm Viên - Đà Lạt', '68'),
  ('24781', 'Phường Xuân Hương - Đà Lạt', '68'),
  ('24787', 'Phường Cam Ly - Đà Lạt', '68'),
  ('24805', 'Phường Xuân Trường - Đà Lạt', '68'),
  ('24820', 'Phường 2 Bảo Lộc', '68'),
  ('24823', 'Phường 1 Bảo Lộc', '68'),
  ('24829', 'Phường B''Lao', '68'),
  ('24841', 'Phường 3 Bảo Lộc', '68'),
  ('24846', 'Phường Lang Biang - Đà Lạt', '68'),
  ('24848', 'Xã Lạc Dương', '68'),
  ('24853', 'Xã Đam Rông 4', '68'),
  ('24868', 'Xã Nam Ban Lâm Hà', '68'),
  ('24871', 'Xã Đinh Văn Lâm Hà', '68'),
  ('24875', 'Xã Đam Rông 3', '68'),
  ('24877', 'Xã Đam Rông 2', '68'),
  ('24883', 'Xã Nam Hà Lâm Hà', '68'),
  ('24886', 'Xã Đam Rông 1', '68'),
  ('24895', 'Xã Phú Sơn Lâm Hà', '68'),
  ('24907', 'Xã Phúc Thọ Lâm Hà', '68'),
  ('24916', 'Xã Tân Hà Lâm Hà', '68'),
  ('24931', 'Xã Đơn Dương', '68'),
  ('24934', 'Xã D''Ran', '68'),
  ('24943', 'Xã Ka Đô', '68'),
  ('24955', 'Xã Quảng Lập', '68'),
  ('24958', 'Xã Đức Trọng', '68'),
  ('24967', 'Xã Hiệp Thạnh', '68'),
  ('24976', 'Xã Tân Hội', '68'),
  ('24985', 'Xã Ninh Gia', '68'),
  ('24988', 'Xã Tà Năng', '68'),
  ('24991', 'Xã Tà Hine', '68'),
  ('25000', 'Xã Di Linh', '68'),
  ('25007', 'Xã Đinh Trang Thượng', '68'),
  ('25015', 'Xã Gia Hiệp', '68'),
  ('25018', 'Xã Bảo Thuận', '68'),
  ('25036', 'Xã Hòa Ninh', '68'),
  ('25042', 'Xã Hòa Bắc', '68'),
  ('25051', 'Xã Sơn Điền', '68'),
  ('25054', 'Xã Bảo Lâm 1', '68'),
  ('25057', 'Xã Bảo Lâm 5', '68'),
  ('25063', 'Xã Bảo Lâm 4', '68'),
  ('25084', 'Xã Bảo Lâm 2', '68'),
  ('25093', 'Xã Bảo Lâm 3', '68'),
  ('25099', 'Xã Đạ Huoai', '68'),
  ('25105', 'Xã Đạ Huoai 2', '68'),
  ('25114', 'Xã Đạ Huoai 3', '68'),
  ('25126', 'Xã Đạ Tẻh', '68'),
  ('25135', 'Xã Đạ Tẻh 3', '68'),
  ('25138', 'Xã Đạ Tẻh 2', '68'),
  ('25159', 'Xã Cát Tiên', '68'),
  ('25162', 'Xã Cát Tiên 3', '68'),
  ('25180', 'Xã Cát Tiên 2', '68'),
  ('25195', 'Phường Bình Phước', '75'),
  ('25210', 'Phường Đồng Xoài', '75'),
  ('25217', 'Phường Phước Long', '75'),
  ('25220', 'Phường Phước Bình', '75'),
  ('25222', 'Xã Bù Gia Mập', '75'),
  ('25225', 'Xã Đăk Ơ', '75'),
  ('25231', 'Xã Đa Kia', '75'),
  ('25246', 'Xã Bình Tân', '75'),
  ('25252', 'Xã Phú Riềng', '75'),
  ('25255', 'Xã Long Hà', '75'),
  ('25261', 'Xã Phú Trung', '75'),
  ('25267', 'Xã Phú Nghĩa', '75'),
  ('25270', 'Xã Lộc Ninh', '75'),
  ('25279', 'Xã Lộc Tấn', '75'),
  ('25280', 'Xã Lộc Thạnh', '75'),
  ('25292', 'Xã Lộc Quang', '75'),
  ('25294', 'Xã Lộc Thành', '75'),
  ('25303', 'Xã Lộc Hưng', '75'),
  ('25308', 'Xã Thiện Hưng', '75'),
  ('25309', 'Xã Hưng Phước', '75'),
  ('25318', 'Xã Tân Tiến', '75'),
  ('25326', 'Phường Bình Long', '75'),
  ('25333', 'Phường An Lộc', '75'),
  ('25345', 'Xã Tân Hưng', '75'),
  ('25349', 'Xã Minh Đức', '75'),
  ('25351', 'Xã Tân Quan', '75'),
  ('25357', 'Xã Tân Khai', '75'),
  ('25363', 'Xã Đồng Phú', '75'),
  ('25378', 'Xã Tân Lợi', '75'),
  ('25387', 'Xã Thuận Lợi', '75'),
  ('25390', 'Xã Đồng Tâm', '75'),
  ('25396', 'Xã Bù Đăng', '75'),
  ('25399', 'Xã Đak Nhau', '75');

insert into public.wards (code, name, province_code) values
  ('25402', 'Xã Thọ Sơn', '75'),
  ('25405', 'Xã Bom Bo', '75'),
  ('25417', 'Xã Nghĩa Trung', '75'),
  ('25420', 'Xã Phước Sơn', '75'),
  ('25432', 'Phường Chơn Thành', '75'),
  ('25441', 'Phường Minh Hưng', '75'),
  ('25450', 'Xã Nha Bích', '75'),
  ('25459', 'Phường Tân Ninh', '80'),
  ('25480', 'Phường Bình Minh', '80'),
  ('25486', 'Xã Tân Biên', '80'),
  ('25489', 'Xã Tân Lập', '80'),
  ('25498', 'Xã Thạnh Bình', '80'),
  ('25510', 'Xã Trà Vong', '80'),
  ('25516', 'Xã Tân Châu', '80'),
  ('25522', 'Xã Tân Đông', '80'),
  ('25525', 'Xã Tân Hội', '80'),
  ('25531', 'Xã Tân Hòa', '80'),
  ('25534', 'Xã Tân Thành', '80'),
  ('25549', 'Xã Tân Phú', '80'),
  ('25552', 'Xã Dương Minh Châu', '80'),
  ('25567', 'Phường Ninh Thạnh', '80'),
  ('25573', 'Xã Cầu Khởi', '80'),
  ('25579', 'Xã Lộc Ninh', '80'),
  ('25585', 'Xã Châu Thành', '80'),
  ('25588', 'Xã Hảo Đước', '80'),
  ('25591', 'Xã Phước Vinh', '80'),
  ('25606', 'Xã Hòa Hội', '80'),
  ('25621', 'Xã Ninh Điền', '80'),
  ('25630', 'Phường Long Hoa', '80'),
  ('25633', 'Phường Thanh Điền', '80'),
  ('25645', 'Phường Hòa Thành', '80'),
  ('25654', 'Phường Gò Dầu', '80'),
  ('25657', 'Xã Thạnh Đức', '80'),
  ('25663', 'Xã Phước Thạnh', '80'),
  ('25666', 'Xã Truông Mít', '80'),
  ('25672', 'Phường Gia Lộc', '80'),
  ('25681', 'Xã Bến Cầu', '80'),
  ('25684', 'Xã Long Chữ', '80'),
  ('25702', 'Xã Long Thuận', '80'),
  ('25708', 'Phường Trảng Bàng', '80'),
  ('25711', 'Xã Hưng Thuận', '80'),
  ('25729', 'Xã Phước Chỉ', '80'),
  ('25732', 'Phường An Tịnh', '80'),
  ('25747', 'Phường Thủ Dầu Một', '79'),
  ('25750', 'Phường Phú Lợi', '79'),
  ('25760', 'Phường Bình Dương', '79'),
  ('25768', 'Phường Phú An', '79'),
  ('25771', 'Phường Chánh Hiệp', '79'),
  ('25777', 'Xã Dầu Tiếng', '79'),
  ('25780', 'Xã Minh Thạnh', '79'),
  ('25792', 'Xã Long Hòa', '79'),
  ('25807', 'Xã Thanh An', '79'),
  ('25813', 'Phường Bến Cát', '79'),
  ('25819', 'Xã Trừ Văn Thố', '79'),
  ('25822', 'Xã Bàu Bàng', '79'),
  ('25837', 'Phường Chánh Phú Hòa', '79'),
  ('25840', 'Phường Long Nguyên', '79'),
  ('25843', 'Phường Tây Nam', '79'),
  ('25846', 'Phường Thới Hòa', '79'),
  ('25849', 'Phường Hòa Lợi', '79'),
  ('25858', 'Xã Phú Giáo', '79'),
  ('25864', 'Xã Phước Thành', '79'),
  ('25867', 'Xã An Long', '79'),
  ('25882', 'Xã Phước Hòa', '79'),
  ('25888', 'Phường Tân Uyên', '79'),
  ('25891', 'Phường Tân Khánh', '79'),
  ('25906', 'Xã Bắc Tân Uyên', '79'),
  ('25909', 'Xã Thường Tân', '79'),
  ('25912', 'Phường Vĩnh Tân', '79'),
  ('25915', 'Phường Bình Cơ', '79'),
  ('25920', 'Phường Tân Hiệp', '79'),
  ('25942', 'Phường Dĩ An', '79'),
  ('25945', 'Phường Tân Đông Hiệp', '79'),
  ('25951', 'Phường Đông Hòa', '79'),
  ('25966', 'Phường Lái Thiêu', '79'),
  ('25969', 'Phường Thuận Giao', '79'),
  ('25975', 'Phường An Phú', '79'),
  ('25978', 'Phường Thuận An', '79'),
  ('25987', 'Phường Bình Hòa', '79'),
  ('25993', 'Phường Trảng Dài', '75'),
  ('26005', 'Phường Hố Nai', '75'),
  ('26017', 'Phường Tam Hiệp', '75'),
  ('26020', 'Phường Long Bình', '75'),
  ('26041', 'Phường Trấn Biên', '75'),
  ('26068', 'Phường Biên Hòa', '75'),
  ('26080', 'Phường Long Khánh', '75'),
  ('26089', 'Phường Bình Lộc', '75'),
  ('26098', 'Phường Bảo Vinh', '75'),
  ('26104', 'Phường Xuân Lập', '75'),
  ('26113', 'Phường Hàng Gòn', '75'),
  ('26116', 'Xã Tân Phú', '75'),
  ('26119', 'Xã Đak Lua', '75'),
  ('26122', 'Xã Nam Cát Tiên', '75'),
  ('26134', 'Xã Tà Lài', '75'),
  ('26158', 'Xã Phú Lâm', '75'),
  ('26170', 'Xã Trị An', '75'),
  ('26173', 'Xã Phú Lý', '75'),
  ('26179', 'Xã Tân An', '75'),
  ('26188', 'Phường Tân Triều', '75'),
  ('26206', 'Xã Định Quán', '75'),
  ('26209', 'Xã Thanh Sơn', '75'),
  ('26215', 'Xã Phú Vinh', '75'),
  ('26221', 'Xã Phú Hòa', '75'),
  ('26227', 'Xã La Ngà', '75'),
  ('26248', 'Xã Trảng Bom', '75'),
  ('26254', 'Xã Bàu Hàm', '75'),
  ('26278', 'Xã Bình Minh', '75'),
  ('26281', 'Xã Hưng Thịnh', '75'),
  ('26296', 'Xã An Viễn', '75'),
  ('26299', 'Xã Thống Nhất', '75'),
  ('26311', 'Xã Gia Kiệm', '75'),
  ('26326', 'Xã Dầu Giây', '75'),
  ('26332', 'Xã Xuân Quế', '75'),
  ('26341', 'Xã Cẩm Mỹ', '75'),
  ('26347', 'Xã Xuân Đường', '75'),
  ('26359', 'Xã Xuân Đông', '75'),
  ('26362', 'Xã Sông Ray', '75'),
  ('26368', 'Xã Long Thành', '75'),
  ('26374', 'Phường Tam Phước', '75'),
  ('26377', 'Phường Phước Tân', '75'),
  ('26380', 'Phường Long Hưng', '75'),
  ('26383', 'Xã An Phước', '75'),
  ('26389', 'Xã Bình An', '75'),
  ('26413', 'Xã Long Phước', '75'),
  ('26422', 'Xã Phước Thái', '75'),
  ('26425', 'Xã Xuân Lộc', '75'),
  ('26428', 'Xã Xuân Bắc', '75'),
  ('26434', 'Xã Xuân Thành', '75'),
  ('26446', 'Xã Xuân Hòa', '75'),
  ('26458', 'Xã Xuân Phú', '75'),
  ('26461', 'Xã Xuân Định', '75'),
  ('26485', 'Xã Nhơn Trạch', '75'),
  ('26491', 'Xã Đại Phước', '75'),
  ('26503', 'Xã Phước An', '75'),
  ('26506', 'Phường Vũng Tàu', '79'),
  ('26526', 'Phường Tam Thắng', '79'),
  ('26536', 'Phường Rạch Dừa', '79'),
  ('26542', 'Phường Phước Thắng', '79'),
  ('26545', 'Xã Long Sơn', '79'),
  ('26560', 'Phường Bà Rịa', '79'),
  ('26566', 'Phường Long Hương', '79'),
  ('26572', 'Phường Tam Long', '79'),
  ('26575', 'Xã Ngãi Giao', '79'),
  ('26584', 'Xã Xuân Sơn', '79'),
  ('26590', 'Xã Bình Giã', '79'),
  ('26596', 'Xã Châu Đức', '79'),
  ('26608', 'Xã Kim Long', '79'),
  ('26617', 'Xã Nghĩa Thành', '79'),
  ('26620', 'Xã Hồ Tràm', '79'),
  ('26632', 'Xã Xuyên Mộc', '79'),
  ('26638', 'Xã Bàu Lâm', '79'),
  ('26641', 'Xã Hòa Hội', '79'),
  ('26647', 'Xã Hòa Hiệp', '79'),
  ('26656', 'Xã Bình Châu', '79'),
  ('26659', 'Xã Long Điền', '79'),
  ('26662', 'Xã Long Hải', '79'),
  ('26680', 'Xã Đất Đỏ', '79'),
  ('26686', 'Xã Phước Hải', '79'),
  ('26704', 'Phường Phú Mỹ', '79'),
  ('26710', 'Phường Tân Hải', '79'),
  ('26713', 'Phường Tân Phước', '79'),
  ('26725', 'Phường Tân Thành', '79'),
  ('26728', 'Xã Châu Pha', '79'),
  ('26732', 'Đặc khu Côn Đảo', '79'),
  ('26737', 'Phường Tân Định', '79'),
  ('26740', 'Phường Sài Gòn', '79'),
  ('26743', 'Phường Bến Thành', '79'),
  ('26758', 'Phường Cầu Ông Lãnh', '79'),
  ('26767', 'Phường An Phú Đông', '79'),
  ('26773', 'Phường Thới An', '79'),
  ('26782', 'Phường Tân Thới Hiệp', '79'),
  ('26785', 'Phường Trung Mỹ Tây', '79'),
  ('26791', 'Phường Đông Hưng Thuận', '79'),
  ('26800', 'Phường Linh Xuân', '79'),
  ('26803', 'Phường Tam Bình', '79'),
  ('26809', 'Phường Hiệp Bình', '79'),
  ('26824', 'Phường Thủ Đức', '79'),
  ('26833', 'Phường Long Bình', '79'),
  ('26842', 'Phường Tăng Nhơn Phú', '79'),
  ('26848', 'Phường Phước Long', '79'),
  ('26857', 'Phường Long Phước', '79'),
  ('26860', 'Phường Long Trường', '79'),
  ('26876', 'Phường An Nhơn', '79'),
  ('26878', 'Phường An Hội Đông', '79'),
  ('26882', 'Phường An Hội Tây', '79'),
  ('26884', 'Phường Gò Vấp', '79'),
  ('26890', 'Phường Hạnh Thông', '79'),
  ('26898', 'Phường Thông Tây Hội', '79'),
  ('26905', 'Phường Bình Lợi Trung', '79'),
  ('26911', 'Phường Bình Quới', '79'),
  ('26929', 'Phường Bình Thạnh', '79'),
  ('26944', 'Phường Gia Định', '79'),
  ('26956', 'Phường Thạnh Mỹ Tây', '79'),
  ('26968', 'Phường Tân Sơn Nhất', '79'),
  ('26977', 'Phường Tân Sơn Hòa', '79'),
  ('26983', 'Phường Bảy Hiền', '79'),
  ('26995', 'Phường Tân Hòa', '79'),
  ('27004', 'Phường Tân Bình', '79'),
  ('27007', 'Phường Tân Sơn', '79'),
  ('27013', 'Phường Tây Thạnh', '79'),
  ('27019', 'Phường Tân Sơn Nhì', '79'),
  ('27022', 'Phường Phú Thọ Hòa', '79'),
  ('27028', 'Phường Phú Thạnh', '79'),
  ('27031', 'Phường Tân Phú', '79'),
  ('27043', 'Phường Đức Nhuận', '79'),
  ('27058', 'Phường Cầu Kiệu', '79'),
  ('27073', 'Phường Phú Nhuận', '79'),
  ('27094', 'Phường An Khánh', '79'),
  ('27097', 'Phường Bình Trưng', '79'),
  ('27112', 'Phường Cát Lái', '79'),
  ('27139', 'Phường Xuân Hòa', '79'),
  ('27142', 'Phường Nhiêu Lộc', '79'),
  ('27154', 'Phường Bàn Cờ', '79'),
  ('27163', 'Phường Hòa Hưng', '79'),
  ('27169', 'Phường Diên Hồng', '79'),
  ('27190', 'Phường Vườn Lài', '79'),
  ('27211', 'Phường Hòa Bình', '79'),
  ('27226', 'Phường Phú Thọ', '79'),
  ('27232', 'Phường Bình Thới', '79'),
  ('27238', 'Phường Minh Phụng', '79'),
  ('27259', 'Phường Xóm Chiếu', '79'),
  ('27265', 'Phường Khánh Hội', '79'),
  ('27286', 'Phường Vĩnh Hội', '79'),
  ('27301', 'Phường Chợ Quán', '79'),
  ('27316', 'Phường An Đông', '79'),
  ('27343', 'Phường Chợ Lớn', '79'),
  ('27349', 'Phường Phú Lâm', '79'),
  ('27364', 'Phường Bình Phú', '79'),
  ('27367', 'Phường Bình Tây', '79'),
  ('27373', 'Phường Bình Tiên', '79'),
  ('27418', 'Phường Chánh Hưng', '79'),
  ('27424', 'Phường Bình Đông', '79'),
  ('27427', 'Phường Phú Định', '79'),
  ('27439', 'Phường Bình Hưng Hòa', '79'),
  ('27442', 'Phường Bình Tân', '79'),
  ('27448', 'Phường Bình Trị Đông', '79'),
  ('27457', 'Phường Tân Tạo', '79'),
  ('27460', 'Phường An Lạc', '79'),
  ('27475', 'Phường Tân Hưng', '79'),
  ('27478', 'Phường Tân Thuận', '79'),
  ('27484', 'Phường Phú Thuận', '79'),
  ('27487', 'Phường Tân Mỹ', '79'),
  ('27496', 'Xã Tân An Hội', '79'),
  ('27508', 'Xã An Nhơn Tây', '79'),
  ('27511', 'Xã Nhuận Đức', '79'),
  ('27526', 'Xã Thái Mỹ', '79'),
  ('27541', 'Xã Phú Hòa Đông', '79'),
  ('27544', 'Xã Bình Mỹ', '79'),
  ('27553', 'Xã Củ Chi', '79'),
  ('27559', 'Xã Hóc Môn', '79'),
  ('27568', 'Xã Đông Thạnh', '79'),
  ('27577', 'Xã Xuân Thới Sơn', '79'),
  ('27592', 'Xã Bà Điểm', '79'),
  ('27595', 'Xã Tân Nhựt', '79'),
  ('27601', 'Xã Vĩnh Lộc', '79'),
  ('27604', 'Xã Tân Vĩnh Lộc', '79'),
  ('27610', 'Xã Bình Lợi', '79'),
  ('27619', 'Xã Bình Hưng', '79'),
  ('27628', 'Xã Hưng Long', '79'),
  ('27637', 'Xã Bình Chánh', '79'),
  ('27655', 'Xã Nhà Bè', '79'),
  ('27658', 'Xã Hiệp Phước', '79'),
  ('27664', 'Xã Cần Giờ', '79'),
  ('27667', 'Xã Bình Khánh', '79'),
  ('27673', 'Xã An Thới Đông', '79'),
  ('27676', 'Xã Thạnh An', '79'),
  ('27694', 'Phường Long An', '80'),
  ('27712', 'Phường Tân An', '80'),
  ('27715', 'Phường Khánh Hậu', '80'),
  ('27721', 'Xã Tân Hưng', '80'),
  ('27727', 'Xã Hưng Điền', '80'),
  ('27736', 'Xã Vĩnh Thạnh', '80'),
  ('27748', 'Xã Vĩnh Châu', '80'),
  ('27757', 'Xã Vĩnh Hưng', '80'),
  ('27763', 'Xã Khánh Hưng', '80'),
  ('27775', 'Xã Tuyên Bình', '80'),
  ('27787', 'Phường Kiến Tường', '80'),
  ('27793', 'Xã Bình Hiệp', '80'),
  ('27811', 'Xã Bình Hòa', '80'),
  ('27817', 'Xã Tuyên Thạnh', '80'),
  ('27823', 'Xã Mộc Hóa', '80'),
  ('27826', 'Xã Tân Thạnh', '80'),
  ('27838', 'Xã Nhơn Hòa Lập', '80'),
  ('27841', 'Xã Hậu Thạnh', '80'),
  ('27856', 'Xã Nhơn Ninh', '80'),
  ('27865', 'Xã Thạnh Hóa', '80'),
  ('27868', 'Xã Bình Thành', '80'),
  ('27877', 'Xã Thạnh Phước', '80'),
  ('27889', 'Xã Tân Tây', '80'),
  ('27898', 'Xã Đông Thành', '80'),
  ('27907', 'Xã Mỹ Quý', '80'),
  ('27925', 'Xã Đức Huệ', '80'),
  ('27931', 'Xã Hậu Nghĩa', '80'),
  ('27937', 'Xã Đức Hòa', '80'),
  ('27943', 'Xã An Ninh', '80'),
  ('27952', 'Xã Hiệp Hòa', '80'),
  ('27964', 'Xã Đức Lập', '80'),
  ('27976', 'Xã Mỹ Hạnh', '80'),
  ('27979', 'Xã Hòa Khánh', '80'),
  ('27991', 'Xã Bến Lức', '80'),
  ('27994', 'Xã Thạnh Lợi', '80'),
  ('28003', 'Xã Lương Hòa', '80'),
  ('28015', 'Xã Bình Đức', '80'),
  ('28018', 'Xã Mỹ Yên', '80'),
  ('28036', 'Xã Thủ Thừa', '80'),
  ('28051', 'Xã Mỹ Thạnh', '80'),
  ('28066', 'Xã Mỹ An', '80'),
  ('28072', 'Xã Tân Long', '80'),
  ('28075', 'Xã Tân Trụ', '80'),
  ('28087', 'Xã Nhựt Tảo', '80'),
  ('28093', 'Xã Vàm Cỏ', '80'),
  ('28108', 'Xã Cần Đước', '80'),
  ('28114', 'Xã Rạch Kiến', '80'),
  ('28126', 'Xã Long Cang', '80'),
  ('28132', 'Xã Mỹ Lệ', '80'),
  ('28138', 'Xã Tân Lân', '80'),
  ('28144', 'Xã Long Hựu', '80'),
  ('28159', 'Xã Cần Giuộc', '80'),
  ('28165', 'Xã Phước Lý', '80'),
  ('28177', 'Xã Mỹ Lộc', '80'),
  ('28201', 'Xã Phước Vĩnh Tây', '80'),
  ('28207', 'Xã Tân Tập', '80'),
  ('28210', 'Xã Tầm Vu', '80'),
  ('28222', 'Xã Vĩnh Công', '80'),
  ('28225', 'Xã Thuận Mỹ', '80'),
  ('28243', 'Xã An Lục Long', '80'),
  ('28249', 'Phường Đạo Thạnh', '82'),
  ('28261', 'Phường Mỹ Tho', '82'),
  ('28270', 'Phường Thới Sơn', '82'),
  ('28273', 'Phường Mỹ Phong', '82'),
  ('28285', 'Phường Trung An', '82'),
  ('28297', 'Phường Long Thuận', '82'),
  ('28306', 'Phường Gò Công', '82'),
  ('28315', 'Phường Bình Xuân', '82'),
  ('28321', 'Xã Tân Phước 1', '82'),
  ('28327', 'Xã Tân Phước 2', '82'),
  ('28336', 'Xã Hưng Thạnh', '82'),
  ('28345', 'Xã Tân Phước 3', '82'),
  ('28360', 'Xã Cái Bè', '82'),
  ('28366', 'Xã Hậu Mỹ', '82'),
  ('28378', 'Xã Mỹ Thiện', '82'),
  ('28393', 'Xã Hội Cư', '82'),
  ('28405', 'Xã Mỹ Đức Tây', '82'),
  ('28414', 'Xã Mỹ Lợi', '82'),
  ('28426', 'Xã Thanh Hưng', '82'),
  ('28429', 'Xã An Hữu', '82'),
  ('28435', 'Phường Mỹ Phước Tây', '82'),
  ('28436', 'Phường Thanh Hòa', '82'),
  ('28439', 'Phường Cai Lậy', '82'),
  ('28444', 'Xã Thạnh Phú', '82'),
  ('28456', 'Xã Mỹ Thành', '82'),
  ('28468', 'Xã Tân Phú', '82'),
  ('28471', 'Xã Bình Phú', '82'),
  ('28477', 'Phường Nhị Quý', '82'),
  ('28501', 'Xã Hiệp Đức', '82'),
  ('28504', 'Xã Long Tiên', '82'),
  ('28516', 'Xã Ngũ Hiệp', '82'),
  ('28519', 'Xã Châu Thành', '82'),
  ('28525', 'Xã Tân Hương', '82'),
  ('28537', 'Xã Long Hưng', '82'),
  ('28543', 'Xã Long Định', '82'),
  ('28564', 'Xã Bình Trưng', '82'),
  ('28576', 'Xã Vĩnh Kim', '82'),
  ('28582', 'Xã Kim Sơn', '82'),
  ('28594', 'Xã Chợ Gạo', '82'),
  ('28603', 'Xã Mỹ Tịnh An', '82'),
  ('28615', 'Xã Lương Hòa Lạc', '82'),
  ('28627', 'Xã Tân Thuận Bình', '82'),
  ('28633', 'Xã An Thạnh Thủy', '82'),
  ('28648', 'Xã Bình Ninh', '82'),
  ('28651', 'Xã Vĩnh Bình', '82'),
  ('28660', 'Xã Đồng Sơn', '82'),
  ('28663', 'Xã Phú Thành', '82'),
  ('28678', 'Xã Vĩnh Hựu', '82'),
  ('28687', 'Xã Long Bình', '82'),
  ('28693', 'Xã Tân Thới', '82'),
  ('28696', 'Xã Tân Phú Đông', '82'),
  ('28702', 'Xã Tân Hòa', '82'),
  ('28720', 'Xã Gia Thuận', '82'),
  ('28723', 'Xã Tân Đông', '82'),
  ('28729', 'Phường Sơn Qui', '82'),
  ('28738', 'Xã Tân Điền', '82'),
  ('28747', 'Xã Gò Công Đông', '82'),
  ('28756', 'Phường Phú Khương', '86'),
  ('28777', 'Phường An Hội', '86'),
  ('28783', 'Phường Sơn Đông', '86'),
  ('28789', 'Phường Bến Tre', '86'),
  ('28807', 'Xã Giao Long', '86'),
  ('28810', 'Xã Phú Túc', '86'),
  ('28840', 'Xã Tân Phú', '86'),
  ('28858', 'Phường Phú Tân', '86'),
  ('28861', 'Xã Tiên Thủy', '86'),
  ('28870', 'Xã Chợ Lách', '86'),
  ('28879', 'Xã Phú Phụng', '86'),
  ('28894', 'Xã Vĩnh Thành', '86'),
  ('28901', 'Xã Hưng Khánh Trung', '86'),
  ('28903', 'Xã Mỏ Cày', '86'),
  ('28915', 'Xã Phước Mỹ Trung', '86'),
  ('28921', 'Xã Tân Thành Bình', '86'),
  ('28945', 'Xã Đồng Khởi', '86'),
  ('28948', 'Xã Nhuận Phú Tân', '86'),
  ('28957', 'Xã An Định', '86'),
  ('28969', 'Xã Thành Thới', '86'),
  ('28981', 'Xã Hương Mỹ', '86'),
  ('28984', 'Xã Giồng Trôm', '86'),
  ('28987', 'Xã Lương Hòa', '86'),
  ('28993', 'Xã Lương Phú', '86'),
  ('28996', 'Xã Châu Hòa', '86'),
  ('29020', 'Xã Phước Long', '86'),
  ('29029', 'Xã Tân Hào', '86'),
  ('29044', 'Xã Hưng Nhượng', '86'),
  ('29050', 'Xã Bình Đại', '86'),
  ('29062', 'Xã Phú Thuận', '86'),
  ('29077', 'Xã Lộc Thuận', '86'),
  ('29083', 'Xã Châu Hưng', '86'),
  ('29089', 'Xã Thạnh Trị', '86'),
  ('29104', 'Xã Thạnh Phước', '86'),
  ('29107', 'Xã Thới Thuận', '86'),
  ('29110', 'Xã Ba Tri', '86'),
  ('29122', 'Xã Mỹ Chánh Hòa', '86'),
  ('29125', 'Xã Bảo Thạnh', '86'),
  ('29137', 'Xã Tân Xuân', '86'),
  ('29143', 'Xã An Ngãi Trung', '86'),
  ('29158', 'Xã An Hiệp', '86'),
  ('29167', 'Xã Tân Thủy', '86'),
  ('29182', 'Xã Thạnh Phú', '86'),
  ('29191', 'Xã Quới Điền', '86'),
  ('29194', 'Xã Đại Điền', '86'),
  ('29221', 'Xã Thạnh Hải', '86'),
  ('29224', 'Xã An Qui', '86'),
  ('29227', 'Xã Thạnh Phong', '86'),
  ('29242', 'Phường Trà Vinh', '86'),
  ('29254', 'Phường Nguyệt Hóa', '86'),
  ('29263', 'Phường Long Đức', '86'),
  ('29266', 'Xã Càng Long', '86'),
  ('29275', 'Xã An Trường', '86'),
  ('29278', 'Xã Tân An', '86'),
  ('29287', 'Xã Bình Phú', '86'),
  ('29302', 'Xã Nhị Long', '86'),
  ('29308', 'Xã Cầu Kè', '86'),
  ('29317', 'Xã An Phú Tân', '86'),
  ('29329', 'Xã Phong Thạnh', '86'),
  ('29335', 'Xã Tam Ngãi', '86'),
  ('29341', 'Xã Tiểu Cần', '86'),
  ('29362', 'Xã Hùng Hòa', '86'),
  ('29365', 'Xã Tập Ngãi', '86'),
  ('29371', 'Xã Tân Hòa', '86'),
  ('29374', 'Xã Châu Thành', '86'),
  ('29386', 'Xã Song Lộc', '86'),
  ('29398', 'Phường Hòa Thuận', '86'),
  ('29407', 'Xã Hưng Mỹ', '86'),
  ('29410', 'Xã Hòa Minh', '86'),
  ('29413', 'Xã Long Hòa', '86'),
  ('29416', 'Xã Cầu Ngang', '86'),
  ('29419', 'Xã Mỹ Long', '86'),
  ('29431', 'Xã Vinh Kim', '86'),
  ('29446', 'Xã Nhị Trường', '86'),
  ('29455', 'Xã Hiệp Mỹ', '86'),
  ('29461', 'Xã Trà Cú', '86'),
  ('29467', 'Xã Tập Sơn', '86'),
  ('29476', 'Xã Lưu Nghiệp Anh', '86'),
  ('29489', 'Xã Hàm Giang', '86'),
  ('29491', 'Xã Đại An', '86'),
  ('29497', 'Xã Đôn Châu', '86'),
  ('29506', 'Xã Long Hiệp', '86'),
  ('29512', 'Phường Duyên Hải', '86'),
  ('29513', 'Xã Long Thành', '86'),
  ('29516', 'Phường Trường Long Hòa', '86'),
  ('29518', 'Xã Long Hữu', '86'),
  ('29530', 'Xã Ngũ Lạc', '86'),
  ('29533', 'Xã Long Vĩnh', '86'),
  ('29536', 'Xã Đông Hải', '86'),
  ('29551', 'Phường Long Châu', '86'),
  ('29557', 'Phường Phước Hậu', '86'),
  ('29566', 'Phường Tân Ngãi', '86'),
  ('29584', 'Xã An Bình', '86'),
  ('29590', 'Phường Thanh Đức', '86'),
  ('29593', 'Phường Tân Hạnh', '86'),
  ('29602', 'Xã Long Hồ', '86'),
  ('29611', 'Xã Phú Quới', '86'),
  ('29623', 'Xã Nhơn Phú', '86'),
  ('29638', 'Xã Bình Phước', '86'),
  ('29641', 'Xã Cái Nhum', '86'),
  ('29653', 'Xã Tân Long Hội', '86'),
  ('29659', 'Xã Trung Thành', '86'),
  ('29668', 'Xã Quới An', '86'),
  ('29677', 'Xã Quới Thiện', '86'),
  ('29683', 'Xã Trung Hiệp', '86'),
  ('29698', 'Xã Trung Ngãi', '86'),
  ('29701', 'Xã Hiếu Phụng', '86'),
  ('29713', 'Xã Hiếu Thành', '86'),
  ('29719', 'Xã Tam Bình', '86'),
  ('29728', 'Xã Cái Ngang', '86'),
  ('29734', 'Xã Hòa Hiệp', '86'),
  ('29740', 'Xã Song Phú', '86'),
  ('29767', 'Xã Ngãi Tứ', '86'),
  ('29770', 'Phường Cái Vồn', '86'),
  ('29771', 'Phường Bình Minh', '86'),
  ('29785', 'Xã Tân Lược', '86'),
  ('29788', 'Xã Mỹ Thuận', '86');

insert into public.wards (code, name, province_code) values
  ('29800', 'Xã Tân Quới', '86'),
  ('29812', 'Phường Đông Thành', '86'),
  ('29821', 'Xã Trà Ôn', '86'),
  ('29830', 'Xã Hòa Bình', '86'),
  ('29836', 'Xã Trà Côn', '86'),
  ('29845', 'Xã Vĩnh Xuân', '86'),
  ('29857', 'Xã Lục Sĩ Thành', '86'),
  ('29869', 'Phường Cao Lãnh', '82'),
  ('29884', 'Phường Mỹ Ngãi', '82'),
  ('29888', 'Phường Mỹ Trà', '82'),
  ('29905', 'Phường Sa Đéc', '82'),
  ('29926', 'Xã Tân Hồng', '82'),
  ('29929', 'Xã Tân Hộ Cơ', '82'),
  ('29938', 'Xã Tân Thành', '82'),
  ('29944', 'Xã An Phước', '82'),
  ('29954', 'Phường An Bình', '82'),
  ('29955', 'Phường Hồng Ngự', '82'),
  ('29971', 'Xã Thường Phước', '82'),
  ('29978', 'Phường Thường Lạc', '82'),
  ('29983', 'Xã Long Khánh', '82'),
  ('29992', 'Xã Long Phú Thuận', '82'),
  ('30001', 'Xã Tràm Chim', '82'),
  ('30010', 'Xã Tam Nông', '82'),
  ('30019', 'Xã An Hòa', '82'),
  ('30025', 'Xã Phú Cường', '82'),
  ('30028', 'Xã An Long', '82'),
  ('30034', 'Xã Phú Thọ', '82'),
  ('30037', 'Xã Tháp Mười', '82'),
  ('30043', 'Xã Phương Thịnh', '82'),
  ('30046', 'Xã Trường Xuân', '82'),
  ('30055', 'Xã Mỹ Quí', '82'),
  ('30061', 'Xã Đốc Binh Kiều', '82'),
  ('30073', 'Xã Thanh Mỹ', '82'),
  ('30076', 'Xã Mỹ Thọ', '82'),
  ('30085', 'Xã Ba Sao', '82'),
  ('30088', 'Xã Phong Mỹ', '82'),
  ('30112', 'Xã Mỹ Hiệp', '82'),
  ('30118', 'Xã Bình Hàng Trung', '82'),
  ('30130', 'Xã Thanh Bình', '82'),
  ('30154', 'Xã Tân Long', '82'),
  ('30157', 'Xã Tân Thạnh', '82'),
  ('30163', 'Xã Bình Thành', '82'),
  ('30169', 'Xã Lấp Vò', '82'),
  ('30178', 'Xã Mỹ An Hưng', '82'),
  ('30184', 'Xã Tân Khánh Trung', '82'),
  ('30208', 'Xã Hòa Long', '82'),
  ('30214', 'Xã Tân Dương', '82'),
  ('30226', 'Xã Lai Vung', '82'),
  ('30235', 'Xã Phong Hòa', '82'),
  ('30244', 'Xã Phú Hựu', '82'),
  ('30253', 'Xã Tân Nhuận Đông', '82'),
  ('30259', 'Xã Tân Phú Trung', '82'),
  ('30292', 'Phường Bình Đức', '91'),
  ('30301', 'Phường Mỹ Thới', '91'),
  ('30307', 'Phường Long Xuyên', '91'),
  ('30313', 'Xã Mỹ Hòa Hưng', '91'),
  ('30316', 'Phường Châu Đốc', '91'),
  ('30325', 'Phường Vĩnh Tế', '91'),
  ('30337', 'Xã An Phú', '91'),
  ('30341', 'Xã Khánh Bình', '91'),
  ('30346', 'Xã Nhơn Hội', '91'),
  ('30352', 'Xã Phú Hữu', '91'),
  ('30367', 'Xã Vĩnh Hậu', '91'),
  ('30376', 'Phường Tân Châu', '91'),
  ('30377', 'Phường Long Phú', '91'),
  ('30385', 'Xã Vĩnh Xương', '91'),
  ('30388', 'Xã Tân An', '91'),
  ('30403', 'Xã Châu Phong', '91'),
  ('30406', 'Xã Phú Tân', '91'),
  ('30409', 'Xã Chợ Vàm', '91'),
  ('30421', 'Xã Phú Lâm', '91'),
  ('30430', 'Xã Hòa Lạc', '91'),
  ('30436', 'Xã Phú An', '91'),
  ('30445', 'Xã Bình Thạnh Đông', '91'),
  ('30463', 'Xã Châu Phú', '91'),
  ('30469', 'Xã Mỹ Đức', '91'),
  ('30478', 'Xã Vĩnh Thạnh Trung', '91'),
  ('30481', 'Xã Thạnh Mỹ Tây', '91'),
  ('30487', 'Xã Bình Mỹ', '91'),
  ('30502', 'Phường Thới Sơn', '91'),
  ('30505', 'Phường Chi Lăng', '91'),
  ('30520', 'Phường Tịnh Biên', '91'),
  ('30526', 'Xã An Cư', '91'),
  ('30538', 'Xã Núi Cấm', '91'),
  ('30544', 'Xã Tri Tôn', '91'),
  ('30547', 'Xã Ba Chúc', '91'),
  ('30568', 'Xã Vĩnh Gia', '91'),
  ('30577', 'Xã Ô Lâm', '91'),
  ('30580', 'Xã Cô Tô', '91'),
  ('30589', 'Xã An Châu', '91'),
  ('30595', 'Xã Cần Đăng', '91'),
  ('30604', 'Xã Vĩnh An', '91'),
  ('30607', 'Xã Bình Hòa', '91'),
  ('30619', 'Xã Vĩnh Hanh', '91'),
  ('30628', 'Xã Chợ Mới', '91'),
  ('30631', 'Xã Long Điền', '91'),
  ('30643', 'Xã Cù Lao Giêng', '91'),
  ('30658', 'Xã Nhơn Mỹ', '91'),
  ('30664', 'Xã Long Kiến', '91'),
  ('30673', 'Xã Hội An', '91'),
  ('30682', 'Xã Thoại Sơn', '91'),
  ('30685', 'Xã Phú Hòa', '91'),
  ('30688', 'Xã Óc Eo', '91'),
  ('30691', 'Xã Tây Phú', '91'),
  ('30697', 'Xã Vĩnh Trạch', '91'),
  ('30709', 'Xã Định Mỹ', '91'),
  ('30742', 'Phường Rạch Giá', '91'),
  ('30760', 'Phường Vĩnh Thông', '91'),
  ('30766', 'Phường Tô Châu', '91'),
  ('30769', 'Phường Hà Tiên', '91'),
  ('30781', 'Xã Tiên Hải', '91'),
  ('30787', 'Xã Kiên Lương', '91'),
  ('30790', 'Xã Hòa Điền', '91'),
  ('30793', 'Xã Vĩnh Điều', '91'),
  ('30796', 'Xã Giang Thành', '91'),
  ('30811', 'Xã Sơn Hải', '91'),
  ('30814', 'Xã Hòn Nghệ', '91'),
  ('30817', 'Xã Hòn Đất', '91'),
  ('30823', 'Xã Bình Sơn', '91'),
  ('30826', 'Xã Bình Giang', '91'),
  ('30835', 'Xã Sơn Kiên', '91'),
  ('30838', 'Xã Mỹ Thuận', '91'),
  ('30850', 'Xã Tân Hiệp', '91'),
  ('30856', 'Xã Tân Hội', '91'),
  ('30874', 'Xã Thạnh Đông', '91'),
  ('30880', 'Xã Châu Thành', '91'),
  ('30886', 'Xã Thạnh Lộc', '91'),
  ('30898', 'Xã Bình An', '91'),
  ('30904', 'Xã Giồng Riềng', '91'),
  ('30910', 'Xã Thạnh Hưng', '91'),
  ('30928', 'Xã Ngọc Chúc', '91'),
  ('30934', 'Xã Hòa Hưng', '91'),
  ('30943', 'Xã Long Thạnh', '91'),
  ('30949', 'Xã Hòa Thuận', '91'),
  ('30952', 'Xã Gò Quao', '91'),
  ('30958', 'Xã Định Hòa', '91'),
  ('30970', 'Xã Vĩnh Hòa Hưng', '91'),
  ('30982', 'Xã Vĩnh Tuy', '91'),
  ('30985', 'Xã An Biên', '91'),
  ('30988', 'Xã Tây Yên', '91'),
  ('31006', 'Xã Đông Thái', '91'),
  ('31012', 'Xã Vĩnh Hòa', '91'),
  ('31018', 'Xã An Minh', '91'),
  ('31024', 'Xã Đông Hòa', '91'),
  ('31027', 'Xã U Minh Thượng', '91'),
  ('31031', 'Xã Tân Thạnh', '91'),
  ('31036', 'Xã Đông Hưng', '91'),
  ('31042', 'Xã Vân Khánh', '91'),
  ('31051', 'Xã Vĩnh Phong', '91'),
  ('31064', 'Xã Vĩnh Bình', '91'),
  ('31069', 'Xã Vĩnh Thuận', '91'),
  ('31078', 'Đặc khu Phú Quốc', '91'),
  ('31105', 'Đặc khu Thổ Châu', '91'),
  ('31108', 'Đặc khu Kiên Hải', '91'),
  ('31120', 'Phường Cái Khế', '92'),
  ('31135', 'Phường Ninh Kiều', '92'),
  ('31147', 'Phường Tân An', '92'),
  ('31150', 'Phường An Bình', '92'),
  ('31153', 'Phường Ô Môn', '92'),
  ('31157', 'Phường Thới Long', '92'),
  ('31162', 'Phường Phước Thới', '92'),
  ('31168', 'Phường Bình Thủy', '92'),
  ('31174', 'Phường Thới An Đông', '92'),
  ('31183', 'Phường Long Tuyền', '92'),
  ('31186', 'Phường Cái Răng', '92'),
  ('31201', 'Phường Hưng Phú', '92'),
  ('31207', 'Phường Thốt Nốt', '92'),
  ('31213', 'Phường Tân Lộc', '92'),
  ('31217', 'Phường Trung Nhứt', '92'),
  ('31228', 'Phường Thuận Hưng', '92'),
  ('31231', 'Xã Thạnh An', '92'),
  ('31232', 'Xã Vĩnh Thạnh', '92'),
  ('31237', 'Xã Vĩnh Trinh', '92'),
  ('31246', 'Xã Thạnh Quới', '92'),
  ('31249', 'Xã Thạnh Phú', '92'),
  ('31255', 'Xã Trung Hưng', '92'),
  ('31258', 'Xã Thới Lai', '92'),
  ('31261', 'Xã Cờ Đỏ', '92'),
  ('31264', 'Xã Thới Hưng', '92'),
  ('31273', 'Xã Đông Hiệp', '92'),
  ('31282', 'Xã Đông Thuận', '92'),
  ('31288', 'Xã Trường Thành', '92'),
  ('31294', 'Xã Trường Xuân', '92'),
  ('31299', 'Xã Phong Điền', '92'),
  ('31309', 'Xã Trường Long', '92'),
  ('31315', 'Xã Nhơn Ái', '92'),
  ('31321', 'Phường Vị Thanh', '92'),
  ('31333', 'Phường Vị Tân', '92'),
  ('31338', 'Xã Hỏa Lựu', '92'),
  ('31340', 'Phường Ngã Bảy', '92'),
  ('31342', 'Xã Tân Hòa', '92'),
  ('31348', 'Xã Trường Long Tây', '92'),
  ('31360', 'Xã Thạnh Xuân', '92'),
  ('31366', 'Xã Châu Thành', '92'),
  ('31369', 'Xã Đông Phước', '92'),
  ('31378', 'Xã Phú Hữu', '92'),
  ('31393', 'Xã Hòa An', '92'),
  ('31396', 'Xã Hiệp Hưng', '92'),
  ('31399', 'Xã Tân Bình', '92'),
  ('31408', 'Xã Thạnh Hòa', '92'),
  ('31411', 'Phường Đại Thành', '92'),
  ('31420', 'Xã Phụng Hiệp', '92'),
  ('31426', 'Xã Phương Bình', '92'),
  ('31432', 'Xã Tân Phước Hưng', '92'),
  ('31441', 'Xã Vị Thủy', '92'),
  ('31453', 'Xã Vĩnh Thuận Đông', '92'),
  ('31459', 'Xã Vĩnh Tường', '92'),
  ('31465', 'Xã Vị Thanh 1', '92'),
  ('31471', 'Phường Long Mỹ', '92'),
  ('31473', 'Phường Long Bình', '92'),
  ('31480', 'Phường Long Phú 1', '92'),
  ('31489', 'Xã Vĩnh Viễn', '92'),
  ('31492', 'Xã Lương Tâm', '92'),
  ('31495', 'Xã Xà Phiên', '92'),
  ('31507', 'Phường Sóc Trăng', '92'),
  ('31510', 'Phường Phú Lợi', '92'),
  ('31528', 'Xã Kế Sách', '92'),
  ('31531', 'Xã An Lạc Thôn', '92'),
  ('31537', 'Xã Phong Nẫm', '92'),
  ('31540', 'Xã Thới An Hội', '92'),
  ('31552', 'Xã Nhơn Mỹ', '92'),
  ('31561', 'Xã Đại Hải', '92'),
  ('31567', 'Xã Mỹ Tú', '92'),
  ('31569', 'Xã Phú Tâm', '92'),
  ('31570', 'Xã Hồ Đắc Kiện', '92'),
  ('31579', 'Xã Long Hưng', '92'),
  ('31582', 'Xã Thuận Hòa', '92'),
  ('31591', 'Xã Mỹ Hương', '92'),
  ('31594', 'Xã An Ninh', '92'),
  ('31603', 'Xã Mỹ Phước', '92'),
  ('31615', 'Xã An Thạnh', '92'),
  ('31633', 'Xã Cù Lao Dung', '92'),
  ('31639', 'Xã Long Phú', '92'),
  ('31645', 'Xã Đại Ngãi', '92'),
  ('31654', 'Xã Trường Khánh', '92'),
  ('31666', 'Xã Tân Thạnh', '92'),
  ('31673', 'Xã Trần Đề', '92'),
  ('31675', 'Xã Liêu Tú', '92'),
  ('31679', 'Xã Lịch Hội Thượng', '92'),
  ('31684', 'Phường Mỹ Xuyên', '92'),
  ('31687', 'Xã Tài Văn', '92'),
  ('31699', 'Xã Thạnh Thới An', '92'),
  ('31708', 'Xã Nhu Gia', '92'),
  ('31717', 'Xã Hòa Tú', '92'),
  ('31723', 'Xã Ngọc Tố', '92'),
  ('31726', 'Xã Gia Hòa', '92'),
  ('31732', 'Phường Ngã Năm', '92'),
  ('31741', 'Xã Tân Long', '92'),
  ('31753', 'Phường Mỹ Quới', '92'),
  ('31756', 'Xã Phú Lộc', '92'),
  ('31759', 'Xã Lâm Tân', '92'),
  ('31777', 'Xã Vĩnh Lợi', '92'),
  ('31783', 'Phường Vĩnh Châu', '92'),
  ('31789', 'Phường Khánh Hòa', '92'),
  ('31795', 'Xã Vĩnh Hải', '92'),
  ('31804', 'Phường Vĩnh Phước', '92'),
  ('31810', 'Xã Lai Hòa', '92'),
  ('31825', 'Phường Bạc Liêu', '96'),
  ('31834', 'Phường Vĩnh Trạch', '96'),
  ('31840', 'Phường Hiệp Thành', '96'),
  ('31843', 'Xã Hồng Dân', '96'),
  ('31849', 'Xã Ninh Quới', '96'),
  ('31858', 'Xã Vĩnh Lộc', '96'),
  ('31864', 'Xã Ninh Thạnh Lợi', '96'),
  ('31867', 'Xã Phước Long', '96'),
  ('31876', 'Xã Vĩnh Phước', '96'),
  ('31882', 'Xã Vĩnh Thanh', '96'),
  ('31885', 'Xã Phong Hiệp', '96'),
  ('31891', 'Xã Hòa Bình', '96'),
  ('31894', 'Xã Châu Thới', '96'),
  ('31900', 'Xã Vĩnh Lợi', '96'),
  ('31906', 'Xã Hưng Hội', '96'),
  ('31918', 'Xã Vĩnh Mỹ', '96'),
  ('31927', 'Xã Vĩnh Hậu', '96'),
  ('31942', 'Phường Giá Rai', '96'),
  ('31951', 'Phường Láng Tròn', '96'),
  ('31957', 'Xã Phong Thạnh', '96'),
  ('31972', 'Xã Gành Hào', '96'),
  ('31975', 'Xã Đông Hải', '96'),
  ('31985', 'Xã Long Điền', '96'),
  ('31988', 'Xã An Trạch', '96'),
  ('31993', 'Xã Định Thành', '96'),
  ('32002', 'Phường An Xuyên', '96'),
  ('32014', 'Phường Lý Văn Lâm', '96'),
  ('32025', 'Phường Tân Thành', '96'),
  ('32041', 'Phường Hòa Thành', '96'),
  ('32044', 'Xã Nguyễn Phích', '96'),
  ('32047', 'Xã U Minh', '96'),
  ('32059', 'Xã Khánh An', '96'),
  ('32062', 'Xã Khánh Lâm', '96'),
  ('32065', 'Xã Thới Bình', '96'),
  ('32069', 'Xã Biển Bạch', '96'),
  ('32071', 'Xã Trí Phải', '96'),
  ('32083', 'Xã Tân Lộc', '96'),
  ('32092', 'Xã Hồ Thị Kỷ', '96'),
  ('32095', 'Xã Trần Văn Thời', '96'),
  ('32098', 'Xã Sông Đốc', '96'),
  ('32104', 'Xã Đá Bạc', '96'),
  ('32110', 'Xã Khánh Bình', '96'),
  ('32119', 'Xã Khánh Hưng', '96'),
  ('32128', 'Xã Cái Nước', '96'),
  ('32134', 'Xã Lương Thế Trân', '96'),
  ('32137', 'Xã Tân Hưng', '96'),
  ('32140', 'Xã Hưng Mỹ', '96'),
  ('32152', 'Xã Đầm Dơi', '96'),
  ('32155', 'Xã Tạ An Khương', '96'),
  ('32161', 'Xã Trần Phán', '96'),
  ('32167', 'Xã Tân Thuận', '96'),
  ('32182', 'Xã Quách Phẩm', '96'),
  ('32185', 'Xã Thanh Tùng', '96'),
  ('32188', 'Xã Tân Tiến', '96'),
  ('32191', 'Xã Năm Căn', '96'),
  ('32201', 'Xã Đất Mới', '96'),
  ('32206', 'Xã Tam Giang', '96'),
  ('32212', 'Xã Cái Đôi Vàm', '96'),
  ('32214', 'Xã Phú Mỹ', '96'),
  ('32218', 'Xã Phú Tân', '96'),
  ('32227', 'Xã Nguyễn Việt Khái', '96'),
  ('32236', 'Xã Tân Ân', '96'),
  ('32244', 'Xã Phan Ngọc Hiển', '96'),
  ('32248', 'Xã Đất Mũi', '96');

insert into app_meta.migrations (version, name, checksum) values ('20261122000310', 'admin_units', '8b68ab19fa09d578bde53988b7571d7a2b3419ecfe037fe66ee514ddaa4be196');

-- ===== 20261123000100_m2_swipe_match_chat.sql =====
-- Exchangethings.vn, M2: quẹt, khớp, chat.
-- Các bảng swipes, matches, messages, blocks, notifications có từ M1 nhưng chưa có chính sách nên ai cũng bị từ chối.
-- Migration này thêm chỉ mục, bảng match_reads, chính sách RLS và các hàm nghiệp vụ.
-- Không ai ghi thẳng swipes, matches, messages: mọi thao tác đi qua swipe_item, send_message, mark_match_read,
-- nên giới hạn tần suất, luật khớp và việc che thông tin liên lạc không thể bị bỏ qua từ phía trình duyệt.

-- ---------------------------------------------------------------------------
-- 1. Chỉ mục và bảng phụ
-- ---------------------------------------------------------------------------
create index swipes_item_like_idx on public.swipes (item_id) where direction = 'like';
create index swipes_viewer_time_idx on public.swipes (viewer_id, created_at);
create index matches_user_b_idx on public.matches (user_b);
create index messages_match_time_idx on public.messages (match_id, created_at, id);
create index messages_sender_time_idx on public.messages (sender_id, created_at);
create index blocks_blocked_idx on public.blocks (blocked_id);

-- Mỗi món chỉ muốn một món cụ thể một lần.
create unique index item_wants_item_once_idx on public.item_wants (item_id, wanted_item_id) where wanted_item_id is not null;

-- Lần cuối mỗi người đọc một cuộc trò chuyện: tính số tin chưa đọc và nhãn "mới khớp".
create table public.match_reads (
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (match_id, user_id)
);
alter table public.match_reads enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Quyền mức bảng. Supabase cấp sẵn ALL cho bảng mới, nên bảng mới phải thu hồi trước.
-- ---------------------------------------------------------------------------
revoke all on public.match_reads from anon, authenticated;
grant select on public.match_reads to authenticated;
-- Khách chỉ cần đọc dữ liệu tham chiếu, hồ sơ công khai và món đang hiển thị. Các bảng còn lại thu hồi luôn quyền
-- SELECT của khách (trước đây chỉ dựa vào RLS không có chính sách), để lỡ thêm nhầm chính sách cũng không lộ.
revoke select on public.banned_keywords, public.profile_private, public.item_private, public.item_reviews,
  public.swipes, public.matches, public.messages, public.blocks, public.notifications,
  public.offers, public.offer_versions, public.offer_items, public.transactions, public.transaction_events,
  public.escrow_payments, public.shipments, public.vault_entries, public.vault_access_logs,
  public.reports, public.disputes from anon;
grant insert (blocker_id, blocked_id), delete on public.blocks to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Hàm dùng chung
-- ---------------------------------------------------------------------------
-- Tôi và người kia có chặn nhau không (chiều nào cũng tính). Chỉ hỏi được về chính mình, không dò được cặp khác.
create or replace function public.is_blocked_with(p_other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.blocks b
     where (b.blocker_id = auth.uid() and b.blocked_id = p_other)
        or (b.blocker_id = p_other and b.blocked_id = auth.uid()));
$$;

-- Giới hạn tần suất đọc từ platform_settings.rate_limits (SPEC mục 12); thiếu hoặc sai kiểu thì dùng mặc định.
create or replace function public.rate_limit(p_key text, p_default integer) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((
    select greatest(0, floor((s.value ->> p_key)::numeric))::integer
      from public.platform_settings s
     where s.key = 'rate_limits' and jsonb_typeof(s.value -> p_key) = 'number'), p_default);
$$;

-- Hai người đã có giao dịch được khóa (locked trở đi) thì được trao đổi liên lạc trong chat (SPEC mục 10, 12).
-- Giao dịch có từ M4; trước đó hàm luôn trả false.
create or replace function public.contacts_unlocked(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.transactions t
      join public.offer_versions v on v.id = t.offer_version_id
      join public.offers o on o.id = v.offer_id
     where ((o.from_user = p_a and o.to_user = p_b) or (o.from_user = p_b and o.to_user = p_a))
       and t.status in ('locked', 'in_progress', 'delivered', 'completed', 'disputed', 'resolved_refund', 'resolved_release'));
$$;

-- Che thông tin liên lạc trong tin nhắn: email, liên kết, số điện thoại Việt Nam, dãy số dài (số tài khoản, số thẻ).
-- Soi trên bản đã chuẩn hóa (NFKC đưa số fullwidth về số thường, bỏ ký tự vô hình chen giữa các chữ số).
-- Không có gì phải che thì trả lại nguyên văn; có thì trả bản chuẩn hóa đã che.
-- Số tiền không bị che: "13.000.000 ₫" (có dấu chấm) và số tròn như "150000000" (kết thúc bằng 5 số 0).
-- Đây là lớp chặn đầu: cách viết lách bằng chữ ("không chín không năm") do báo cáo của người dùng xử lý.
create or replace function public.mask_contacts(p_text text) returns text
language plpgsql immutable as $$
declare
  v_norm text;
  v_out text;
begin
  if p_text is null then
    return null;
  end if;
  v_norm := regexp_replace(normalize(p_text, NFKC),
    '[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0]', '', 'g');
  v_out := v_norm;
  -- Email.
  v_out := regexp_replace(v_out, '[[:alnum:]._%+-]+@[[:alnum:]-]+(\.[[:alnum:]-]+)+', '[đã ẩn email]', 'g');
  -- Liên kết có http, https hoặc www. Dấu câu đứng cuối (", . ; : ! ? )") không thuộc liên kết.
  v_out := regexp_replace(v_out, '(https?://|www\.)[^[:space:]]*[^[:space:].,;:!?)]', '[đã ẩn liên kết]', 'gi');
  -- Tên miền trần: zalo.me/..., t.me/..., momo.vn, bit.ly/...
  v_out := regexp_replace(v_out,
    '\m[[:alnum:]-]+(\.[[:alnum:]-]+)*\.(com|vn|net|org|me|io|ly|app|page|link|info|shop|store|site|online|xyz|top|pro|biz|asia|cc|gg)\M(/([^[:space:]]*[^[:space:].,;:!?)])?)?',
    '[đã ẩn liên kết]', 'gi');
  -- Số điện thoại Việt Nam: 0 hoặc +84, rồi đầu số 2/3/5/7/8/9, tổng 10 đến 11 số; cho phép cách, chấm, gạch giữa các số.
  v_out := regexp_replace(v_out,
    '(?<![0-9.,])(\(?\+?84\)?|0)[ .-]?[235789]([ .-]?[0-9]){8,9}(?![0-9])', '[đã ẩn số điện thoại]', 'g');
  -- Dãy từ 9 chữ số liền (số tài khoản, số thẻ, IMEI), trừ số tiền tròn.
  v_out := regexp_replace(v_out,
    '(?<![0-9])(?![1-9][0-9]*0{5}(?![0-9]))[0-9]{9,}', '[đã ẩn dãy số]', 'g');
  -- Số viết theo cụm 4 chữ số: "1234 5678 9012", "1234-5678-9012-3456". Dãy năm ("2019 2020 2021") thì để nguyên.
  v_out := regexp_replace(v_out,
    '(?<![0-9.,])(?!(19|20)[0-9]{2}([ .-](19|20)[0-9]{2})+(?![0-9.,]))[0-9]{4}([ .-][0-9]{4}){2,4}(?![0-9.,])',
    '[đã ẩn dãy số]', 'g');
  if v_out = v_norm then
    return p_text;
  end if;
  return v_out;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Quẹt và khớp (SPEC mục 5.3)
-- ---------------------------------------------------------------------------
-- Ghi một lượt quẹt. Thích mà chủ món đã thích một món đang hiển thị của mình thì tạo match.
-- Trả: matched (hai người đã khớp), match_id, is_new (match vừa được tạo trong lượt này).
create or replace function public.swipe_item(p_item_id uuid, p_direction public.swipe_direction)
returns table (matched boolean, match_id uuid, is_new boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_owner uuid;
  v_status public.item_status;
  v_a uuid;
  v_b uuid;
  v_item_a uuid;
  v_item_b uuid;
  v_their_like uuid;
  v_match uuid;
  v_new boolean := false;
begin
  if v_me is null or not public.is_active_user() then
    raise exception 'sign in to swipe' using errcode = '42501';
  end if;
  if p_direction is null then
    raise exception 'direction is required' using errcode = '22023';
  end if;
  select i.owner_id, i.status into v_owner, v_status from public.items i where i.id = p_item_id;
  -- Một thông báo chung cho: không tồn tại, không hiển thị, chủ món bị khóa, hai bên chặn nhau. Không lộ lý do.
  if not found or v_status <> 'active' or public.is_banned(v_owner) or public.is_blocked_with(v_owner) then
    raise exception 'item is not available' using errcode = '22023';
  end if;
  if v_owner = v_me then
    raise exception 'cannot swipe your own item' using errcode = '22023';
  end if;

  -- Khóa theo người quẹt (đếm giới hạn không bị đua), rồi theo cặp hai người: hai lượt thích chéo gửi cùng lúc
  -- vẫn tạo được match, vì lượt đến sau chờ lượt trước commit rồi mới kiểm tra.
  perform pg_advisory_xact_lock(hashtextextended('swipes:' || v_me::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(
    'pair:' || least(v_me, v_owner)::text || ':' || greatest(v_me, v_owner)::text, 0));

  -- Giới hạn mỗi 24 giờ tính theo số món khác nhau; quẹt lại món cũ không tính thêm.
  if not exists (select 1 from public.swipes s where s.viewer_id = v_me and s.item_id = p_item_id)
     and (select count(*) from public.swipes s
           where s.viewer_id = v_me and s.created_at > now() - interval '24 hours')
         >= public.rate_limit('swipes_per_day', 300) then
    raise exception 'daily swipe limit reached' using errcode = '54000';
  end if;

  insert into public.swipes (viewer_id, item_id, direction) values (v_me, p_item_id, p_direction)
  on conflict (viewer_id, item_id) do update set direction = excluded.direction;

  if p_direction <> 'like' then
    return query select false, null::uuid, false;
    return;
  end if;

  if v_me < v_owner then
    v_a := v_me; v_b := v_owner;
  else
    v_a := v_owner; v_b := v_me;
  end if;
  select m.id into v_match from public.matches m where m.user_a = v_a and m.user_b = v_b;
  if v_match is null then
    select s.item_id into v_their_like
      from public.swipes s join public.items i on i.id = s.item_id
     where s.viewer_id = v_owner and s.direction = 'like' and i.owner_id = v_me and i.status = 'active'
     order by s.created_at desc, s.item_id
     limit 1;
    if v_their_like is not null then
      -- item_a là món của user_a, item_b là món của user_b.
      if v_me = v_a then
        v_item_a := v_their_like; v_item_b := p_item_id;
      else
        v_item_a := p_item_id; v_item_b := v_their_like;
      end if;
      insert into public.matches (user_a, user_b, item_a, item_b) values (v_a, v_b, v_item_a, v_item_b)
      returning id into v_match;
      v_new := true;
      insert into public.notifications (user_id, type, payload) values
        (v_a, 'match_new', jsonb_build_object('match_id', v_match)),
        (v_b, 'match_new', jsonb_build_object('match_id', v_match));
    end if;
  end if;
  return query select v_match is not null, v_match, v_new;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Chat (SPEC mục 10, 12)
-- ---------------------------------------------------------------------------
-- Gửi tin trong một match. Chỉ lưu bản đã che: không có bản gốc nào để lộ qua cổng API của Supabase.
create or replace function public.send_message(p_match_id uuid, p_body text) returns public.messages
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_match public.matches;
  v_other uuid;
  v_clean text;
  v_body text;
  v_row public.messages;
begin
  if v_me is null or not public.is_active_user() then
    raise exception 'sign in to send messages' using errcode = '42501';
  end if;
  select * into v_match from public.matches m where m.id = p_match_id;
  if not found or v_me not in (v_match.user_a, v_match.user_b) then
    raise exception 'match not found' using errcode = '22023';
  end if;
  v_other := case when v_match.user_a = v_me then v_match.user_b else v_match.user_a end;
  if public.is_blocked_with(v_other) or public.is_banned(v_other) then
    raise exception 'cannot message this user' using errcode = '22023';
  end if;

  -- Bỏ ký tự điều khiển (giữ xuống dòng và tab), gộp nhiều dòng trống, cắt khoảng trắng hai đầu.
  v_clean := replace(coalesce(p_body, ''), E'\r\n', E'\n');
  v_clean := regexp_replace(v_clean, '[\u0001-\u0008\u000B-\u001F\u007F]', '', 'g');
  v_clean := regexp_replace(v_clean, E'\n{3,}', E'\n\n', 'g');
  v_clean := btrim(v_clean, E' \n\t');
  if v_clean = '' then
    raise exception 'message is empty' using errcode = '22023';
  end if;
  if length(v_clean) > 1000 then
    raise exception 'message is too long' using errcode = '22023';
  end if;

  -- Khóa theo người gửi (đếm giới hạn), rồi theo match: giờ của tin tăng dần theo thứ tự commit trong một match,
  -- nên người đang mở chat hỏi "tin sau mốc X" không bao giờ sót tin.
  perform pg_advisory_xact_lock(hashtextextended('messages:' || v_me::text, 0));
  if (select count(*) from public.messages m
       where m.sender_id = v_me and m.created_at > now() - interval '24 hours')
     >= public.rate_limit('messages_per_day', 200) then
    raise exception 'daily message limit reached' using errcode = '54000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('match:' || p_match_id::text, 0));

  v_body := case when public.contacts_unlocked(v_me, v_other) then v_clean else public.mask_contacts(v_clean) end;
  insert into public.messages (match_id, sender_id, body, masked, created_at)
  values (p_match_id, v_me, left(v_body, 2000), v_body is distinct from v_clean, clock_timestamp())
  returning * into v_row;

  -- Người gửi coi như đã đọc tới tin của chính mình.
  insert into public.match_reads (match_id, user_id, last_read_at) values (p_match_id, v_me, v_row.created_at)
  on conflict (match_id, user_id) do update
    set last_read_at = greatest(public.match_reads.last_read_at, excluded.last_read_at);
  return v_row;
end $$;

-- Đánh dấu đã đọc tới một mốc (giờ của tin cuối cùng đang hiện trên màn hình); bỏ trống thì tới hiện tại.
-- Mốc chỉ tiến, không lùi, và không vượt quá hiện tại.
create or replace function public.mark_match_read(p_match_id uuid, p_up_to timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_at timestamptz := least(coalesce(p_up_to, clock_timestamp()), clock_timestamp());
begin
  if v_me is null or not exists (
       select 1 from public.matches m where m.id = p_match_id and v_me in (m.user_a, m.user_b)) then
    raise exception 'match not found' using errcode = '22023';
  end if;
  insert into public.match_reads (match_id, user_id, last_read_at) values (p_match_id, v_me, v_at)
  on conflict (match_id, user_id) do update
    set last_read_at = greatest(public.match_reads.last_read_at, excluded.last_read_at);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Mong muốn "món cụ thể": không trỏ vào món của chính mình (phần còn lại giữ như M1)
-- ---------------------------------------------------------------------------
create or replace function public.guard_item_wants() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_item public.items;
  v_severity public.keyword_severity;
begin
  select * into v_item from public.items where id = new.item_id for update;
  if not found then
    return new; -- khóa ngoại sẽ báo lỗi
  end if;
  if (select count(*) from public.item_wants where item_id = new.item_id) >= 5 then
    raise exception 'too many wants' using errcode = '22023';
  end if;
  if new.wanted_item_id is not null and exists (
       select 1 from public.items w where w.id = new.wanted_item_id and w.owner_id = v_item.owner_id) then
    raise exception 'cannot want your own item' using errcode = '22023';
  end if;
  if new.keyword is not null and v_item.status in ('active', 'pending_review') then
    v_severity := public.banned_keyword_severity(new.keyword);
    if v_severity = 'block' then
      raise exception 'listing contains a banned keyword' using errcode = '22023';
    elsif v_severity = 'flag' and v_item.status = 'active' then
      update public.items set status = 'pending_review' where id = new.item_id;
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Chính sách RLS (SPEC mục 10)
-- ---------------------------------------------------------------------------
-- Lượt quẹt: chỉ người quẹt đọc. Chủ món không biết ai đã thích món của mình cho tới khi khớp.
create policy swipes_read_own on public.swipes for select to authenticated using (viewer_id = auth.uid());

-- Match và tin nhắn: chỉ hai người trong match. Admin chưa đọc được; M5 mở theo báo cáo hoặc khiếu nại.
create policy matches_read_participant on public.matches for select to authenticated
  using (auth.uid() in (user_a, user_b));
create policy messages_read_participant on public.messages for select to authenticated
  using (exists (select 1 from public.matches m where m.id = match_id and auth.uid() in (m.user_a, m.user_b)));
create policy match_reads_read_own on public.match_reads for select to authenticated using (user_id = auth.uid());

-- Chặn: tự thêm, tự bỏ, chỉ đọc danh sách mình chặn. Không đọc được ai đang chặn mình.
create policy blocks_read_own on public.blocks for select to authenticated using (blocker_id = auth.uid());
create policy blocks_insert_own on public.blocks for insert to authenticated
  with check (blocker_id = auth.uid() and public.is_active_user());
create policy blocks_delete_own on public.blocks for delete to authenticated using (blocker_id = auth.uid());

-- Thông báo: đọc và đánh dấu đã đọc của mình.
create policy notifications_read_own on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 8. Chốt quyền gọi hàm (xem mục 11 của migration phân quyền M1): thu hồi tất cả, cấp lại đúng danh sách.
-- rate_limit, contacts_unlocked, mask_contacts chỉ chạy bên trong các hàm SECURITY DEFINER.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_admin(), public.is_active_user(), public.is_banned(uuid) to anon, authenticated;
grant execute on function public.publish_item(uuid), public.withdraw_item(uuid),
  public.admin_review_item(uuid, boolean, text), public.my_profile(), public.my_item_severity(uuid),
  public.is_blocked_with(uuid), public.swipe_item(uuid, public.swipe_direction),
  public.send_message(uuid, text), public.mark_match_read(uuid, timestamptz) to authenticated;

-- Kiểm tra giả định của bộ che liên lạc trên database này; sai thì dừng migration.
do $$
begin
  if public.mask_contacts('gọi 0905 123 456 nhé') <> 'gọi [đã ẩn số điện thoại] nhé'
     or public.mask_contacts('giá 13.000.000 ₫, cọc 150000000') <> 'giá 13.000.000 ₫, cọc 150000000'
     or public.mask_contacts('stk 1903' || chr(8203) || '5551234567') <> 'stk [đã ẩn dãy số]' then
    raise exception 'mask_contacts không hoạt động như mong đợi trên database này';
  end if;
end $$;

insert into app_meta.migrations (version, name, checksum) values ('20261123000100', 'm2_swipe_match_chat', '527b77ef6df6762b05f5f851d22e5da6e9d3301f63abf6a8752f236870ed3be1');

commit;

-- Kết quả hiện ngay dưới khung soạn thảo: mọi dòng phải là true.
select * from (values
  ('Tài khoản kết nối chuyển được sang anon, authenticated, service_role',
    pg_has_role(current_user, 'anon', 'member') and pg_has_role(current_user, 'authenticated', 'member') and pg_has_role(current_user, 'service_role', 'member')),
  ('34 tỉnh/thành, 3.321 phường/xã, 27 danh mục',
    (select count(*) from public.provinces) = 34 and (select count(*) from public.wards) = 3321 and (select count(*) from public.categories) = 27),
  ('Mọi bảng đều bật Row Level Security',
    not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity)),
  ('Bộ lọc từ khóa hoạt động', public.banned_keyword_severity('va' || chr(8203) || 'pe') = 'block'),
  ('Sổ migration ghi đủ 5 file', (select count(*) from app_meta.migrations) = 5)
) as t("Kiểm tra", "Đạt");
