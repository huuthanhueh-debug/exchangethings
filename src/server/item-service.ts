import 'server-only';
import { randomUUID } from 'node:crypto';
import { elevate, withActor, type Actor, type Tx } from './db';
import { storage, thumbPathOf } from './storage';
import type { ProcessedImage } from './images';
import type { ItemInput } from '@/lib/validation/item';
import type { ItemStatus } from '@/lib/items';

// Ghi món. Ảnh đã qua processPhoto (xóa EXIF) trước khi tới đây.
// Thứ tự: tải ảnh lên kho trước, rồi một transaction ngắn ghi database; database lỗi thì xóa ảnh vừa tải.
// Dòng item_media chỉ server ghi (người dùng không có quyền INSERT), qua elevate() sau khi đã kiểm tra sở hữu.

export class ItemActionError extends Error {}

// Thông báo lỗi từ trigger/hàm database, dịch sang tiếng Việt cho người dùng.
const DB_MESSAGES: [RegExp, string][] = [
  [/at least 3 photos/, 'Hàng vật lý cần ít nhất 3 ảnh sản phẩm.'],
  [/proof of authenticity/, 'Danh mục hàng hiệu cần ảnh chứng từ (hóa đơn hoặc thẻ bảo hành).'],
  [/IMEI and a sign-out/, 'Điện thoại cần IMEI và xác nhận máy đã thoát iCloud hoặc tài khoản Google.'],
  [/banned keyword/, 'Tên hoặc mô tả có từ ngữ không được phép đăng trên Exchangethings.vn. Sửa lại rồi thử lần nữa.'],
  [/account is banned/, 'Tài khoản của bạn đang bị khóa, chưa đăng món được.'],
  [/is already/, 'Món này đã được đăng rồi.'],
  [/withdraw the item before changing its category/, 'Gỡ món trước khi đổi danh mục.'],
  [/items_ready_rules/, 'Món còn thiếu thông tin bắt buộc của loại này.'],
  [/not found|not withdrawable/, 'Không tìm thấy món, hoặc món đang ở trạng thái không đổi được.'],
  [/row-level security|permission denied/, 'Bạn không có quyền thực hiện thao tác này.'],
];

export function friendlyDbError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  for (const [re, text] of DB_MESSAGES) if (re.test(msg)) return text;
  return 'Có lỗi khi lưu. Thử lại sau ít phút.';
}

type Upload = { image: ProcessedImage; kind: 'photo' | 'proof' };

async function uploadAll(ownerId: string, uploads: Upload[]) {
  const stored: { path: string; upload: Upload }[] = [];
  try {
    for (const upload of uploads) {
      const path = `items/${ownerId}/${randomUUID()}.webp`;
      stored.push({ path, upload });
      await storage().put('item-media', path, upload.image.data, upload.image.contentType);
      await storage().put('item-media', thumbPathOf(path), upload.image.thumb, upload.image.contentType);
    }
    return stored;
  } catch (e) {
    await removeFiles(stored.map((s) => s.path));
    throw e;
  }
}

/** Xóa ảnh chính và bản thu nhỏ; lỗi xóa không chặn luồng chính. */
async function removeFiles(paths: string[]) {
  if (paths.length === 0) return;
  await storage().remove('item-media', paths.flatMap((p) => [p, thumbPathOf(p)])).catch(() => {});
}

async function insertMedia(tx: Tx, actor: Actor & { kind: 'user' }, itemId: string, stored: { path: string; upload: Upload }[], sortStart: number) {
  await elevate(tx, actor, async () => {
    let sort = sortStart;
    for (const { path, upload } of stored) {
      await tx.query(
        `insert into item_media (item_id, owner_id, kind, storage_path, width, height, exif_stripped, sort)
         values ($1, $2, $3, $4, $5, $6, true, $7)`,
        [itemId, actor.id, upload.kind, path, upload.image.width, upload.image.height, upload.kind === 'photo' ? sort++ : 0]);
    }
  });
}

async function writeWantsAndImei(tx: Tx, userId: string, itemId: string, input: ItemInput, replace: boolean) {
  if (replace) await tx.query('delete from item_wants where item_id = $1', [itemId]);
  for (const c of input.wants.categories) {
    await tx.query(`insert into item_wants (item_id, want_type, category_id) values ($1, 'category', $2)`, [itemId, c]);
  }
  for (const k of input.wants.keywords) {
    await tx.query(`insert into item_wants (item_id, want_type, keyword) values ($1, 'keyword', $2)`, [itemId, k]);
  }
  if (input.imei) {
    await tx.query(
      `insert into item_private (item_id, owner_id, imei_full) values ($1, $2, $3)
       on conflict (item_id) do update set imei_full = excluded.imei_full`, [itemId, userId, input.imei]);
  }
}

const ITEM_FIELDS = [
  'category_id', 'title', 'description', 'condition', 'est_value_vnd', 'topup_pay_max_vnd', 'topup_receive_max_vnd',
  'sell_price_vnd', 'delivery_methods', 'province_code', 'expires_on', 'signed_out_confirmed', 'transfer_right_confirmed',
  'duration_minutes',
] as const;

