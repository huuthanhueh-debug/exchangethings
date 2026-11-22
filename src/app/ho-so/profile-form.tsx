'use client';

import { useActionState, useRef, useState } from 'react';
import { SubmitButton } from '@/components/form-bits';
import { Field, Notice, inputClass } from '@/components/ui';
import { saveProfile, type ProfileState } from './actions';

type Option = { code: string; name: string };

export function ProfileForm({ initial, provinces, initialWards, phoneVerified }: {
  initial: Record<'display_name' | 'bio' | 'province_code' | 'ward_code' | 'phone', string>;
  provinces: Option[];
  initialWards: Option[];
  phoneVerified: boolean;
}) {
  const [state, action] = useActionState<ProfileState, FormData>(saveProfile, { status: 'idle', values: initial });
  const v = state.values ?? initial;
  const [province, setProvince] = useState(v.province_code);
  const [wards, setWards] = useState<Option[]>(initialWards);
  const [loadingWards, setLoadingWards] = useState(false);
  const latest = useRef(0);
  const e = state.errors ?? {};

  // Đổi tỉnh/thành thì tải danh sách phường/xã của tỉnh đó; bỏ qua phản hồi cũ nếu người dùng đổi tiếp.
  async function onProvinceChange(code: string) {
    setProvince(code);
    const req = ++latest.current;
    if (code === initial.province_code) { setWards(initialWards); setLoadingWards(false); return; }
    if (!code) { setWards([]); setLoadingWards(false); return; }
    setLoadingWards(true);
    try {
      const r = await fetch(`/api/wards?province=${code}`);
      const list: Option[] = r.ok ? await r.json() : [];
      if (req === latest.current) setWards(list);
    } catch {
      if (req === latest.current) setWards([]);
    } finally {
      if (req === latest.current) setLoadingWards(false);
    }
  }

  return (
    <form action={action} className="space-y-5" noValidate>
      {state.status === 'saved' && <Notice tone="ok">Đã lưu hồ sơ.</Notice>}
      {e.form && <Notice tone="bad">{e.form[0]}</Notice>}
      <Field label="Tên hiển thị" htmlFor="display_name" required error={e.display_name} hint="Người khác thấy tên này khi xem món của bạn.">
        <input id="display_name" name="display_name" defaultValue={v.display_name} maxLength={40} required autoComplete="nickname"
          className={inputClass} aria-invalid={Boolean(e.display_name)} />
      </Field>
      <Field label="Giới thiệu ngắn" htmlFor="bio" error={e.bio} hint="Tối đa 280 ký tự. Ví dụ: hay đổi đồ công nghệ, giao ở Hải Châu.">
        <textarea id="bio" name="bio" defaultValue={v.bio} maxLength={280} rows={3} className={inputClass} aria-invalid={Boolean(e.bio)} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Tỉnh/thành" htmlFor="province_code" error={e.province_code}>
          <select id="province_code" name="province_code" value={province} onChange={(ev) => void onProvinceChange(ev.target.value)}
            className={inputClass} aria-invalid={Boolean(e.province_code)}>
            <option value="">Chọn tỉnh/thành</option>
            {provinces.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Phường/xã" htmlFor="ward_code" error={e.ward_code} hint={loadingWards ? 'Đang tải danh sách...' : undefined}>
          <select key={province} id="ward_code" name="ward_code" defaultValue={province === v.province_code ? v.ward_code : ''}
            disabled={!province || loadingWards} className={inputClass} aria-invalid={Boolean(e.ward_code)}>
            <option value="">{province ? 'Chọn phường/xã' : 'Chọn tỉnh/thành trước'}</option>
            {wards.map((w) => <option key={w.code} value={w.code}>{w.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Số di động" htmlFor="phone" error={e.phone_e164}
        hint={phoneVerified ? 'Đã xác minh. Đổi số thì cần xác minh lại.' : 'Chưa xác minh. Xác minh bằng mã OTP có ở bản tiếp theo. Số không hiện cho người khác.'}>
        <input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" defaultValue={v.phone} placeholder="0905 123 456"
          className={inputClass} aria-invalid={Boolean(e.phone_e164)} />
      </Field>
      <SubmitButton pendingText="Đang lưu...">Lưu hồ sơ</SubmitButton>
    </form>
  );
}
