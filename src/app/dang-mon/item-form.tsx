'use client';

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent } from 'react';
import { SubmitButton } from '@/components/form-bits';
import { MoneyInput } from '@/components/money-input';
import { PhotoPicker } from '@/components/photo-picker';
import { Field, Notice, cx, inputClass } from '@/components/ui';
import {
  CONDITION_LABEL, DELIVERY_LABEL, DURATION_OPTIONS, ITEM_TYPE_META, MAX_WANTS,
  type Condition, type DeliveryMethod, type ItemType,
} from '@/lib/items';
import type { ItemFormState } from './actions';

type CategoryOption = { id: string; nameVi: string; item_type: ItemType; requires_proof: boolean; is_phone: boolean };
type Option = { code: string; name: string };
export type ItemFormValues = Partial<Record<
  'title' | 'description' | 'category_id' | 'condition' | 'est_value_vnd' | 'topup_pay_max_vnd' | 'topup_receive_max_vnd'
  | 'sell_price_vnd' | 'province_code' | 'expires_on' | 'imei' | 'duration_minutes' | 'wants_keywords', string>> & {
  delivery_methods?: string[]; wants_categories?: string[]; sell_enabled?: boolean; signed_out_confirmed?: boolean; transfer_right_confirmed?: boolean;
};

const TITLE_PLACEHOLDER: Record<ItemType, string> = {
  physical: 'Ví dụ: iPhone 15 128GB màu xanh',
  digital_file: 'Ví dụ: Bộ 120 template Canva cho quán cà phê',
  course_code: 'Ví dụ: Mã kích hoạt khóa học Excel nâng cao',
  voucher: 'Ví dụ: Voucher mua sắm 500.000 ₫',
  service: 'Ví dụ: Một buổi dạy tiếng Anh giao tiếp 60 phút',
  other: 'Ví dụ: Chậu bonsai mini để bàn',
};
const DESCRIPTION_LABEL: Record<ItemType, string> = {
  physical: 'Mô tả', digital_file: 'Mô tả nội dung file', course_code: 'Mô tả khóa học',
  voucher: 'Điều kiện áp dụng', service: 'Nội dung buổi', other: 'Mô tả chi tiết',
};

