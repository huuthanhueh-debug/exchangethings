// Danh mục loại món, tình trạng, cách giao: một nguồn duy nhất cho form, trang hiển thị và validation.
// Khớp các enum trong supabase/migrations/20261122000100_schema.sql và bảng SPEC mục 4.

export const ITEM_TYPES = ['physical', 'digital_file', 'course_code', 'voucher', 'service', 'other'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const CONDITIONS = ['new', 'like_new', 'good', 'fair', 'not_applicable'] as const;
export type Condition = (typeof CONDITIONS)[number];

export const DELIVERY_METHODS = ['carrier', 'meetup', 'digital', 'online_session'] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

export const ITEM_STATUSES = ['draft', 'pending_review', 'active', 'reserved', 'swapped', 'removed'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export type ItemTypeMeta = {
  label: string;
  example: string;
  /** Cách giao người dùng được chọn. Một phần tử duy nhất nghĩa là cố định, không hiện ô chọn. */
  delivery: readonly DeliveryMethod[];
  /** Số ảnh sản phẩm tối thiểu khi đăng (publish_item kiểm tra lại ở database). */
  minPhotos: number;
  hasCondition: boolean;
  needsExpiry: boolean;
  needsTransferRight: boolean;
  needsDuration: boolean;
  /** Món luôn qua admin duyệt trước khi hiển thị. */
  alwaysReviewed: boolean;
};

export const ITEM_TYPE_META: Record<ItemType, ItemTypeMeta> = {
  physical: {
    label: 'Hàng vật lý', example: 'Điện thoại, quần áo, giày, đồ gia dụng',
    delivery: ['carrier', 'meetup'], minPhotos: 3, hasCondition: true,
    needsExpiry: false, needsTransferRight: false, needsDuration: false, alwaysReviewed: false,
  },
  digital_file: {
    label: 'File số', example: 'Template, ebook, preset ảnh',
    delivery: ['digital'], minPhotos: 0, hasCondition: false,
    needsExpiry: false, needsTransferRight: true, needsDuration: false, alwaysReviewed: false,
  },
  course_code: {
    label: 'Mã khóa học', example: 'Mã kích hoạt khóa học online',
    delivery: ['digital'], minPhotos: 0, hasCondition: false,
    needsExpiry: true, needsTransferRight: true, needsDuration: false, alwaysReviewed: false,
  },
  voucher: {
    label: 'Voucher, mã giảm giá', example: 'Voucher mua sắm, vé, mã dịch vụ',
    delivery: ['digital'], minPhotos: 0, hasCondition: false,
    needsExpiry: true, needsTransferRight: true, needsDuration: false, alwaysReviewed: false,
  },
  service: {
    label: 'Dịch vụ, kiến thức', example: 'Một buổi dạy, tư vấn, làm hộ',
    delivery: ['meetup', 'online_session'], minPhotos: 0, hasCondition: false,
    needsExpiry: false, needsTransferRight: false, needsDuration: true, alwaysReviewed: false,
  },
  other: {
    label: 'Khác', example: 'Món hợp pháp khác, hiển thị sau khi admin duyệt',
    delivery: ['carrier', 'meetup', 'digital', 'online_session'], minPhotos: 0, hasCondition: true,
    needsExpiry: false, needsTransferRight: false, needsDuration: false, alwaysReviewed: true,
  },
};

export const CONDITION_LABEL: Record<Condition, string> = {
  new: 'Mới, chưa dùng',
  like_new: 'Như mới',
  good: 'Tốt, có dấu hiệu dùng',
  fair: 'Đã dùng nhiều',
  not_applicable: 'Không áp dụng',
};

export const DELIVERY_LABEL: Record<DeliveryMethod, string> = {
  carrier: 'Gửi qua đơn vị vận chuyển',
  meetup: 'Gặp trực tiếp',
  digital: 'Giao qua két số',
  online_session: 'Buổi online',
};

export const STATUS_LABEL: Record<ItemStatus, string> = {
  draft: 'Nháp',
  pending_review: 'Chờ duyệt',
  active: 'Đang hiển thị',
  reserved: 'Đang giao dịch',
  swapped: 'Đã đổi xong',
  removed: 'Đã gỡ',
};

export const DURATION_OPTIONS = [30, 45, 60, 90, 120, 180, 240] as const;

export const MAX_WANTS = 5;

export function isItemType(v: unknown): v is ItemType {
  return typeof v === 'string' && (ITEM_TYPES as readonly string[]).includes(v);
}

/** Số ngày còn lại tới hạn dùng, tính theo ngày lịch (cả hai đều là chuỗi YYYY-MM-DD). */
export function daysUntil(expiresOn: string, today: string): number {
  const ms = Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** Ngày hôm nay theo giờ Việt Nam (UTC+7, không có giờ mùa hè), dạng YYYY-MM-DD. */
export function todayInVietnam(now: Date = new Date()): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}
