'use client';

import { useEffect, useRef, useState } from 'react';
import { CameraIcon, XIcon } from '@phosphor-icons/react/ssr';
import { cx } from './ui';

// Chọn ảnh, xem trước, bỏ bớt. Trước khi gửi, ảnh được thu nhỏ trên máy (tối đa 2048px, JPEG) để tải lên nhanh
// trên mạng di động; server vẫn xử lý lại toàn bộ (xóa EXIF, kiểm định dạng) nên không tin ảnh từ trình duyệt.
// Ảnh nằm trong chính <input type="file">, nên form gửi bình thường kể cả khi JavaScript tắt.

const MAX_SIDE = 2048;
const processed = new WeakSet<File>();

async function downscale(file: File): Promise<File> {
  if (processed.has(file) || !/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= 2_500_000) {
      bitmap.close();
      processed.add(file);
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    if (!blob) return file;
    const out = new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
    processed.add(out);
    return out;
  } catch {
    return file;
  }
}

export function PhotoPicker({ name, label, hint, max, min = 0, error, describedBy }: {
  name: string; label: string; hint?: string; max: number; min?: number; error?: string[]; describedBy?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => urls.forEach(URL.revokeObjectURL), [urls]);

  function sync(list: File[]) {
    const dt = new DataTransfer();
    list.forEach((f) => dt.items.add(f));
    if (input.current) input.current.files = dt.files;
    setFiles(list);
    setUrls(list.map((f) => URL.createObjectURL(f)));
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []).filter((f) => !files.includes(f));
    setBusy(true);
    const ready = await Promise.all([...files, ...picked].slice(0, max).map(downscale));
    setBusy(false);
    sync(ready);
  }

  const id = `pick-${name}`;
  const count = files.length;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold text-ink">
          {label}
          {min > 0 && <span className="text-bad" aria-hidden> *</span>}
        </label>
        <span className={cx('tabular text-xs font-semibold', count >= min ? 'text-muted' : 'text-warn')} aria-live="polite">
          {count}/{max} ảnh{min > 0 ? `, cần ít nhất ${min}` : ''}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {urls.map((url, i) => (
          <div key={url} className="relative aspect-square overflow-hidden rounded-xl border border-line bg-surface-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- ảnh xem trước tạm thời (blob URL) */}
            <img src={url} alt={`Ảnh ${i + 1}`} className="size-full object-cover" />
            <button type="button" onClick={() => sync(files.filter((_, j) => j !== i))}
              className="absolute right-1 top-1 inline-flex size-7 items-center justify-center rounded-full bg-ink/70 text-surface backdrop-blur transition hover:bg-ink"
              aria-label={`Bỏ ảnh ${i + 1}`}>
              <XIcon size={14} weight="bold" aria-hidden />
            </button>
          </div>
        ))}
        {count < max && (
          <label htmlFor={id}
            className={cx('flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed text-center text-xs font-semibold transition',
              error?.length ? 'border-bad/60 text-bad' : 'border-line text-ink-2 hover:border-accent/50 hover:text-accent-ink')}>
            <CameraIcon size={24} aria-hidden />
            {busy ? 'Đang xử lý...' : 'Thêm ảnh'}
          </label>
        )}
      </div>
      <input ref={input} id={id} name={name} type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple={max > 1}
        onChange={onPick} className="sr-only" aria-describedby={describedBy ?? `${id}-msg`} aria-invalid={Boolean(error?.length)} />
      {error?.length ? (
        <ul id={`${id}-msg`} className="space-y-0.5 text-sm text-bad" role="alert">{error.map((m) => <li key={m}>{m}</li>)}</ul>
      ) : hint ? (
        <p id={`${id}-msg`} className="text-sm text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
