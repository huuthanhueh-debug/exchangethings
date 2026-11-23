import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { env } from '../env';

// Supabase client cho Server Component, Server Action, Route Handler. Tạo mới mỗi request (yêu cầu của @supabase/ssr).
// Trong Server Component không ghi được cookie: proxy (src/proxy.ts) lo việc làm mới phiên trước khi render.
export async function supabaseServer() {
  const store = await cookies();
  const e = env();
  return createServerClient(e.NEXT_PUBLIC_SUPABASE_URL!, e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Gọi từ Server Component: bỏ qua, proxy đã làm mới phiên.
        }
      },
    },
  });
}
