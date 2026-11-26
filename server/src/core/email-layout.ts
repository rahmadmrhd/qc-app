/**
 * Pembantu tata letak surel HTML notifikasi (Serial rusak, ringkasan stok, peringatan Postel). Dirancang agar terbaca di
 * banyak klien dan ukuran layar: tata letak tabel (`role="presentation"`) dengan atribut `width`/`bgcolor` sebagai
 * cadangan untuk Outlook desktop, gaya inline, satu blok `<style>` yang HANYA berisi `@media (max-width:480px)`, tombol
 * "bulletproof" berbasis tabel, preheader tersembunyi, dan warna tidak murni (bukan putih/hitam pekat) yang tetap terbaca
 * saat klien membalik warna. Tanpa `<script>`, gambar, pelacak, font eksternal, atau URL selain `href` yang disetor
 * pemanggil (tautan aplikasi atau tautan bertanda tangan). Semua teks data masuk lewat SATU fungsi escape (`esc`) yang
 * juga membuang karakter kontrol dan pengatur arah teks. Murni, tanpa I/O.
 */
import { stripControlChars } from '@shared/postel';

/** Gmail memotong pesan sekitar 102 KB; batas HTML kita lebih rendah. */
export const EMAIL_HTML_MAX_BYTES = 90 * 1024;
/** Batas baris per bagian daftar; sisanya diringkas "dan N lainnya". */
export const EMAIL_ROW_LIMIT = 50;

const TEXT = '#20242e';
const MUTED = '#5b6170';
const BORDER = '#d9dce3';
const PAGE_BG = '#f4f5f7';
const CARD_BG = '#fbfbfd';
const PRIMARY = '#1d4ed8';
const FONT = 'font-family:Arial,Helvetica,sans-serif';

export type Tone = 'bad' | 'warn' | 'ok' | 'neutral';

const TONES: Record<Tone, { bg: string; fg: string; border: string; bar: string }> = {
  bad: { bg: '#fde8e8', fg: '#8a1c1c', border: '#e3a3a3', bar: '#b91c1c' },
  warn: { bg: '#fff1cc', fg: '#6b4500', border: '#e0b84c', bar: '#b45309' },
  ok: { bg: '#e3f4ea', fg: '#14532d', border: '#8fcfa8', bar: '#047857' },
  neutral: { bg: '#eceef3', fg: '#2f3542', border: '#c9cdd6', bar: '#5b6170' },
};

/**
 * Aturan layar sempit. Klien yang tidak mendukung `@media` tetap memakai tata letak inline berlebar 600 px. Tanpa URL
 * atau font eksternal, dan satu-satunya CSS di `<style>`.
 */
const MOBILE_CSS =
  '@media only screen and (max-width:480px){' +
  '.outer{padding:8px 0 !important}' +
  '.px{padding-left:16px !important;padding-right:16px !important}' +
  '.title{font-size:20px !important;line-height:26px !important}' +
  '.kv-l,.kv-v{display:block !important;width:100% !important;box-sizing:border-box}' +
  '.kv-l{padding-bottom:0 !important}' +
  '.dh{display:none !important}' +
  '.dc{display:block !important;width:100% !important;box-sizing:border-box;padding:2px 0 !important;border-bottom:0 !important;text-align:left !important}' +
  '.dl{border-bottom:1px solid #d9dce3 !important;padding-bottom:10px !important}' +
  '.dk{display:inline !important;color:#5b6170}' +
  '.cta a{display:block !important;padding:14px 16px !important;font-size:16px !important}' +
  '}';

// ---------------------------------------------------------------------------------------------------------------
// Teks aman

