import { describe, expect, it } from 'vitest';
import { formatDateVi, formatNumber, formatVnd, parseVnd } from '@/lib/format';
import { formatVnMobile, maskVnMobile, normalizeVnMobile } from '@/lib/phone';
import { isValidImei, normalizeImei } from '@/lib/imei';
import { daysUntil, todayInVietnam } from '@/lib/items';
import { safeNextPath } from '@/lib/safe-path';

describe('tiền VND', () => {
  it('định dạng theo kiểu Việt Nam, khoảng trắng không ngắt dòng trước ₫', () => {
    expect(formatVnd(13_000_000)).toBe('13.000.000 ₫');
    expect(formatVnd(0)).toBe('0 ₫');
    expect(formatNumber(4_000_000)).toBe('4.000.000');
  });
  it('đọc số tiền người dùng gõ theo nhiều kiểu', () => {
    expect(parseVnd('13.000.000')).toBe(13_000_000);
    expect(parseVnd('13,000,000')).toBe(13_000_000);
    expect(parseVnd(' 13 000 000 ₫ ')).toBe(13_000_000);
    expect(parseVnd('')).toBeNull();
    expect(parseVnd('abc')).toBeNull();
    expect(parseVnd(undefined)).toBeNull();
    expect(parseVnd('9'.repeat(20))).toBeNull();
  });
  it('ngày ISO thành dd/mm/yyyy', () => {
    expect(formatDateVi('2026-12-31')).toBe('31/12/2026');
  });
});

describe('số di động Việt Nam', () => {
  it.each([
    ['0905 123 456', '+84905123456'],
    ['+84 905-123-456', '+84905123456'],
    ['84905123456', '+84905123456'],
    ['0389999999', '+84389999999'],
    ['0705.123.456', '+84705123456'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeVnMobile(input)).toBe(expected);
  });
  it.each(['', '0905 123 45', '02812345678', '0105123456', '+1 415 555 0100', '0905abc456', '0905 123 4567'])('từ chối %s', (input) => {
    expect(normalizeVnMobile(input)).toBeNull();
  });
  it('hiển thị và che số', () => {
    expect(formatVnMobile('+84905123456')).toBe('0905 123 456');
    expect(maskVnMobile('+84905123456')).toBe('0905 *** 456');
  });
});

describe('IMEI', () => {
  it('chấp nhận IMEI đúng số kiểm tra Luhn', () => {
    expect(isValidImei('490154203237518')).toBe(true);
    expect(isValidImei('35-693803-564380-9')).toBe(true);
    expect(isValidImei('353912000084821')).toBe(true); // IMEI mẫu của An trong seed
  });
  it('từ chối sai số kiểm tra, sai độ dài, có chữ', () => {
    expect(isValidImei('490154203237519')).toBe(false);
    expect(isValidImei('49015420323751')).toBe(false);
    expect(isValidImei('49015420323751a')).toBe(false);
    expect(normalizeImei('4901 5420 3237 518')).toBe('490154203237518');
  });
});

describe('ngày theo giờ Việt Nam', () => {
  it('17:30 UTC đã là ngày hôm sau ở Việt Nam', () => {
    expect(todayInVietnam(new Date('2026-11-21T17:30:00Z'))).toBe('2026-11-22');
    expect(todayInVietnam(new Date('2026-11-21T16:59:59Z'))).toBe('2026-11-21');
  });
  it('đếm số ngày còn lại', () => {
    expect(daysUntil('2026-12-01', '2026-11-22')).toBe(9);
    expect(daysUntil('2026-11-22', '2026-11-22')).toBe(0);
    expect(daysUntil('2026-11-21', '2026-11-22')).toBe(-1);
  });
});

describe('đường dẫn quay lại sau đăng nhập (chống chuyển hướng ra trang ngoài)', () => {
  it.each(['/ho-so', '/dang-mon?loai=physical', '/mon-cua-toi/abc?ket-qua=da-dang', '/'])('giữ đường dẫn nội bộ %s', (p) => {
    expect(safeNextPath(p)).toBe(p);
  });
  it.each([
    '//evil.example', '/\\evil.example', '/.//evil.example/x', '/..//evil.example', '/./\\evil.example', '/a/..//evil.example',
    '/\t/evil.example', '/\n/evil.example', 'https://evil.example', 'evil.example', 'javascript:alert(1)', '', '/' + 'a'.repeat(2001),
  ])('từ chối %j', (p) => {
    expect(safeNextPath(p)).toBe('/');
  });
  it('kết quả không bao giờ bắt đầu bằng // hoặc chứa dấu \\', () => {
    for (const p of ['/.//x', '/a/../..//x', '/%2F/x', '/%5Cx', '/././/x?y=//z']) {
      const out = safeNextPath(p);
      expect(out.startsWith('//')).toBe(false);
      expect(out.includes('\\')).toBe(false);
    }
  });
  it('giá trị không phải chuỗi thì về trang chủ', () => {
    expect(safeNextPath(undefined)).toBe('/');
    expect(safeNextPath(['/a', '/b'])).toBe('/');
  });
});
