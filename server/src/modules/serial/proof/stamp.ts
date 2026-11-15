import { appError } from '@server/core/errors';
import { ELLIPSIS, GLYPH_HEIGHT, GLYPH_WIDTH, glyphOf, MIDDLE_DOT } from './font';
import { decodePngRgba, encodePngRgba } from './png';

/**
 * Cap foto bukti QC (rancangan 2026-11-16 §5.3 dan §6.3): footer hitam DITAMBAHKAN di bawah foto (isi foto tidak
 * tertutup) berisi empat baris teks putih dari font bitmap tertanam. Fungsi murni (tanpa basis data/jaringan) dan tanpa
 * dependensi gambar: `Bun.Image` hanya dipakai untuk membaca JPEG/PNG/WebP, mengubahnya ke PNG, dan menulis WebP.
 */

/** Data cap yang dibekukan saat Simpan (`serial_proof_photos.snapshot_json`). */
export interface ProofSnapshot {
  serial: string;
  brand: string;
  model: string;
  buCode: string;
  locationName: string;
  actorName: string;
  actorTeam: 'qc' | 'service';
  /** Waktu Simpan menurut server (ISO UTC). */
  savedAt: string;
}

/**
 * Batas piksel gambar yang diproses (4,2 juta, setara 2048 x 2048; browser selalu mengirim sisi <= 1600); lebih dari ini
 * ditolak SEBELUM menginflate/mengalokasikan, di unggahan DAN di `stampPhoto`. Menggambar cap memegang beberapa salinan
 * RGBA penuh sekaligus (+~110 MB pada 4,2 MP; terukur +595 MB pada 36 MP), jadi batas ini yang menjaga puncak memori di
 * bawah `mem_limit` `qc-app` (256 MB).
 */
export const PROOF_MAX_PIXELS = 4_200_000;
/** Sisi terpanjang yang diterima (piksel); gambar sangat lebar/tinggi membuat kanvas cap (footer menurut LEBAR) membengkak. */
export const PROOF_MAX_SIDE = 4000;
/** Batas luas kanvas hasil (gambar + footer), dalam piksel: 1,25 x `PROOF_MAX_PIXELS`. Ini yang menahan puncak memori cap. */
export const PROOF_MAX_CANVAS_PIXELS = 5_250_000;
/** Pesan galat ukuran (deterministik: bukan gangguan sementara). */
export const PROOF_TOO_LARGE_MESSAGE = 'Dimensi gambar terlalu besar';
/** Kualitas WebP tetap. */
export const PROOF_WEBP_QUALITY = 85;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const WIB_OFFSET_MS = 7 * 3_600_000;
const TEAM_LABEL = { qc: 'QC', service: 'Servis' } as const;

/**
 * Teks aman untuk font: huruf Latin bersandi dilipat ke huruf dasar (NFD), karakter kontrol dan pengatur arah teks
 * dibuang, karakter lain di luar ASCII cetak menjadi `?` (satu per titik kode), spasi beruntun diringkas.
 */
export function foldForStamp(text: string): string {
  let out = '';
  for (const char of text.normalize('NFD')) {
    const code = char.codePointAt(0) as number;
    if (code >= 0x300 && code <= 0x36f) continue; // tanda gabung hasil dekomposisi
    // kontrol C0/C1, DEL, pemisah baris/paragraf, pengatur arah dan lebar-nol
    if (
      code < 0x20 ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x2028 ||
      code === 0x2029 ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2060 && code <= 0x206f) ||
      code === 0xfeff
    ) {
      continue;
    }
    out += code <= 0x7e ? char : '?';
  }
  return out.replace(/ {2,}/g, ' ').trim();
}

