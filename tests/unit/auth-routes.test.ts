import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Link đăng nhập trong email: nhận cả mẫu mặc định của Supabase (?code=) lẫn mẫu token_hash, luôn quay về trang nội bộ.
const h = vi.hoisted(() => ({
  mode: 'supabase',
  verifyOtp: vi.fn(async () => ({ error: null as unknown })),
  exchangeCodeForSession: vi.fn(async () => ({ error: null as unknown })),
}));
vi.mock('@/server/auth/supabase', () => ({ supabaseServer: async () => ({ auth: { verifyOtp: h.verifyOtp, exchangeCodeForSession: h.exchangeCodeForSession } }) }));
vi.mock('@/server/env', () => ({ env: () => ({ AUTH_MODE: h.mode }) }));
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));

async function visit(route: 'confirm' | 'callback', query: string): Promise<string> {
  const mod = route === 'confirm' ? await import('@/app/auth/confirm/route') : await import('@/app/auth/callback/route');
  try {
    await mod.GET(new NextRequest(`http://localhost:3000/auth/${route}?${query}`));
    return 'không chuyển hướng';
  } catch (e) {
    return (e as Error).message.replace('REDIRECT ', '');
  }
}

describe('link đăng nhập qua email và Google', () => {
  beforeEach(() => {
    h.mode = 'supabase';
    h.verifyOtp.mockClear().mockResolvedValue({ error: null });
    h.exchangeCodeForSession.mockClear().mockResolvedValue({ error: null });
  });

  it('mẫu email mặc định của Supabase (?code=): đổi code lấy phiên, về đúng trang', async () => {
    expect(await visit('confirm', 'code=abc123&next=%2Fdang-mon%3Floai%3Dphysical')).toBe('/dang-mon?loai=physical');
    expect(h.exchangeCodeForSession).toHaveBeenCalledWith('abc123');
    expect(h.verifyOtp).not.toHaveBeenCalled();
  });
  it('mẫu token_hash: xác minh OTP, về đúng trang', async () => {
    expect(await visit('confirm', 'token_hash=th_1&type=email&next=%2Fho-so')).toBe('/ho-so');
    expect(h.verifyOtp).toHaveBeenCalledWith({ type: 'email', token_hash: 'th_1' });
  });
  it('link hết hạn, thiếu tham số hoặc type lạ: về trang đăng nhập kèm thông báo', async () => {
    h.exchangeCodeForSession.mockResolvedValue({ error: new Error('expired') });
    expect(await visit('confirm', 'code=cu')).toBe('/dang-nhap?loi=link');
    expect(await visit('confirm', '')).toBe('/dang-nhap?loi=link');
    expect(await visit('confirm', 'token_hash=x&type=khong-co')).toBe('/dang-nhap?loi=link');
    expect(h.verifyOtp).not.toHaveBeenCalled();
  });
  it('next trỏ ra trang ngoài thì về trang chủ', async () => {
    expect(await visit('confirm', `code=abc&next=${encodeURIComponent('/.//evil.example/x')}`)).toBe('/');
    expect(await visit('callback', `code=abc&next=${encodeURIComponent('//evil.example')}`)).toBe('/');
  });
  it('Google: đổi code lấy phiên; lỗi thì về trang đăng nhập', async () => {
    expect(await visit('callback', 'code=g1&next=%2Fmon-cua-toi')).toBe('/mon-cua-toi');
    h.exchangeCodeForSession.mockResolvedValue({ error: new Error('bad') });
    expect(await visit('callback', 'code=g2')).toBe('/dang-nhap?loi=google');
  });
  it('máy dev (AUTH_MODE=dev): không gọi Supabase', async () => {
    h.mode = 'dev';
    expect(await visit('confirm', 'code=abc')).toBe('/dang-nhap');
    expect(await visit('callback', 'code=abc')).toBe('/dang-nhap');
    expect(h.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});
