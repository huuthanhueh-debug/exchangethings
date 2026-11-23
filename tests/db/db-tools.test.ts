import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { dbTestsEnabled } from './helpers';
import { BASELINE_VERSION, ROOT, buildSetupSql, buildUpgradeSql, doctor, formatReport, loadMigrations, migrate } from '../../scripts/lib/db-tools.mjs';

// Kênh cài database không cần token Supabase: bộ chạy migration, lệnh khám, file setup.sql.
// Mỗi test dùng một database tạm có cùng vai trò và mặc định như Supabase (tests/db/shim.sql).
const d = dbTestsEnabled ? describe : describe.skip;
const ADMIN = process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
const SHIM = readFileSync(join(ROOT, 'tests/db/shim.sql'), 'utf8');
const migrations = loadMigrations();

d('cài database không cần token Supabase', () => {
  const names: string[] = [];
  const open: pg.Client[] = [];
  let seq = 0;
  const adminRun = async (sql: string) => {
    const a = new pg.Client({ connectionString: ADMIN });
    await a.connect();
    try { await a.query(sql); } finally { await a.end(); }
  };
  async function connectTo(name: string) {
    const url = new URL(ADMIN);
    url.pathname = `/${name}`;
    const c = new pg.Client({ connectionString: url.toString() });
    await c.connect();
    open.push(c);
    return c;
  }
  async function scratch({ shim = true } = {}) {
    const name = `exchangethings_tools_${process.pid}_${++seq}`;
    await adminRun(`drop database if exists ${name} with (force)`);
    await adminRun(`create database ${name}`);
    names.push(name);
    const c = await connectTo(name);
    if (shim) await c.query(SHIM);
    return { c, name };
  }
  const ledger = async (c: pg.Client) => (await c.query('select version from app_meta.migrations order by 1')).rows.map((r) => r.version);
  const failed = (r: Awaited<ReturnType<typeof doctor>>) => r.filter((x) => x.ok === false).map((x) => x.id);

  afterAll(async () => {
    await Promise.all(open.map((c) => c.end().catch(() => {})));
    for (const n of names) await adminRun(`drop database if exists ${n} with (force)`);
  });

  it('database mới: chạy đủ migration theo thứ tự; chạy lại không làm gì; khám đạt', async () => {
    const { c } = await scratch();
    const first = await migrate(c, migrations);
    expect(first.ran).toEqual(migrations.map((m) => m.file));
    expect(await ledger(c)).toEqual(migrations.map((m) => m.version));
    expect((await migrate(c, migrations)).ran).toEqual([]);
    const report = await doctor(c, migrations, { loopback: true });
    expect(failed(report)).toEqual([]);
    expect(formatReport(report)).toContain('database sẵn sàng cho app');
  });

  it('--dry-run chỉ liệt kê, không tạo gì', async () => {
    const { c } = await scratch();
    const r = await migrate(c, migrations, { dryRun: true });
    expect(r.pending).toHaveLength(migrations.length);
    expect((await c.query(`select to_regnamespace('app_meta') is null as none, to_regclass('public.items') is null as no_items`)).rows[0])
      .toEqual({ none: true, no_items: true });
  });

  it('file migration bị sửa sau khi đã chạy thì từ chối, không đổi gì', async () => {
    const { c } = await scratch();
    await migrate(c, migrations);
    const edited = migrations.map((m, i) => (i === 1 ? { ...m, sql: `${m.sql}\n-- sửa lén`, checksum: 'khac' } : m));
    await expect(migrate(c, edited)).rejects.toThrow(/nội dung file đã đổi: 20261122000200_rls\.sql/);
    expect(await ledger(c)).toHaveLength(migrations.length);
  });

  it('migration lỗi giữa chừng: file đó không để lại gì, báo đúng file và dòng; sửa xong chạy tiếp được', async () => {
    const { c } = await scratch();
    const broken = { version: '20991231000000', name: 'thu_loi', file: '20991231000000_thu_loi.sql', checksum: 'x', sql: 'create table public.t_moi (id int);\nselec 1;' };
    await expect(migrate(c, [...migrations, broken])).rejects.toThrow(/20991231000000_thu_loi\.sql \(dòng 2\)[\s\S]*chưa được áp dụng/);
    expect((await c.query(`select to_regclass('public.t_moi') is null as gone`)).rows[0].gone).toBe(true);
    expect(await ledger(c)).toEqual(migrations.map((m) => m.version));
    // Lỗi lúc chạy (không phải lỗi cú pháp): lệnh trước đó đã chạy xong cũng phải được hoàn lại.
    const runtime = { ...broken, sql: 'create table public.t_moi (id int);\ninsert into public.t_moi values (1);\nselect 1/0;' };
    await expect(migrate(c, [...migrations, runtime])).rejects.toThrow(/division by zero[\s\S]*chưa được áp dụng/);
    expect((await c.query(`select to_regclass('public.t_moi') is null as gone`)).rows[0].gone).toBe(true);
    const fixed = { ...broken, sql: 'create table public.t_moi (id int);', checksum: 'y' };
    expect((await migrate(c, [...migrations, fixed])).ran).toEqual([fixed.file]);
  });

  it('hai lượt chạy cùng lúc: mỗi migration chỉ chạy một lần, không lượt nào lỗi', async () => {
    const { c, name } = await scratch();
    const c2 = await connectTo(name);
    const [a, b] = await Promise.all([migrate(c, migrations), migrate(c2, migrations)]);
    expect([...a.ran, ...b.ran].sort()).toEqual(migrations.map((m) => m.file));
    expect(await ledger(c)).toHaveLength(migrations.length);
  });

  it('database không phải Supabase: từ chối và không tạo gì', async () => {
    const { c } = await scratch({ shim: false });
    await expect(migrate(c, migrations)).rejects.toThrow(/không phải Supabase/);
    expect((await c.query(`select to_regnamespace('app_meta') is null as none`)).rows[0].none).toBe(true);
  });

  it('đã có bảng nhưng mất sổ migration: không chạy đè', async () => {
    const { c } = await scratch();
    await migrate(c, migrations);
    await c.query('truncate app_meta.migrations');
    await expect(migrate(c, migrations)).rejects.toThrow(/chưa có sổ migration/);
    await expect(migrate(c, migrations, { dryRun: true })).rejects.toThrow(/chưa có sổ migration/);
  });

  it('migration cũ hơn bản đã chạy và tên file sai mẫu đều bị từ chối', async () => {
    const { c } = await scratch();
    await migrate(c, migrations);
    const old = { version: '20200101000000', name: 'cu', file: '20200101000000_cu.sql', checksum: 'z', sql: 'select 1;' };
    await expect(migrate(c, [old, ...migrations])).rejects.toThrow(/cũ hơn bản đã chạy/);
    const dir = mkdtempSync(join(tmpdir(), 'et-mig-'));
    writeFileSync(join(dir, 'them-bang.sql'), 'select 1;');
    expect(() => loadMigrations(dir)).toThrow(/sai mẫu/);
    const dir2 = mkdtempSync(join(tmpdir(), 'et-mig-'));
    writeFileSync(join(dir2, '20991231000000_tu_commit.sql'), 'create table public.t (id int);\nCOMMIT;\nselect 1/0;');
    expect(() => loadMigrations(dir2)).toThrow(/tự điều khiển transaction/);
  });

  it('lệnh khám chỉ ra đúng chỗ hỏng', async () => {
    const { c } = await scratch();
    await migrate(c, migrations);
    const run = async () => doctor(c, migrations, { loopback: true });

    await c.query('alter table public.wards disable row level security');
    let r = await run();
    expect(failed(r)).toEqual(['rls']);
    expect(r.find((x) => x.id === 'rls')?.detail).toContain('wards');
    await c.query('alter table public.wards enable row level security');

    await c.query('grant execute on function public.banned_keyword_severity(text) to anon');
    r = await run();
    expect(failed(r)).toEqual(['functions']);
    expect(r.find((x) => x.id === 'functions')?.detail).toContain('khách gọi được banned_keyword_severity');
    await c.query('revoke execute on function public.banned_keyword_severity(text) from anon');

    await c.query('grant update (status) on public.items to authenticated');
    expect(failed(await run())).toEqual(['grants']);
    await c.query('revoke update (status) on public.items from authenticated');

    await c.query(`delete from public.wards where code = (select min(code) from public.wards)`);
    expect(failed(await run())).toEqual(['data']);

    const extra = { version: '20991231000000', name: 'moi', file: '20991231000000_moi.sql', checksum: 'x', sql: 'select 1;' };
    r = await doctor(c, [...migrations, extra], { loopback: true });
    expect(failed(r)).toContain('migrations');
    expect(formatReport(r)).toMatch(new RegExp(`✗ {2}Đã chạy đủ ${migrations.length + 1} migration: chưa chạy 20991231000000_moi\\.sql\\n\\s+Cách sửa: `));
  });

  it('lệnh khám báo khi tài khoản kết nối không chuyển được vai trò, và khi kết nối xa không có TLS', async () => {
    const { c } = await scratch();
    await migrate(c, migrations);
    const role = `tools_khong_quyen_${process.pid}`;
    await c.query(`drop role if exists ${role}`);
    await c.query(`create role ${role}`);
    try {
      await c.query(`set session authorization ${role}`);
      const r = await doctor(c, migrations, { loopback: true });
      expect(r.find((x) => x.id === 'roles')).toMatchObject({ ok: false });
    } finally {
      await c.query('reset session authorization');
      await c.query(`drop role ${role}`);
    }
    expect((await doctor(c, migrations, { tls: false, loopback: false })).find((x) => x.id === 'tls')?.ok).toBe(false);
    expect((await doctor(c, migrations, { tls: true, loopback: false })).find((x) => x.id === 'tls')?.ok).toBe(true);
  });

  it('setup.sql dán một lần là xong: bảng kết quả toàn true, khám đạt, sổ khớp với bộ chạy; dán lần hai bị từ chối', async () => {
    const { c } = await scratch();
    const sql = buildSetupSql(migrations);
    const results = (await c.query(sql)) as unknown as pg.QueryResult[];
    const table = results.at(-1)!.rows as { 'Kiểm tra': string; 'Đạt': boolean }[];
    expect(table.length).toBeGreaterThanOrEqual(5);
    expect(table.filter((row) => row['Đạt'] !== true)).toEqual([]);
    expect(failed(await doctor(c, migrations, { loopback: true }))).toEqual([]);
    expect((await migrate(c, migrations)).ran).toEqual([]);
    await expect(c.query(sql)).rejects.toThrow(/đã có bảng của Exchangethings\.vn/);
    await c.query('rollback');
    expect(await ledger(c)).toHaveLength(migrations.length);
  });

  describe('upgrade.sql: cập nhật project đã cài bản M1 bằng cách dán vào SQL Editor', () => {
    const m1 = migrations.filter((m) => m.version <= BASELINE_VERSION);
    const later = migrations.filter((m) => m.version > BASELINE_VERSION);
    const upgrade = buildUpgradeSql(migrations);
    const resultTable = (r: unknown) => (r as pg.QueryResult[]).at(-1)!.rows as { 'Kiểm tra': string; 'Đạt': boolean }[];

    it('bản M1 có 4 migration; các bản sau có ít nhất một file để cập nhật', () => {
      expect(m1.map((m) => m.version)).toEqual(['20261122000100', '20261122000200', '20261122000300', '20261122000310']);
      expect(later.length).toBeGreaterThanOrEqual(1);
      // Phần thân của bản M1 không nằm trong file cập nhật: file nhỏ, dán nhanh.
      expect(upgrade).not.toContain('create table public.profiles');
      expect(Buffer.byteLength(upgrade)).toBeLessThan(Buffer.byteLength(buildSetupSql(migrations)) / 3);
    });
    it('database đang ở bản M1: dán một lần là lên bản mới nhất, bảng kết quả toàn true, khám đạt', async () => {
      const { c } = await scratch();
      await migrate(c, m1);
      expect(await ledger(c)).toEqual(m1.map((m) => m.version));
      const table = resultTable(await c.query(upgrade));
      expect(table.length).toBeGreaterThanOrEqual(4);
      expect(table.filter((row) => row['Đạt'] !== true)).toEqual([]);
      expect(await ledger(c)).toEqual(migrations.map((m) => m.version));
      expect(failed(await doctor(c, migrations, { loopback: true }))).toEqual([]);
      // Sổ khớp với bộ chạy dòng lệnh: pnpm db:migrate không còn gì để chạy và không coi file nào là bị sửa.
      expect((await migrate(c, migrations)).ran).toEqual([]);
    });
    it('dán lần hai, hoặc dán vào database đã mới nhất: không làm gì, không lỗi', async () => {
      const { c } = await scratch();
      await migrate(c, migrations);
      const before = (await c.query('select version, applied_at from app_meta.migrations order by 1')).rows;
      for (let k = 0; k < 2; k++) expect(resultTable(await c.query(upgrade)).every((row) => row['Đạt'])).toBe(true);
      expect((await c.query('select version, applied_at from app_meta.migrations order by 1')).rows).toEqual(before);
    });
    it('database chưa cài gì: báo dùng setup.sql, không tạo gì', async () => {
      const { c } = await scratch();
      await expect(c.query(upgrade)).rejects.toThrow(/chưa cài Exchangethings\.vn/);
      await c.query('rollback');
      expect((await c.query(`select to_regnamespace('app_meta') is null as none, to_regclass('public.match_reads') is null as no_m2`)).rows[0])
        .toEqual({ none: true, no_m2: true });
    });
    it('bản đã cài khác bản M1 trong repo (thiếu file hoặc nội dung khác): dừng, không đổi gì', async () => {
      const { c } = await scratch();
      await migrate(c, m1);
      await c.query(`update app_meta.migrations set checksum = 'khac' where version = '20261122000200'`);
      await expect(c.query(upgrade)).rejects.toThrow(/không khớp bản M1: 20261122000200_rls\.sql \(nội dung khác bản trong repo\)/);
      await c.query('rollback');
      await c.query(`delete from app_meta.migrations where version = '20261122000310'`);
      await expect(c.query(upgrade)).rejects.toThrow(/20261122000200_rls\.sql \(nội dung khác bản trong repo\), 20261122000310_admin_units\.sql \(chưa chạy\)/);
      await c.query('rollback');
      expect((await c.query(`select to_regclass('public.match_reads') is null as no_m2`)).rows[0].no_m2).toBe(true);
    });
    it('migration mới lỗi giữa chừng: cả lượt cập nhật được hoàn lại', async () => {
      const { c } = await scratch();
      await migrate(c, m1);
      await c.query('create table public.match_reads (id int)'); // làm migration M2 vấp ở giữa
      await expect(c.query(upgrade)).rejects.toThrow(/match_reads.*already exists/);
      await c.query('rollback');
      expect(await ledger(c)).toEqual(m1.map((m) => m.version));
      expect((await c.query(`select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = 'swipes'`)).rows[0].n).toBe(0);
      expect((await c.query(`select to_regprocedure('public.swipe_item(uuid, public.swipe_direction)') is null as none`)).rows[0].none).toBe(true);
    });
    it('migration đã chạy nhưng nội dung khác bản trong repo: dừng', async () => {
      const { c } = await scratch();
      await migrate(c, migrations);
      await c.query(`update app_meta.migrations set checksum = 'khac' where version = $1`, [later[0].version]);
      await expect(c.query(upgrade)).rejects.toThrow(/đã chạy với nội dung khác bản trong repo/);
      await c.query('rollback');
    });
  });

  it('setup.sql trên database không phải Supabase: báo rõ, không tạo gì', async () => {
    const { c } = await scratch({ shim: false });
    await expect(c.query(buildSetupSql(migrations))).rejects.toThrow(/không phải project Supabase/);
    await c.query('rollback');
    expect((await c.query(`select to_regnamespace('app_meta') is null as none`)).rows[0].none).toBe(true);
  });
});
