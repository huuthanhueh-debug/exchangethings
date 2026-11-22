import 'server-only';
import { z } from 'zod';

// Cấu hình server, kiểm tra khi dùng lần đầu (không kiểm khi import, để `next build` chạy được không cần .env).
// Không đặt key trong code: mọi bí mật đến từ biến môi trường (SPEC mục 15).

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const schema = z
  .object({
    DATABASE_URL: z.url({ error: 'DATABASE_URL phải là chuỗi kết nối Postgres.' }),
    /** CA của Supabase (PEM) khi kết nối qua mạng; để trống khi dùng Postgres local. */
    DATABASE_CA_CERT: z.string().optional(),
    AUTH_MODE: z.enum(['supabase', 'dev']).default('supabase'),
    DEV_AUTH_SECRET: z.string().min(32, { error: 'DEV_AUTH_SECRET cần ít nhất 32 ký tự.' }).optional(),
    NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20).optional(),
    SUPABASE_SECRET_KEY: z.string().min(20).optional(),
    STORAGE_DRIVER: z.enum(['local', 'supabase']).default('supabase'),
    LOCAL_STORAGE_DIR: z.string().default('.data/storage'),
    APP_URL: z.url().default('http://localhost:3000'),
    VERCEL: z.string().optional(),
  })
  .superRefine((e, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    const dbIsLocal = isLoopbackDatabase(e.DATABASE_URL);
    if (e.AUTH_MODE === 'dev') {
      // Chế độ đăng nhập thử chỉ dành cho máy dev: database phải ở localhost và không chạy trên Vercel.
      if (!dbIsLocal) issue('AUTH_MODE', 'AUTH_MODE=dev chỉ dùng với Postgres ở localhost.');
      if (e.VERCEL) issue('AUTH_MODE', 'AUTH_MODE=dev bị cấm khi chạy trên Vercel.');
      if (!e.DEV_AUTH_SECRET) issue('DEV_AUTH_SECRET', 'AUTH_MODE=dev cần DEV_AUTH_SECRET.');
    } else {
      if (!e.NEXT_PUBLIC_SUPABASE_URL) issue('NEXT_PUBLIC_SUPABASE_URL', 'Thiếu NEXT_PUBLIC_SUPABASE_URL.');
      if (!e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) issue('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'Thiếu NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.');
    }
    if (e.STORAGE_DRIVER === 'local' && (e.VERCEL || !dbIsLocal)) {
      issue('STORAGE_DRIVER', 'STORAGE_DRIVER=local chỉ dùng trên máy dev.');
    }
    if (e.STORAGE_DRIVER === 'supabase' && (!e.NEXT_PUBLIC_SUPABASE_URL || !e.SUPABASE_SECRET_KEY)) {
      issue('STORAGE_DRIVER', 'STORAGE_DRIVER=supabase cần NEXT_PUBLIC_SUPABASE_URL và SUPABASE_SECRET_KEY.');
    }
  });

export type ServerEnv = z.infer<typeof schema>;

export function isLoopbackDatabase(url: string): boolean {
  try {
    return LOOPBACK.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Đọc và kiểm tra biến môi trường. Tách riêng để test được với bộ biến tùy ý. */
export function parseEnv(source: Record<string, string | undefined>): ServerEnv {
  const r = schema.safeParse(source);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `- ${i.path.join('.') || 'env'}: ${i.message}`);
    throw new Error(`Cấu hình môi trường không hợp lệ:\n${lines.join('\n')}`);
  }
  return r.data;
}

let cached: ServerEnv | undefined;
export function env(): ServerEnv {
  return (cached ??= parseEnv(process.env));
}
