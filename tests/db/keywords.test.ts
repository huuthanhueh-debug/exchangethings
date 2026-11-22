import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { connect, dbTestsEnabled, rows } from './helpers';

const d = dbTestsEnabled ? describe : describe.skip;

// Quy tắc (DECISIONS D-21): so khớp nguyên từ, không phân biệt hoa thường.
// Từ đơn có dấu chỉ khớp khi giữ dấu ("đạn" không khớp "Đàn", "chó" không khớp "cho").
// Cụm nhiều từ và từ không dấu khớp cả khi người dùng gõ không dấu ("hang fake", "ma tuy").
d('bộ lọc từ khóa cấm và cần duyệt', () => {
  let c: pg.Client;
  beforeAll(async () => { c = await connect(); });
  afterAll(async () => { await c?.end(); });

  const cases: [string, 'block' | 'flag' | null][] = [
    // Không được bắt nhầm
    ['Đàn ukulele gỗ', null],
    ['Đồ chơi cho bé', null],
    ['Nhanh chóng, giao tận nơi', null],
    ['Hàng thuộc bộ sưu tập', null],
    ['Dan guitar acoustic', null],
    ['iPhone 15 128GB', null],
    ['Sách Đắc nhân tâm', null],
    ['Áo khoác dáng suông', null],
    // Phải chặn
    ['Súng hơi', 'block'],
    ['Ma túy', 'block'],
    ['ma tuy', 'block'],
    ['VAPE pod mới', 'block'],
    ['hàng super fake', 'block'],
    ['hang fake loai 1', 'block'],
    ['Bán acc game Liên Quân', 'block'],
    ['thuoc la dien tu', 'block'],
    // Phải chờ duyệt
    ['Thuốc nhuộm tóc', 'flag'],
    ['Bán chó Poodle', 'flag'],
    ['rep 1:1 like auth', 'flag'],
    ['Nhận thanh toán USDT', 'flag'],
  ];
  it.each(cases)('"%s" -> %s', async (text, expected) => {
    const r = await rows<{ s: string | null }>(c, 'select banned_keyword_severity($1)::text as s', [text]);
    expect(r[0].s).toBe(expected);
  });

  it('chặn ưu tiên hơn cần duyệt khi có cả hai', async () => {
    const r = await rows<{ s: string }>(c, 'select banned_keyword_severity($1)::text as s', ['Bán chó kèm súng']);
    expect(r[0].s).toBe('block');
  });

  it('ký tự đặc biệt trong từ khóa không làm hỏng biểu thức chính quy', async () => {
    const r = await rows<{ s: string | null }>(c, 'select banned_keyword_severity($1)::text as s', ['rep 1x1 [hàng] (mới) .*']);
    expect(r[0].s).toBeNull();
  });
});
