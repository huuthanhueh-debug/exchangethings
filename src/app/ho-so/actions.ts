'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { validateProfile, type ProfileErrors } from '@/lib/validation/profile';
import { getCatalog, getWards } from '@/server/catalog';
import { withActor } from '@/server/db';
import { getViewer } from '@/server/session';

export type ProfileState = { status: 'idle' | 'saved' | 'error'; errors?: ProfileErrors; values?: Record<string, string> };

const FIELDS = ['display_name', 'bio', 'province_code', 'ward_code', 'phone'] as const;

export async function saveProfile(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const viewer = await getViewer();
  if (!viewer) redirect('/dang-nhap?next=/ho-so');
  const values = Object.fromEntries(FIELDS.map((k) => [k, String(formData.get(k) ?? '')])) as Record<(typeof FIELDS)[number], string>;
  const catalog = await getCatalog();
  const wards = /^\d{2}$/.test(values.province_code) ? await getWards(values.province_code) : [];
  const r = validateProfile(values, {
    provinceCodes: new Set(catalog.provinces.map((p) => p.code)),
    wardBelongsTo: (ward) => wards.some((w) => w.code === ward),
  });
  if (!r.ok) return { status: 'error', errors: r.errors, values };

  try {
    await withActor({ kind: 'user', id: viewer.id }, async (tx) => {
      await tx.query(
        'update profiles set display_name = $2, bio = $3, province_code = $4, ward_code = $5 where id = $1',
        [viewer.id, r.value.display_name, r.value.bio, r.value.province_code, r.value.ward_code]);
      // Đổi số thì trigger tự bỏ xác minh cũ (DECISIONS D-18).
      await tx.query('update profile_private set phone_e164 = $2 where id = $1 and phone_e164 is distinct from $2', [viewer.id, r.value.phone_e164]);
    });
  } catch (e) {
    if (e instanceof Error && /banned keyword/.test(e.message)) {
      return { status: 'error', errors: { display_name: ['Tên hoặc lời giới thiệu có từ ngữ không được phép. Sửa lại rồi lưu.'] }, values };
    }
    return { status: 'error', errors: { form: ['Chưa lưu được hồ sơ. Thử lại sau ít phút.'] }, values };
  }
  revalidatePath('/', 'layout');
  return { status: 'saved', values };
}
