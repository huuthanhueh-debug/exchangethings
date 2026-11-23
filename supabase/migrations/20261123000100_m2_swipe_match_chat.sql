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
    '[­͏؜ᅟᅠ឴឵᠋-᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]', '', 'g');
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
