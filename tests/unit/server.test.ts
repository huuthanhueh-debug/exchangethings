import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ImageError, MAX_UPLOAD_BYTES, processPhoto } from '@/server/images';
import { parseEnv } from '@/server/env';

// Ảnh JPEG giả lập ảnh chụp từ điện thoại: có EXIF (dòng máy, GPS), XMP và thẻ xoay 90 độ.
async function phonePhoto(width = 800, height = 600) {
  return sharp({ create: { width, height, channels: 3, background: { r: 15, g: 118, b: 110 } } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExif({
      IFD0: { Make: 'Apple', Model: 'iPhone 15', Copyright: 'Nguoi chup' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '10/1 46/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '106/1 42/1 0/1' },
    })
    .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>')
    .toBuffer();
}

describe('xử lý ảnh tải lên (SPEC mục 15: xóa EXIF)', () => {
  it('ảnh gốc thật sự có EXIF, GPS và thẻ xoay (kiểm tra dữ liệu thử)', async () => {
    const meta = await sharp(await phonePhoto()).metadata();
    expect(meta.exif).toBeDefined();
    expect(meta.xmp).toBeDefined();
    expect(meta.orientation).toBe(6);
  });
  it('xóa toàn bộ EXIF, GPS, XMP; xoay đúng chiều; xuất WebP', async () => {
    const out = await processPhoto(await phonePhoto(800, 600));
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    // Thẻ xoay 6 (90 độ) đã được áp vào điểm ảnh: 800x600 thành 600x800.
    expect([out.width, out.height]).toEqual([600, 800]);
    expect(out.data.includes(Buffer.from('iPhone 15'))).toBe(false);
    expect(out.data.includes(Buffer.from('GPS'))).toBe(false);
    // Bản thu nhỏ cũng sạch metadata, cạnh dài 480px, đúng chiều.
    const thumb = await sharp(out.thumb).metadata();
    expect([thumb.format, thumb.width, thumb.height, thumb.exif]).toEqual(['webp', 360, 480, undefined]);
  });
  it('thu nhỏ về tối đa 1600px mỗi cạnh, không phóng to ảnh nhỏ', async () => {
    const big = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#888' } }).jpeg().toBuffer();
    const out = await processPhoto(big);
    expect([out.width, out.height]).toEqual([1600, 1200]);
    const small = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#888' } }).png().toBuffer();
    const out2 = await processPhoto(small);
    expect([out2.width, out2.height]).toEqual([400, 300]);
  });
  it('đọc định dạng thật từ nội dung, không tin phần mở rộng', async () => {
    const gif = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#888' } }).gif().toBuffer();
    await expect(processPhoto(gif)).rejects.toMatchObject({ code: 'unsupported' });
    await expect(processPhoto(Buffer.from('<?php echo 1; ?>'))).rejects.toMatchObject({ code: 'corrupt' });
  });
  it('từ chối ảnh quá nhỏ và tệp quá 10 MB', async () => {
    const tiny = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#888' } }).png().toBuffer();
    await expect(processPhoto(tiny)).rejects.toMatchObject({ code: 'too_small' });
    await expect(processPhoto(new Uint8Array(MAX_UPLOAD_BYTES + 1))).rejects.toBeInstanceOf(ImageError);
  });
});

describe('cấu hình môi trường', () => {
  const local = { DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:5432/exchangethings', AUTH_MODE: 'dev', DEV_AUTH_SECRET: 'x'.repeat(32), STORAGE_DRIVER: 'local' };
  it('chế độ dev hợp lệ trên máy local', () => {
    expect(parseEnv(local).AUTH_MODE).toBe('dev');
  });
  it('cấm AUTH_MODE=dev khi database không ở localhost', () => {
    expect(() => parseEnv({ ...local, DATABASE_URL: 'postgres://u:p@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres' })).toThrow(/localhost/);
  });
  it('cấm AUTH_MODE=dev và lưu tệp local khi chạy trên Vercel', () => {
    expect(() => parseEnv({ ...local, VERCEL: '1' })).toThrow(/Vercel/);
  });
  it('chế độ dev cần secret đủ dài', () => {
    expect(() => parseEnv({ ...local, DEV_AUTH_SECRET: 'ngan' })).toThrow(/32/);
  });
  it('chế độ supabase cần URL và publishable key', () => {
    expect(() => parseEnv({ DATABASE_URL: local.DATABASE_URL })).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});

describe('phiên đăng nhập thử (AUTH_MODE=dev)', async () => {
  const { signDevSession, verifyDevSession, DEV_SESSION_MAX_AGE } = await import('@/server/auth/dev-session');
  const secret = 's'.repeat(32);
  const user = '00000000-0000-4000-8000-000000000001';
  const now = Date.parse('2026-11-22T00:00:00Z');

  it('ký rồi đọc lại được user id', async () => {
    expect(await verifyDevSession(await signDevSession(user, secret, now), secret, now)).toBe(user);
  });
  it('từ chối cookie bị sửa, sai secret, hết hạn, rác', async () => {
    const token = await signDevSession(user, secret, now);
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: '00000000-0000-4000-8000-000000000011', exp: 9e9 })).toString('base64url');
    expect(await verifyDevSession(`${forged}.${sig}`, secret, now)).toBeNull();
    expect(await verifyDevSession(`${payload}.${sig.slice(0, -2)}AA`, secret, now)).toBeNull();
    expect(await verifyDevSession(token, 'k'.repeat(32), now)).toBeNull();
    expect(await verifyDevSession(token, secret, now + (DEV_SESSION_MAX_AGE + 1) * 1000)).toBeNull();
    for (const junk of [undefined, '', 'abc', 'a.b.c', '!!!.???', `${payload}.`]) {
      expect(await verifyDevSession(junk, secret, now)).toBeNull();
    }
  });
  it('không ký cho id không phải UUID', async () => {
    await expect(signDevSession('admin', secret, now)).rejects.toThrow();
  });
});

describe('lưu tệp local', async () => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { localStorage, assertSafePath } = await import('@/server/storage');

  it('ghi, đọc lại, không ghi đè, xóa', async () => {
    const s = localStorage(await mkdtemp(join(tmpdir(), 'et-storage-')));
    await s.put('item-media', 'items/abc/1.webp', Buffer.from('anh'), 'image/webp');
    expect(await s.resolve('item-media', 'items/abc/1.webp')).toMatchObject({ kind: 'bytes', contentType: 'image/webp' });
    await expect(s.put('item-media', 'items/abc/1.webp', Buffer.from('khac'), 'image/webp')).rejects.toThrow();
    await s.remove('item-media', ['items/abc/1.webp']);
    expect(await s.resolve('item-media', 'items/abc/1.webp')).toBeNull();
  });
  it.each(['../etc/passwd', 'items/../../x', '/abs/path', 'items//x', 'items/./x', 'a b.webp', ''])('chặn đường dẫn nguy hiểm: %s', (p) => {
    expect(() => assertSafePath(p)).toThrow();
  });
});

describe('cấu hình kết nối database', async () => {
  const { poolConfig } = await import('@/server/db');
  const { SUPABASE_ROOT_CA_2021 } = await import('@/server/supabase-ca');
  const sslOf = (c: ReturnType<typeof poolConfig>) => c.ssl as { ca?: string; rejectUnauthorized?: boolean } | undefined;

  it('Postgres local: không dùng TLS', () => {
    expect(poolConfig({ DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:5432/exchangethings_dev' }).ssl).toBeUndefined();
  });
  it('Supabase: luôn TLS, kiểm tra chứng chỉ bằng CA gốc của Supabase', () => {
    const c = poolConfig({ DATABASE_URL: 'postgres://postgres.abc:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres' });
    expect(sslOf(c)).toEqual({ ca: SUPABASE_ROOT_CA_2021, rejectUnauthorized: true });
    expect(SUPABASE_ROOT_CA_2021.startsWith('-----BEGIN CERTIFICATE-----')).toBe(true);
  });
  it('bỏ sslmode trong chuỗi kết nối để không ghi đè việc kiểm tra chứng chỉ', () => {
    const c = poolConfig({ DATABASE_URL: 'postgres://u:p@db.abc.supabase.co:5432/postgres?sslmode=no-verify&application_name=et' });
    expect(c.connectionString).not.toContain('sslmode');
    expect(c.connectionString).toContain('application_name=et');
    expect(sslOf(c)?.rejectUnauthorized).toBe(true);
  });
  it('CA tự đặt được ưu tiên; chấp nhận PEM dán kiểu \\n trên một dòng', () => {
    const c = poolConfig({ DATABASE_URL: 'postgres://u:p@db.abc.supabase.co:5432/postgres', DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\\nABC\\n-----END CERTIFICATE-----' });
    expect(sslOf(c)?.ca).toBe('-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----');
  });
  it('database ở xa không phải Supabase: vẫn TLS và kiểm tra bằng CA hệ thống', () => {
    expect(poolConfig({ DATABASE_URL: 'postgres://u:p@db.example.com:5432/app' }).ssl).toEqual({ rejectUnauthorized: true });
  });
});