/** Teks data yang dibersihkan dari karakter kontrol/bidi dan dipangkas dengan elipsis (belum di-escape HTML). */
export function cleanText(value: unknown, max = 200): string {
  const text = stripControlChars(String(value));
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function escapeRaw(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** SATU-SATUNYA jalan teks data masuk ke HTML (isi maupun atribut): dibersihkan, dipangkas, lalu di-escape. */
export function esc(value: unknown, max = 200): string {
  return escapeRaw(cleanText(value, max));
}

/** `href` yang aman: hanya http(s); selain itu string kosong. Hasilnya sudah di-escape untuk atribut. */
export function safeHref(url: string): string {
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? esc(trimmed, 2000) : '';
}

// ---------------------------------------------------------------------------------------------------------------
// Potongan HTML

/** Penanda status berwarna SELALU disertai teks (tidak bergantung warna). */
export function badge(text: string, tone: Tone): string {
  const t = TONES[tone];
  return `<span style="display:inline-block;padding:1px 7px;border-radius:9px;border:1px solid ${t.border};background-color:${t.bg};color:${t.fg};font-size:12px;font-weight:bold;white-space:nowrap">${esc(text, 60)}</span>`;
}

/** Judul bagian dengan batang warna di kiri dan jumlah. */
export function sectionHeading(title: string, tone: Tone, count?: number): string {
  const t = TONES[tone];
  const suffix =
    count === undefined ? '' : ` <span style="color:${MUTED};font-weight:normal">(${count})</span>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 6px"><tr><td width="4" bgcolor="${t.bar}" style="width:4px;font-size:0;line-height:0">&nbsp;</td><td style="padding:2px 0 2px 10px;${FONT};font-size:16px;line-height:22px;font-weight:bold;color:${TEXT}">${esc(title, 80)}${suffix}</td></tr></table>`;
}

/** Paragraf; baris baru dipertahankan (tiap baris dibersihkan sendiri). */
export function paragraph(text: string, options: { muted?: boolean; size?: number } = {}): string {
  const size = options.size ?? 14;
  const lines = text
    .replace(/\r\n|\r/g, '\n')
    .split('\n')
    .map((line) => esc(line, 4000));
  return `<div style="${FONT};font-size:${size}px;line-height:${size + 6}px;color:${options.muted ? MUTED : TEXT}">${lines.join('<br>')}</div>`;
}

/** Baris penutup untuk daftar yang dipangkas. */
export function moreNote(more: number): string {
  return more > 0 ? paragraph(`dan ${more} lainnya`, { muted: true, size: 13 }) : '';
}

/** Tabel kunci-nilai; di ponsel label dan nilai bertumpuk. Nilai teks biasa (di-escape). */
export function kvTable(rows: readonly { label: string; value: string }[]): string {
  const body = rows
    .map(
      (row) =>
        `<tr><td class="kv-l" valign="top" width="140" style="width:140px;padding:5px 12px 5px 0;${FONT};font-size:13px;line-height:19px;color:${MUTED}">${esc(row.label, 60)}</td><td class="kv-v" valign="top" style="padding:5px 0 8px;${FONT};font-size:14px;line-height:20px;color:${TEXT}">${esc(row.value, 300)}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table>`;
}

/** Isi sel tabel data: teks biasa, teks bertautan, atau lencana. */
export type DataCell =
  | string
  | { text: string; href?: string | undefined }
  | { badge: string; tone: Tone };

export interface DataColumn {
  label: string;
  /** Lebar tetap (px) di layar lebar; kolom tanpa lebar menyerap sisa. */
  width?: number;
  align?: 'left' | 'right';
}

function cellHtml(cell: DataCell): string {
  if (typeof cell === 'string') return esc(cell, 160);
  if ('badge' in cell) return badge(cell.badge, cell.tone);
  const href = cell.href === undefined ? '' : safeHref(cell.href);
  return href === ''
    ? esc(cell.text, 160)
    : `<a href="${href}" style="color:${PRIMARY}">${esc(cell.text, 160)}</a>`;
}

/**
 * Tabel data responsif. Layar lebar: tabel biasa dengan baris judul. Ponsel (<= 480 px): judul kolom disembunyikan dan
 * tiap baris menjadi blok bertumpuk (sel pertama = judul, sisanya "Label: nilai"); klien tanpa `@media` tetap melihat
 * tabel berlebar 600 px.
 */
export function dataTable(
  columns: readonly DataColumn[],
  rows: readonly (readonly DataCell[])[],
): string {
  const cellBase = `padding:7px 8px 7px 0;border-bottom:1px solid ${BORDER}`;
  const head = `<tr class="dh">${columns
    .map(
      (col) =>
        `<td align="${col.align ?? 'left'}"${col.width === undefined ? '' : ` width="${col.width}"`} style="padding:4px 8px 4px 0;border-bottom:1px solid ${BORDER};${FONT};font-size:12px;line-height:16px;color:${MUTED}">${esc(col.label, 40)}</td>`,
    )
    .join('')}</tr>`;
  const last = columns.length - 1;
  const body = rows
    .map(
      (row) =>
        `<tr valign="top">${columns
          .map((col, index) => {
            const label =
              index === 0
                ? ''
                : `<span class="dk" style="display:none;mso-hide:all">${esc(col.label, 40)}: </span>`;
            const first = index === 0 ? ';font-weight:bold' : '';
            return `<td class="dc${index === last ? ' dl' : ''}"${col.align === 'right' ? ' align="right"' : ''} style="${cellBase}${first}">${label}${cellHtml(row[index] ?? '')}</td>`;
          })
          .join('')}</tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;${FONT};font-size:13px;line-height:18px;color:${TEXT}">${head}${body}</table>`;
}

/** Tombol ajakan bertindak berbasis tabel (tetap tombol di Outlook); penuh lebar di ponsel. Kosong bila `url` tak aman. */
export function ctaButton(url: string, label: string): string {
  const href = safeHref(url);
  if (href === '') return '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 4px"><tr><td align="center" class="cta"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="${PRIMARY}" style="border-radius:6px;background-color:${PRIMARY}"><a href="${href}" style="display:inline-block;padding:12px 28px;${FONT};font-size:15px;line-height:20px;font-weight:bold;color:#ffffff;text-decoration:none">${esc(label, 60)}</a></td></tr></table></td></tr></table>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Dokumen

export interface EmailDocument {
  /** Judul dokumen (tag `<title>`) dan judul besar di kepala. */
  title: string;
  /** Teks ringkas yang tampil di daftar kotak masuk (tersembunyi di badan). */
  preheader: string;
  /** Lencana status di bawah judul (opsional). */
  headerBadge?: { text: string; tone: Tone };
  /** Potongan HTML badan (sudah aman, dari pembantu di atas). */
  body: readonly string[];
}

/** Kerangka dokumen: preheader, kepala, badan, dan kaki "Surel otomatis dari QC App". */
export function renderEmailDocument(doc: EmailDocument): string {
  const title = esc(doc.title, 120);
  const preheader = `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAGE_BG};font-size:1px;line-height:1px;mso-hide:all">${esc(doc.preheader, 150)}${'&nbsp;&zwnj;'.repeat(40)}</div>`;
  const headerBadge = doc.headerBadge
    ? `<div style="padding-top:8px">${badge(doc.headerBadge.text, doc.headerBadge.tone)}</div>`
    : '';
  const header = `<tr><td class="px" bgcolor="${CARD_BG}" style="padding:22px 28px 8px;background-color:${CARD_BG}"><div style="${FONT};font-size:12px;line-height:16px;letter-spacing:1px;color:${MUTED}">QC APP</div><div class="title" style="${FONT};font-size:22px;line-height:28px;font-weight:bold;color:${TEXT};padding-top:2px">${title}</div>${headerBadge}</td></tr>`;
  const body = `<tr><td class="px" bgcolor="${CARD_BG}" style="padding:8px 28px 12px;background-color:${CARD_BG}">${doc.body.join('')}</td></tr>`;
  const footer = `<tr><td class="px" bgcolor="${CARD_BG}" style="padding:12px 28px 22px;background-color:${CARD_BG};border-top:1px solid ${BORDER}"><div style="${FONT};font-size:12px;line-height:17px;color:${MUTED}">Surel otomatis dari QC App.</div></td></tr>`;
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><style>${MOBILE_CSS}</style><title>${title}</title></head><body style="margin:0;padding:0;background-color:${PAGE_BG};-webkit-text-size-adjust:100%" bgcolor="${PAGE_BG}">${preheader}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${PAGE_BG}" style="background-color:${PAGE_BG}"><tr><td align="center" class="outer" style="padding:20px 8px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" bgcolor="${CARD_BG}" style="width:600px;max-width:100%;background-color:${CARD_BG};border:1px solid ${BORDER};border-radius:8px">${header}${body}${footer}</table></td></tr></table></body></html>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Batas ukuran

/** Memotong daftar ke `limit` baris pertama dan menghitung sisanya. */
export function capRows<T>(
  rows: readonly T[],
  limit = EMAIL_ROW_LIMIT,
): { shown: T[]; more: number } {
  return { shown: rows.slice(0, limit), more: Math.max(0, rows.length - limit) };
}

/**
 * Merakit surel dengan batas baris per bagian yang makin kecil sampai HTML <= `EMAIL_HTML_MAX_BYTES` (Gmail memotong
 * pesan yang lebih besar). `build(limit)` harus memakai `limit` sebagai batas baris tiap bagian.
 */
export function fitEmail<T extends { html: string }>(
  build: (limit: number) => T,
  limits: readonly number[] = [EMAIL_ROW_LIMIT, 25, 10, 5],
): T {
  let result = build(limits[0] ?? EMAIL_ROW_LIMIT);
  for (const limit of limits.slice(1)) {
    if (Buffer.byteLength(result.html, 'utf8') <= EMAIL_HTML_MAX_BYTES) break;
    result = build(limit);
  }
  return result;
}