export function ItemForm({ mode, type, categories, wantCategories, provinces, defaults, action, today }: {
  mode: 'create' | 'edit';
  type: ItemType;
  categories: CategoryOption[];
  wantCategories: { group: string; options: { id: string; nameVi: string }[] }[];
  provinces: Option[];
  defaults: ItemFormValues;
  action: (prev: ItemFormState, formData: FormData) => Promise<ItemFormState>;
  today: string;
}) {
  const meta = ITEM_TYPE_META[type];
  const [state, formAction, pending] = useActionState(action, { status: 'idle' } satisfies ItemFormState);
  const [categoryId, setCategoryId] = useState(defaults.category_id ?? '');
  const [delivery, setDelivery] = useState<string[]>(defaults.delivery_methods ?? (meta.delivery.length === 1 ? [...meta.delivery] : []));
  const [sell, setSell] = useState(Boolean(defaults.sell_enabled));
  const [wants, setWants] = useState<string[]>(defaults.wants_categories ?? []);
  const formRef = useRef<HTMLFormElement>(null);
  const category = categories.find((c) => c.id === categoryId);
  const e: NonNullable<ItemFormState['errors']> = state.errors ?? {};
  const err = (k: keyof NonNullable<ItemFormState['errors']>) => e[k];

  // Có lỗi thì đưa con trỏ tới ô lỗi đầu tiên.
  useEffect(() => {
    if (state.status !== 'error') return;
    const el = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"]');
    el?.focus({ preventScroll: false });
  }, [state]);

  // Gửi thủ công để React không xóa form sau khi gửi: nhập sai một ô thì không mất ảnh đã chọn.
  function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const submitter = (ev.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const fd = new FormData(ev.currentTarget, submitter);
    startTransition(() => formAction(fd));
  }

  const needsProvince = type === 'physical' || delivery.includes('meetup');
  const errorCount = Object.keys(e).length;

  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} noValidate className="space-y-6">
      <input type="hidden" name="type" value={type} />
      {state.message && <Notice tone="bad">{state.message}</Notice>}
      {errorCount > 0 && !state.message && (
        <Notice tone="bad" title={`Còn ${errorCount} chỗ cần sửa`}>Các ô cần sửa được đánh dấu đỏ bên dưới.</Notice>
      )}

      <Section title="Thông tin món">
        <Field label="Tên món" htmlFor="title" required error={err('title')}>
          <input id="title" name="title" defaultValue={defaults.title} maxLength={80} placeholder={TITLE_PLACEHOLDER[type]}
            className={inputClass} aria-invalid={Boolean(err('title'))} />
        </Field>
        <Field label="Danh mục" htmlFor="category_id" required error={err('category_id')}>
          <select id="category_id" name="category_id" value={categoryId} onChange={(ev) => setCategoryId(ev.target.value)}
            className={inputClass} aria-invalid={Boolean(err('category_id'))}>
            <option value="">Chọn danh mục</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.nameVi}</option>)}
          </select>
        </Field>
        {meta.hasCondition && (
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-semibold text-ink">Tình trạng{type === 'physical' && <span className="text-bad" aria-hidden> *</span>}</legend>
            <div className="flex flex-wrap gap-2">
              {(['new', 'like_new', 'good', 'fair'] as Condition[]).map((c, i) => (
                <label key={c} className="cursor-pointer">
                  <input type="radio" name="condition" value={c} defaultChecked={defaults.condition === c} className="peer sr-only"
                    aria-describedby={err('condition') ? 'condition-error' : undefined} data-invalid={i === 0 && Boolean(err('condition'))} />
                  <span className="inline-flex rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-semibold text-ink-2 transition peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:text-accent-ink peer-focus-visible:ring-2 peer-focus-visible:ring-accent">
                    {CONDITION_LABEL[c]}
                  </span>
                </label>
              ))}
            </div>
            {err('condition') && <p id="condition-error" className="text-sm text-bad" role="alert">{err('condition')![0]}</p>}
          </fieldset>
        )}
        <Field label={DESCRIPTION_LABEL[type]} htmlFor="description" required={type === 'voucher' || type === 'other'} error={err('description')}
          hint={type === 'voucher' ? 'Ví dụ: áp dụng đơn từ 1.000.000 ₫, không dùng chung khuyến mãi khác.' : 'Tình trạng thật, phụ kiện kèm theo, lý do muốn đổi.'}>
          <textarea id="description" name="description" defaultValue={defaults.description} rows={4} maxLength={2000}
            className={inputClass} aria-invalid={Boolean(err('description'))} />
        </Field>
        {meta.needsExpiry && (
          <Field label="Hạn dùng" htmlFor="expires_on" required error={err('expires_on')} hint="Còn dưới 7 ngày thì món được đánh dấu sắp hết hạn.">
            <input id="expires_on" name="expires_on" type="date" min={today} defaultValue={defaults.expires_on} className={inputClass}
              aria-invalid={Boolean(err('expires_on'))} />
          </Field>
        )}
        {meta.needsDuration && (
          <Field label="Thời lượng" htmlFor="duration_minutes" required error={err('duration_minutes')}>
            <select id="duration_minutes" name="duration_minutes" defaultValue={defaults.duration_minutes ?? ''} className={inputClass}
              aria-invalid={Boolean(err('duration_minutes'))}>
              <option value="">Chọn thời lượng</option>
              {DURATION_OPTIONS.map((m) => <option key={m} value={m}>{m < 60 ? `${m} phút` : m % 60 ? `${Math.floor(m / 60)} giờ ${m % 60} phút` : `${m / 60} giờ`}</option>)}
            </select>
          </Field>
        )}
      </Section>

      {category?.is_phone && (
        <Section title="Điện thoại" description="Chỉ bạn và admin thấy đủ 15 số IMEI; người khác chỉ thấy 4 số cuối.">
          <Field label="IMEI" htmlFor="imei" required error={err('imei')} hint="Bấm *#06# trên máy để xem IMEI.">
            <input id="imei" name="imei" inputMode="numeric" autoComplete="off" maxLength={18} defaultValue={defaults.imei}
              className={`${inputClass} tabular tracking-wider`} aria-invalid={Boolean(err('imei'))} />
          </Field>
          <Checkbox name="signed_out_confirmed" defaultChecked={defaults.signed_out_confirmed} error={err('signed_out_confirmed')}
            label="Máy đã thoát iCloud hoặc tài khoản Google, không bị khóa kích hoạt." />
        </Section>
      )}

      {mode === 'create' && (meta.minPhotos > 0 || type === 'other' || category?.requires_proof) && (
        <Section title="Ảnh" description="Ảnh được xóa thông tin vị trí và dòng máy trước khi lưu.">
          {(meta.minPhotos > 0 || type === 'other') && (
            <PhotoPicker name="photos" label="Ảnh sản phẩm" max={10} min={meta.minPhotos} error={err('photos')}
              hint="Chụp rõ mặt trước, mặt sau và chỗ trầy xước nếu có." />
          )}
          {category?.requires_proof && (
            <PhotoPicker name="proof" label="Ảnh chứng từ" max={2} min={1} error={err('proof')}
              hint="Hóa đơn hoặc thẻ bảo hành. Chỉ bạn và admin xem được." />
          )}
        </Section>
      )}

      <Section title="Giá trị và tiền bù" description="Giá trị bạn khai giúp hệ thống gợi ý mức bù công bằng khi hai bên thương lượng.">
        <Field label="Giá trị ước tính" htmlFor="est_value_vnd" required error={err('est_value_vnd')}>
          <MoneyInput id="est_value_vnd" name="est_value_vnd" defaultValue={defaults.est_value_vnd} placeholder="13.000.000" invalid={Boolean(err('est_value_vnd'))} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Bạn bù thêm tối đa" htmlFor="topup_pay_max_vnd" error={err('topup_pay_max_vnd')} hint="Khi món bạn muốn có giá cao hơn.">
            <MoneyInput id="topup_pay_max_vnd" name="topup_pay_max_vnd" defaultValue={defaults.topup_pay_max_vnd} placeholder="0" invalid={Boolean(err('topup_pay_max_vnd'))} />
          </Field>
          <Field label="Bạn nhận bù tối đa" htmlFor="topup_receive_max_vnd" error={err('topup_receive_max_vnd')} hint="Khi món của bạn có giá cao hơn.">
            <MoneyInput id="topup_receive_max_vnd" name="topup_receive_max_vnd" defaultValue={defaults.topup_receive_max_vnd} placeholder="0" invalid={Boolean(err('topup_receive_max_vnd'))} />
          </Field>
        </div>
        <label className="flex items-start gap-3">
          <input type="checkbox" name="sell_enabled" checked={sell} onChange={(ev) => setSell(ev.target.checked)} className="mt-1 size-4 accent-[var(--accent)]" />
          <span className="text-[15px] text-ink">Bán thẳng nếu có người muốn mua bằng tiền</span>
        </label>
        {sell && (
          <Field label="Giá bán" htmlFor="sell_price_vnd" required error={err('sell_price_vnd')}>
            <MoneyInput id="sell_price_vnd" name="sell_price_vnd" defaultValue={defaults.sell_price_vnd} placeholder="350.000" invalid={Boolean(err('sell_price_vnd'))} />
          </Field>
        )}
      </Section>

      <Section title="Giao nhận">
        {meta.delivery.length > 1 ? (
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-semibold text-ink">Cách giao<span className="text-bad" aria-hidden> *</span></legend>
            <div className="flex flex-wrap gap-2">
              {meta.delivery.map((d) => (
                <Chip key={d} name="delivery_methods" value={d} checked={delivery.includes(d)} invalid={Boolean(err('delivery_methods'))}
                  onChange={(on) => setDelivery((cur) => (on ? [...cur, d] : cur.filter((x) => x !== d)))}>
                  {DELIVERY_LABEL[d as DeliveryMethod]}
                </Chip>
              ))}
            </div>
            {err('delivery_methods') && <p className="text-sm text-bad" role="alert">{err('delivery_methods')![0]}</p>}
          </fieldset>
        ) : (
          <p className="text-[15px] text-ink-2">Cách giao: <strong className="text-ink">{DELIVERY_LABEL[meta.delivery[0]]}</strong>. Mã hoặc file chỉ mở cho bên kia khi giao dịch đã khóa.</p>
        )}
        {(needsProvince || type === 'other' || type === 'service') && (
          <Field label="Tỉnh/thành nơi giao" htmlFor="province_code" required={needsProvince} error={err('province_code')}>
            <select id="province_code" name="province_code" defaultValue={defaults.province_code ?? ''} className={inputClass}
              aria-invalid={Boolean(err('province_code'))}>
              <option value="">Chọn tỉnh/thành</option>
              {provinces.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
            </select>
          </Field>
        )}
        {meta.needsTransferRight && (
          <Checkbox name="transfer_right_confirmed" defaultChecked={defaults.transfer_right_confirmed} error={err('transfer_right_confirmed')}
            label={type === 'digital_file' ? 'Tôi có quyền chia sẻ file này cho người khác.' : 'Mã này được phép chuyển nhượng cho người khác.'} />
        )}
      </Section>

      <Section title="Muốn đổi lấy" description={`Chọn tối đa ${MAX_WANTS} mong muốn, gồm danh mục và từ khóa. Để trống nếu bạn sẵn sàng xem mọi đề nghị.`}>
        <details className="group rounded-xl border border-line bg-surface-2/50 p-3" open={wants.length > 0 || Boolean(err('wants_categories'))}>
          <summary className="cursor-pointer list-none text-sm font-semibold text-ink">
            Danh mục mong muốn {wants.length > 0 && <span className="text-accent-ink">({wants.length} đã chọn)</span>}
          </summary>
          <div className="mt-3 space-y-3">
            {wantCategories.map((g) => (
              <div key={g.group}>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{g.group}</p>
                <div className="flex flex-wrap gap-2">
                  {g.options.map((o) => (
                    <Chip key={o.id} name="wants_categories" value={o.id} checked={wants.includes(o.id)} size="sm"
                      onChange={(on) => setWants((cur) => (on ? [...cur, o.id] : cur.filter((x) => x !== o.id)))}>
                      {o.nameVi}
                    </Chip>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </details>
        {err('wants_categories') && <p className="text-sm text-bad" role="alert">{err('wants_categories')![0]}</p>}
        <Field label="Từ khóa mong muốn" htmlFor="wants_keywords" error={err('wants_keywords')} hint="Cách nhau bằng dấu phẩy. Ví dụ: iPhone 18, MacBook Air">
          <input id="wants_keywords" name="wants_keywords" defaultValue={defaults.wants_keywords} className={inputClass}
            aria-invalid={Boolean(err('wants_keywords'))} />
        </Field>
      </Section>

      <div className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 -mx-4 flex flex-wrap gap-3 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
        {mode === 'create' ? (
          <>
            <SubmitButton name="intent" value="publish" pendingText="Đang đăng..." className="flex-1 md:flex-none">Đăng món</SubmitButton>
            <SubmitButton name="intent" value="draft" variant="secondary" pendingText="Đang lưu..." className="flex-1 md:flex-none">Lưu nháp</SubmitButton>
          </>
        ) : (
          <SubmitButton pendingText="Đang lưu..." className="flex-1 md:flex-none">Lưu thay đổi</SubmitButton>
        )}
        {pending && <span className="sr-only" aria-live="polite">Đang gửi</span>}
      </div>
    </form>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl border border-line bg-surface p-5 shadow-card md:p-6">
      <div>
        <h2 className="text-lg font-bold tracking-tight">{title}</h2>
        {description && <p className="mt-1 text-sm leading-relaxed text-ink-2">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Checkbox({ name, label, defaultChecked, error }: { name: string; label: string; defaultChecked?: boolean; error?: string[] }) {
  return (
    <div className="space-y-1">
      <label className="flex items-start gap-3">
        <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-1 size-4 accent-[var(--accent)]" aria-invalid={Boolean(error)} />
        <span className="text-[15px] text-ink">{label}</span>
      </label>
      {error && <p className="text-sm text-bad" role="alert">{error[0]}</p>}
    </div>
  );
}

function Chip({ name, value, checked, onChange, children, invalid, size = 'md' }: {
  name: string; value: string; checked: boolean; onChange: (on: boolean) => void; children: React.ReactNode; invalid?: boolean; size?: 'sm' | 'md';
}) {
  return (
    <label className="cursor-pointer">
      <input type="checkbox" name={name} value={value} checked={checked} onChange={(ev) => onChange(ev.target.checked)} className="peer sr-only" aria-invalid={invalid} />
      <span className={cx('inline-flex rounded-full border font-semibold transition peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:text-accent-ink peer-focus-visible:ring-2 peer-focus-visible:ring-accent',
        size === 'sm' ? 'px-3 py-1.5 text-[13px]' : 'px-3.5 py-2 text-sm',
        invalid ? 'border-bad/60 text-bad' : 'border-line bg-surface text-ink-2')}>
        {children}
      </span>
    </label>
  );
}
