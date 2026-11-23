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
