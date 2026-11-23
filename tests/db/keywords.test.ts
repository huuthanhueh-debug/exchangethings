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
    // Lách bằng cách viết mà mắt người vẫn đọc như thường (rà soát độc lập, DECISIONS D-27)
    ['ma  túy', 'block'],                         // hai khoảng trắng
    ['ma\u00a0túy', 'block'],                     // khoảng trắng không ngắt dòng
    ['ma\ttúy', 'block'],
    ['ma\ntúy', 'block'],
    ['va\u200bpe', 'block'],                      // ký tự zero-width giữa chữ
    ['va\u00adpe', 'block'],                      // soft hyphen
    ['su\u0301ng hơi', 'block'],                  // dấu rời (NFD)
    ['v\u0336a\u0336p\u0336e\u0336', 'block'],    // gạch ngang chồng lên chữ
    ['vаpe', 'block'],                            // chữ "а" Cyrillic
    ['ｖａｐｅ', 'block'],                          // chữ fullwidth
    ['vape2', 'block'],
    ['crack2024 full', 'block'],
    ['(vape)', 'block'],
    ['vape🔥', 'block'],
    ['hàng-fake', 'block'],
    ['hàng_fake', 'block'],
    ['SÚNG HƠI', 'block'],
    ['MA TUY', 'block'],
    // Chuẩn hóa không được gây bắt nhầm
    ['Nhạc mp3 và 4G', null],
    ['Vaper cũ', null],
    ['Xe ma. Túy lúy thì thôi', 'block'],          // cùng một đoạn văn: dấu chấm không ngăn được cụm từ
  ];
  it.each(cases)('"%s" -> %s', async (text, expected) => {
    const r = await rows<{ s: string | null }>(c, 'select banned_keyword_severity($1)::text as s', [text]);
    expect(r[0].s).toBe(expected);
  });

  it('chặn ưu tiên hơn cần duyệt khi có cả hai', async () => {
    const r = await rows<{ s: string }>(c, 'select banned_keyword_severity($1)::text as s', ['Bán chó kèm súng']);
    expect(r[0].s).toBe('block');
  });

  it('tên và mô tả được xét riêng: chữ cuối tên không ghép với chữ đầu mô tả', async () => {
    const r = await rows<{ joined: string | null; apart: string | null }>(c,
      `select banned_keyword_severity('Xe ma' || ' ' || 'túy lúy')::text as joined, texts_severity('Xe ma', 'túy lúy')::text as apart`);
    expect(r[0]).toEqual({ joined: 'block', apart: null });
  });

  it('ký tự đặc biệt trong từ khóa không làm hỏng biểu thức chính quy', async () => {
    const r = await rows<{ s: string | null }>(c, 'select banned_keyword_severity($1)::text as s', ['rep 1x1 [hàng] (mới) .*']);
    expect(r[0].s).toBeNull();
  });
});
