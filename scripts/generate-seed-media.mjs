// Sinh ảnh minh họa cho các dòng item_media của dữ liệu mẫu vào kho local (STORAGE_DRIVER=local).
// Ảnh ghi rõ "ảnh minh họa" để không bị nhầm là ảnh thật. Chỉ dùng cho máy dev.
// Chạy: node scripts/generate-seed-media.mjs [--force]   (thư mục: LOCAL_STORAGE_DIR, mặc định .data/storage)
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { seedMediaManifest } from './generate-seed.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const storageDir = resolve(root, process.env.LOCAL_STORAGE_DIR ?? '.data/storage');
const force = process.argv.includes('--force');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return `#${[f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

function wrap(text, max) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if ((line + ' ' + word).trim().length > max && line) { lines.push(line); line = word; }
    else line = (line + ' ' + word).trim();
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

function photoSvg({ title, n, k }) {
  const hue = [168, 200, 28, 340, 255, 95, 45][n % 7] + k * 8;
  const bg1 = hslToHex(hue, 42, 90), bg2 = hslToHex(hue, 38, 74), ink = hslToHex(hue, 45, 16), soft = hslToHex(hue, 50, 96);
  const lines = wrap(title, 16);
  const startY = 760 - (lines.length - 1) * 52;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500" viewBox="0 0 1200 1500">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient></defs>
  <rect width="1200" height="1500" fill="url(#g)"/>
  <circle cx="${900 - k * 120}" cy="${300 + k * 90}" r="${260 - k * 30}" fill="${soft}" fill-opacity="0.45"/>
  <circle cx="${200 + k * 80}" cy="1180" r="180" fill="${soft}" fill-opacity="0.3"/>
  ${lines.map((l, i) => `<text x="96" y="${startY + i * 104}" font-family="Be Vietnam Pro, DejaVu Sans, sans-serif" font-size="86" font-weight="700" fill="${ink}">${esc(l)}</text>`).join('\n  ')}
  <text x="96" y="1392" font-family="Be Vietnam Pro, DejaVu Sans, sans-serif" font-size="40" fill="${ink}" fill-opacity="0.75">Ảnh minh họa ${k}/3 · dữ liệu mẫu</text>
</svg>`;
}

function proofSvg({ title }) {
  const lines = wrap(`Hóa đơn: ${title}`, 22);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">
  <rect width="1200" height="1600" fill="#e9edf1"/>
  <rect x="120" y="120" width="960" height="1360" rx="24" fill="#ffffff" stroke="#c9d2da" stroke-width="4"/>
  <text x="200" y="300" font-family="DejaVu Sans, sans-serif" font-size="64" font-weight="700" fill="#15202b">HÓA ĐƠN MUA HÀNG</text>
  ${lines.map((l, i) => `<text x="200" y="${440 + i * 70}" font-family="DejaVu Sans, sans-serif" font-size="48" fill="#445260">${esc(l)}</text>`).join('\n  ')}
  ${[0, 1, 2, 3, 4].map((i) => `<rect x="200" y="${760 + i * 90}" width="${800 - i * 60}" height="28" rx="14" fill="#dbe2e8"/>`).join('\n  ')}
  <text x="200" y="1400" font-family="DejaVu Sans, sans-serif" font-size="40" fill="#5e6b78">Ảnh chứng từ minh họa · dữ liệu mẫu</text>
</svg>`;
}

let written = 0;
let skipped = 0;
for (const m of seedMediaManifest()) {
  const out = join(storageDir, 'item-media', m.path);
  const thumbOut = out.replace(/\.webp$/, '.thumb.webp');
  if (!force && existsSync(out) && existsSync(thumbOut)) { skipped++; continue; }
  mkdirSync(dirname(out), { recursive: true });
  const svg = Buffer.from(m.kind === 'proof' ? proofSvg(m) : photoSvg(m));
  const main = await sharp(svg).webp({ quality: 80 }).toBuffer();
  await sharp(main).toFile(out);
  await sharp(main).resize({ width: 480, height: 480, fit: 'inside' }).webp({ quality: 74 }).toFile(thumbOut);
  written++;
}
console.log(`seed media: ${written} written, ${skipped} skipped -> ${storageDir}/item-media/seed`);
