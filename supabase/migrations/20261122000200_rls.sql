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
