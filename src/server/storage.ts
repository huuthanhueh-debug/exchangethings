import 'server-only';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

// Lưu tệp ảnh. Hai driver cùng một giao diện:
// - local: thư mục trên máy dev (mặc định .data/storage), chỉ dùng khi chạy local.
// - supabase: Supabase Storage, bucket riêng tư; người xem nhận signed URL sống 10 phút (SPEC mục 15).
// Quyền xem do database quyết định: route /api/media/[id] chỉ gọi resolve() sau khi RLS cho phép đọc dòng item_media.

export type Bucket = 'item-media' | 'avatars';
export type Resolved = { kind: 'bytes'; data: Buffer; contentType: string } | { kind: 'redirect'; url: string };

const SIGNED_URL_TTL_SECONDS = 600; // platform_settings.signed_url_ttl_seconds
const SAFE_PATH = /^[A-Za-z0-9][A-Za-z0-9_\-./]{0,255}$/;

/** Đường dẫn bản thu nhỏ đi kèm ảnh chính: items/u/x.webp -> items/u/x.thumb.webp */
export function thumbPathOf(path: string): string {
  return path.replace(/\.webp$/, '.thumb.webp');
}

export function assertSafePath(path: string): void {
  if (!SAFE_PATH.test(path) || path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) {
    throw new Error(`unsafe storage path: ${path}`);
  }
}

export interface Storage {
  put(bucket: Bucket, path: string, data: Buffer, contentType: string): Promise<void>;
  remove(bucket: Bucket, paths: string[]): Promise<void>;
  resolve(bucket: Bucket, path: string): Promise<Resolved | null>;
}

export function localStorage(rootDir: string): Storage {
  const root = resolve(rootDir);
  const fileOf = (bucket: Bucket, path: string) => {
    assertSafePath(path);
    const full = resolve(root, bucket, path);
    if (!full.startsWith(root + sep)) throw new Error(`path escapes storage root: ${path}`);
    return full;
  };
  return {
    async put(bucket, path, data) {
      const full = fileOf(bucket, path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, data, { flag: 'wx' }); // không ghi đè tệp đã có
    },
    async remove(bucket, paths) {
      await Promise.all(paths.map((p) => rm(fileOf(bucket, p), { force: true })));
    },
    async resolve(bucket, path) {
      try {
        return { kind: 'bytes', data: await readFile(fileOf(bucket, path)), contentType: 'image/webp' };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
    },
  };
}

export function supabaseStorage(client: SupabaseClient): Storage {
  return {
    async put(bucket, path, data, contentType) {
      assertSafePath(path);
      const { error } = await client.storage.from(bucket).upload(path, data, { contentType, upsert: false });
      if (error) throw new Error(`storage upload failed: ${error.message}`);
    },
    async remove(bucket, paths) {
      paths.forEach(assertSafePath);
      if (paths.length === 0) return;
      const { error } = await client.storage.from(bucket).remove(paths);
      if (error) throw new Error(`storage remove failed: ${error.message}`);
    },
    async resolve(bucket, path) {
      assertSafePath(path);
      const { data, error } = await client.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
      if (error || !data) return null;
      return { kind: 'redirect', url: data.signedUrl };
    },
  };
}

let instance: Storage | undefined;
export function storage(): Storage {
  if (!instance) {
    const e = env();
    instance = e.STORAGE_DRIVER === 'local'
      ? localStorage(e.LOCAL_STORAGE_DIR)
      : supabaseStorage(createClient(e.NEXT_PUBLIC_SUPABASE_URL!, e.SUPABASE_SECRET_KEY!, {
          auth: { persistSession: false, autoRefreshToken: false },
        }));
  }
  return instance;
}