/** Tanggal-jam WIB dari ISO UTC, mis. `16 Nov 2026 14:32`; ISO tak sah = `-`. */
function wibStamp(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '-';
  const d = new Date(ms + WIB_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Empat baris cap persis rancangan §5.3. Isian dilipat lewat `foldForStamp`; pemotongan menurut lebar dilakukan saat menggambar. */
export function stampLines(snapshot: ProofSnapshot): string[] {
  const f = foldForStamp;
  return [
    `SN: ${f(snapshot.serial)}`,
    `${f(snapshot.brand)} ${f(snapshot.model)}`.trim(),
    `${f(snapshot.buCode)} ${MIDDLE_DOT} ${f(snapshot.locationName)}`,
    `Disimpan ${wibStamp(snapshot.savedAt)} WIB ${MIDDLE_DOT} ${f(snapshot.actorName)} (${TEAM_LABEL[snapshot.actorTeam]})`,
  ];
}

/** Skala piksel glyph menurut lebar gambar (terbaca di 640 sampai 4000 px). */
export function stampScale(width: number): number {
  return Math.max(1, Math.round(width / 400));
}

const LINE_COUNT = 4;

/** Tinggi footer (piksel) untuk gambar selebar `width`: bantalan atas/bawah + empat baris + jarak antarbaris. */
export function stampFooterHeight(width: number): number {
  const s = stampScale(width);
  return 2 * 3 * s + LINE_COUNT * GLYPH_HEIGHT * s + (LINE_COUNT - 1) * 2 * s;
}

/**
 * Galat ukuran gambar (atau `null` bila boleh diproses), dihitung dari lebar/tinggi header SEBELUM alokasi apa pun:
 * sisi terpanjang <= `PROOF_MAX_SIDE`, luas <= `PROOF_MAX_PIXELS`, dan luas kanvas hasil (lebar x (tinggi + footer))
 * <= `PROOF_MAX_CANVAS_PIXELS`. Dipakai unggah, `stampPhoto`, dan keputusan boleh-tidaknya "Coba lagi".
 */
export function proofSizeError(width: number, height: number): string | null {
  if (width > PROOF_MAX_SIDE || height > PROOF_MAX_SIDE) return PROOF_TOO_LARGE_MESSAGE;
  if (width * height > PROOF_MAX_PIXELS) return PROOF_TOO_LARGE_MESSAGE;
  if (width * (height + stampFooterHeight(width)) > PROOF_MAX_CANVAS_PIXELS) {
    return PROOF_TOO_LARGE_MESSAGE;
  }
  return null;
}

/** Memotong baris agar muat `maxChars` karakter; yang terpotong diakhiri elipsis. */
export function fitStampLine(line: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  const chars = [...line];
  if (chars.length <= maxChars) return line;
  return `${chars.slice(0, maxChars - 1).join('')}${ELLIPSIS}`;
}

/** Menggambar footer ke `rgba` mulai baris `top`: latar hitam, glyph putih (tanpa antialias). */
function drawFooter(
  rgba: Uint8Array,
  width: number,
  top: number,
  height: number,
  lines: string[],
): void {
  const s = stampScale(width);
  const pad = 3 * s;
  // Latar hitam buram.
  for (let i = top * width * 4; i < (top + height) * width * 4; i += 4) {
    rgba[i] = 0;
    rgba[i + 1] = 0;
    rgba[i + 2] = 0;
    rgba[i + 3] = 255;
  }
  const cell = (GLYPH_WIDTH + 1) * s;
  const maxChars = Math.floor((width - 2 * pad) / cell);
  lines.forEach((raw, lineIndex) => {
    const text = fitStampLine(raw, maxChars);
    const baseY = top + pad + lineIndex * (GLYPH_HEIGHT + 2) * s;
    let column = 0;
    for (const char of text) {
      const glyph = glyphOf(char) ?? glyphOf('?');
      if (glyph) {
        for (let row = 0; row < GLYPH_HEIGHT; row++) {
          const bits = glyph[row] as number;
          if (bits === 0) continue;
          for (let col = 0; col < GLYPH_WIDTH; col++) {
            if ((bits & (1 << (GLYPH_WIDTH - 1 - col))) === 0) continue;
            const x0 = pad + column * cell + col * s;
            const y0 = baseY + row * s;
            for (let dy = 0; dy < s; dy++) {
              let index = ((y0 + dy) * width + x0) * 4;
              for (let dx = 0; dx < s; dx++, index += 4) {
                rgba[index] = 255;
                rgba[index + 1] = 255;
                rgba[index + 2] = 255;
              }
            }
          }
        }
      }
      column++;
    }
  });
}

/** Piksel transparan dilebur ke latar putih (cap dan WebP keluaran selalu buram). */
function flattenOnWhite(rgba: Uint8Array): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const alpha = rgba[i + 3] as number;
    if (alpha === 255) continue;
    for (let c = 0; c < 3; c++) {
      rgba[i + c] = Math.round(((rgba[i + c] as number) * alpha + 255 * (255 - alpha)) / 255);
    }
    rgba[i + 3] = 255;
  }
}

function unreadable(): never {
  throw appError('VALIDATION', 'Berkas bukan gambar yang dapat diproses');
}

/**
 * Membubuhkan cap. Masukan JPEG/PNG/WebP (apa pun lainnya, termasuk sampah, `VALIDATION`); gambar melebihi
 * `PROOF_MAX_PIXELS` ditolak dari header tanpa decode. Keluaran WebP tanpa metadata dengan tinggi = tinggi asal + footer.
 */
export async function stampPhoto(input: {
  bytes: Uint8Array;
  snapshot: ProofSnapshot;
}): Promise<{ bytes: Uint8Array; mime: 'image/webp'; width: number; height: number }> {
  let meta: { width: number; height: number; format: string };
  try {
    meta = await new Bun.Image(input.bytes).metadata();
  } catch {
    return unreadable();
  }
  if (meta.format !== 'jpeg' && meta.format !== 'png' && meta.format !== 'webp')
    return unreadable();
  if (meta.width < 1 || meta.height < 1) return unreadable();
  const sizeError = proofSizeError(meta.width, meta.height);
  if (sizeError !== null) throw appError('VALIDATION', sizeError);
  let png: Uint8Array;
  try {
    png = await new Bun.Image(input.bytes, { maxPixels: PROOF_MAX_PIXELS }).png().bytes();
  } catch {
    return unreadable();
  }
  const source = await decodePngRgba(png, PROOF_MAX_PIXELS);
  flattenOnWhite(source.rgba);
  const footer = stampFooterHeight(source.width);
  const height = source.height + footer;
  const rgba = new Uint8Array(source.width * height * 4);
  rgba.set(source.rgba, 0);
  drawFooter(rgba, source.width, source.height, footer, stampLines(input.snapshot));
  const stamped = await encodePngRgba({ width: source.width, height, rgba });
  let webp: Uint8Array;
  try {
    webp = await new Bun.Image(stamped, { maxPixels: PROOF_MAX_CANVAS_PIXELS })
      .webp({ quality: PROOF_WEBP_QUALITY })
      .bytes();
  } catch {
    return unreadable();
  }
  return { bytes: webp, mime: 'image/webp', width: source.width, height };
}
