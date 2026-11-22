import 'server-only';
import sharp, { type Metadata } from 'sharp';

// Xử lý ảnh tải lên (SPEC mục 15: xóa EXIF). Mọi ảnh đi qua đây trước khi lưu:
// 1. Đọc định dạng thật từ nội dung tệp, không tin phần mở rộng hay MIME do trình duyệt gửi.
// 2. Xoay theo thẻ EXIF Orientation để ảnh đứng đúng chiều, sau đó bỏ toàn bộ metadata
//    (EXIF gồm vị trí GPS, dòng máy, XMP, IPTC). sharp chỉ giữ metadata khi gọi withMetadata/keepMetadata.
// 3. Thu nhỏ về tối đa 1600px mỗi cạnh và xuất WebP để trang tải nhanh trên di động.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // platform_settings.upload_limits.max_photo_mb
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif', 'heif']);
const MIN_SIDE = 200;

export type ImageErrorCode = 'too_large' | 'unsupported' | 'too_small' | 'corrupt';

export class ImageError extends Error {
  constructor(public readonly code: ImageErrorCode) {
    super(IMAGE_ERROR_MESSAGE[code]);
    this.name = 'ImageError';
  }
}

export const IMAGE_ERROR_MESSAGE: Record<ImageErrorCode, string> = {
  too_large: 'Ảnh lớn hơn 10 MB.',
  unsupported: 'Chỉ nhận ảnh JPEG, PNG, WebP hoặc AVIF.',
  too_small: 'Ảnh quá nhỏ, cần ít nhất 200 × 200 điểm ảnh.',
  corrupt: 'Không đọc được ảnh, tệp có thể bị hỏng.',
};

export type ProcessedImage = {
  data: Buffer;
  width: number;
  height: number;
  contentType: 'image/webp';
  /** Bản nhỏ cho lưới món (cạnh dài tối đa 480px), tạo từ ảnh đã xóa metadata. */
  thumb: Buffer;
};

export const THUMB_SIDE = 480;

export async function processPhoto(input: Uint8Array, { maxSide = 1600 } = {}): Promise<ProcessedImage> {
  if (input.byteLength > MAX_UPLOAD_BYTES) throw new ImageError('too_large');
  let meta: Metadata;
  try {
    meta = await sharp(input, { failOn: 'error' }).metadata();
  } catch {
    throw new ImageError('corrupt');
  }
  if (!meta.format || !ACCEPTED_FORMATS.has(meta.format)) throw new ImageError('unsupported');
  if ((meta.width ?? 0) < MIN_SIDE || (meta.height ?? 0) < MIN_SIDE) throw new ImageError('too_small');

  try {
    const { data, info } = await sharp(input, { failOn: 'error', limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    const thumb = await sharp(data)
      .resize({ width: THUMB_SIDE, height: THUMB_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 76 })
      .toBuffer();
    return { data, width: info.width, height: info.height, contentType: 'image/webp', thumb };
  } catch {
    throw new ImageError('corrupt');
  }
}