function fieldValues(input: ItemInput): unknown[] {
  return [
    input.category_id, input.title, input.description, input.condition, input.est_value_vnd, input.topup_pay_max_vnd,
    input.topup_receive_max_vnd, input.sell_price_vnd, `{${input.delivery_methods.join(',')}}`, input.province_code,
    input.expires_on, input.signed_out_confirmed, input.transfer_right_confirmed, input.duration_minutes,
  ];
}

/** Tạo món nháp kèm ảnh. Trả id món. */
export async function createDraftItem(userId: string, input: ItemInput, photos: ProcessedImage[], proofs: ProcessedImage[]): Promise<string> {
  const actor = { kind: 'user' as const, id: userId };
  const stored = await uploadAll(userId, [
    ...photos.map((image) => ({ image, kind: 'photo' as const })),
    ...proofs.map((image) => ({ image, kind: 'proof' as const })),
  ]);
  try {
    return await withActor(actor, async (tx) => {
      const cols = ['owner_id', 'type', ...ITEM_FIELDS];
      const r = await tx.query<{ id: string }>(
        `insert into items (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
        [userId, input.type, ...fieldValues(input)]);
      const itemId = r.rows[0].id;
      await writeWantsAndImei(tx, userId, itemId, input, false);
      await insertMedia(tx, actor, itemId, stored, 0);
      return itemId;
    });
  } catch (e) {
    await removeFiles(stored.map((s) => s.path));
    throw e;
  }
}

/** Sửa món (RLS chỉ cho chủ món sửa khi món ở nháp, chờ duyệt, đang hiển thị hoặc đã gỡ). */
export async function updateItem(userId: string, itemId: string, input: ItemInput): Promise<void> {
  await withActor({ kind: 'user', id: userId }, async (tx) => {
    const r = await tx.query(
      `update items set ${ITEM_FIELDS.map((f, i) => `${f} = $${i + 2}`).join(', ')}
        where id = $1 and type = $${ITEM_FIELDS.length + 2}`, // updated_at do trigger set_updated_at đặt
      [itemId, ...fieldValues(input), input.type]);
    if (r.rowCount !== 1) throw new ItemActionError('Không sửa được món này.');
    await writeWantsAndImei(tx, userId, itemId, input, true);
  });
}

/** Thêm ảnh vào món của chính mình. */
export async function addItemMedia(userId: string, itemId: string, photos: ProcessedImage[], proofs: ProcessedImage[]): Promise<void> {
  const actor = { kind: 'user' as const, id: userId };
  // Kiểm tra sở hữu dưới quyền người dùng trước khi tải gì lên.
  const owned = await withActor(actor, async (tx) => {
    const r = await tx.query<{ n: number }>(
      `select (select count(*)::int from item_media m where m.item_id = i.id and m.kind = 'photo') as n
         from items i where i.id = $1 and i.owner_id = auth.uid() and i.status in ('draft', 'pending_review', 'active', 'removed')`, [itemId]);
    return r.rows[0];
  });
  if (!owned) throw new ItemActionError('Không tìm thấy món của bạn.');
  if (owned.n + photos.length > 10) throw new ItemActionError('Mỗi món tối đa 10 ảnh sản phẩm.');
  const stored = await uploadAll(userId, [
    ...photos.map((image) => ({ image, kind: 'photo' as const })),
    ...proofs.map((image) => ({ image, kind: 'proof' as const })),
  ]);
  try {
    await withActor(actor, (tx) => insertMedia(tx, actor, itemId, stored, owned.n));
  } catch (e) {
    await removeFiles(stored.map((s) => s.path));
    throw e;
  }
}

/** Xóa ảnh: chỉ khi món ở nháp hoặc đã gỡ (món đang hiển thị phải giữ đủ ảnh đã duyệt). */
export async function deleteItemMedia(userId: string, mediaId: string): Promise<string> {
  const actor = { kind: 'user' as const, id: userId };
  const removed = await withActor(actor, async (tx) => {
    const r = await tx.query<{ storage_path: string; item_id: string }>(
      `select m.storage_path, m.item_id from item_media m join items i on i.id = m.item_id
        where m.id = $1 and m.owner_id = auth.uid() and i.owner_id = auth.uid() and i.status in ('draft', 'removed')`, [mediaId]);
    const row = r.rows[0];
    if (!row) return null;
    await elevate(tx, actor, () => tx.query('delete from item_media where id = $1', [mediaId]));
    return row;
  });
  if (!removed) throw new ItemActionError('Chỉ xóa được ảnh của món nháp hoặc món đã gỡ.');
  await removeFiles([removed.storage_path]);
  return removed.item_id;
}

export async function publishItem(userId: string, itemId: string): Promise<ItemStatus> {
  return withActor({ kind: 'user', id: userId }, async (tx) => {
    const r = await tx.query<{ s: ItemStatus }>('select publish_item($1)::text as s', [itemId]);
    return r.rows[0].s;
  });
}

export async function withdrawItem(userId: string, itemId: string): Promise<void> {
  await withActor({ kind: 'user', id: userId }, (tx) => tx.query('select withdraw_item($1)', [itemId]));
}
