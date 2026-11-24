/**
 * Perender surel laporan dashboard terjadwal (spek dashboard 7a.3): HTML berlebar 600 px dan teks polos dari
 * `EmailWidgetData` (hasil `toEmailDto`, daftar putih), tanpa I/O. Klien surel tidak menjalankan JavaScript dan banyak
 * yang membuang gambar/SVG, jadi semua visual berupa tabel dengan gaya inline: tanpa `<script>`, `<img>`, `<link>`,
 * piksel pelacak, atau URL selain tombol "Buka dashboard lengkap". Semua teks data melewati SATU fungsi escape yang juga
 * membuang karakter kontrol dan pengatur arah teks. Nilai selalu tertulis (tidak bergantung warna).
 */
import type { NumberData, PartsData, SeriesData, WidgetMeta } from '@shared/dashboard';
import type { EmailWidgetData } from '@shared/dashboard-public';
import { stripControlChars } from '@shared/postel';

/** Gmail memotong pesan sekitar 102 KB; batas HTML kita lebih rendah. */
export const EMAIL_HTML_MAX_BYTES = 90 * 1024;

/** Batas panjang nama laporan di subjek (sama dengan `REPORT_LIMITS.nameMax`). */
const SUBJECT_NAME_MAX = 120;
/** Batas panjang teks satu sel/label di surel. */
const CELL_MAX = 80;
/** Irisan maksimum pada batang bertumpuk (di luar itu = "Lainnya"). */
const PARTS_MAX = 6;
/** Baris maksimum pada batang horizontal. */
const BARS_MAX = 10;

// Warna tetap berkontras AA terhadap latar putih (teks >= 4,5:1; warna batang/penanda >= 3:1).
const TEXT = '#1a1a1a';
const MUTED = '#5a5a66';
const BORDER = '#d9d9e0';
const PAGE_BG = '#f3f3f6';
const PRIMARY = '#1d4ed8';
const GOOD = '#047857';
const BAD = '#b91c1c';
const NEUTRAL = '#4b5563';
const SERIES_COLORS = ['#1d4ed8', '#b45309', '#047857', '#b91c1c', '#6d28d9', '#0e7490'] as const;
const OTHER_COLOR = '#4b5563';

const FONT = 'font-family:Arial,Helvetica,sans-serif';
/** Sel yang hanya berisi warna (tanpa tinggi baris dari teks). */
const BLOCK = 'font-size:0;line-height:0';

export interface EmailWidgetInput {
  meta: WidgetMeta;
  data: EmailWidgetData;
}

export interface EmailReportInput {
  reportName: string;
  periodLabel: string;
  scopeLabel: string;
  scheduleLabel: string;
  ownerName: string;
  widgets: EmailWidgetInput[];
  ctaUrl: string;
  linkExpiresLabel: string;
  /** Kirim uji: subjek diawali `[UJI] ` dan kepala menandainya. */
  test?: boolean;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Tingkat kepadatan: bila HTML melebihi batas, dirender ulang lebih padat. */
interface Tier {
  listRows: number;
  columns: number;
  valueLabels: boolean;
}
const TIERS: readonly Tier[] = [
  { listRows: 5, columns: 31, valueLabels: true },
  { listRows: 3, columns: 14, valueLabels: true },
  { listRows: 2, columns: 8, valueLabels: false },
  // Terpadat: grafik deret diganti ringkasan angka (total dan puncak per seri) agar surel tak pernah terpotong.
  { listRows: 2, columns: 0, valueLabels: false },
];

// ---------------------------------------------------------------------------------------------------------------
// Teks aman

/** Teks data yang dibersihkan dari karakter kontrol/bidi dan dipangkas (belum di-escape HTML). */
function clean(value: unknown, max = CELL_MAX): string {
  const text = stripControlChars(String(value));
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** SATU-SATUNYA jalan teks data masuk ke HTML: dibersihkan, dipangkas, lalu di-escape. */
function esc(value: unknown, max = CELL_MAX): string {
  return clean(value, max)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Angka berformat Indonesia (titik ribuan, koma desimal, maks. satu desimal). */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 10) / 10;
  const negative = rounded < 0;
  const [whole = '0', fraction] = Math.abs(rounded).toString().split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${grouped}${fraction ? `,${fraction}` : ''}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Delta periode lalu

interface Delta {
  arrow: string;
  text: string;
  color: string;
}

function deltaOf(meta: WidgetMeta, data: NumberData): Delta | null {
  if (data.previous === undefined) return null;
  const { value, previous } = data;
  if (value === previous) {
    return { arrow: '•', text: 'Tetap dibanding periode lalu', color: NEUTRAL };
  }
  const up = value > previous;
  const word = up ? 'Naik' : 'Turun';
  let text: string;
  if (previous === 0) {
    text = `${word} dari periode lalu (0)`;
  } else {
    const percent = Math.round((Math.abs(value - previous) / Math.abs(previous)) * 100);
    text = `${word} ${percent === 0 ? '<1' : percent}% dari periode lalu`;
  }
  // Warna menurut baik/buruk widget (K7): searah `deltaGood` = hijau, berlawanan = merah; arah nyata tetap tertulis.
  const good = meta.deltaGood;
  let color = NEUTRAL;
  if (good !== undefined) color = (good === 'up') === up ? GOOD : BAD;
  return { arrow: up ? '▲' : '▼', text, color };
}

// ---------------------------------------------------------------------------------------------------------------
// Potongan HTML

function card(inner: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="border:1px solid ${BORDER};border-radius:8px"><tr><td style="padding:12px 14px">${inner}</td></tr></table>`;
}

function widgetTitle(title: string): string {
  return `<div style="${FONT};font-size:14px;line-height:20px;font-weight:bold;color:${TEXT};padding-bottom:8px">${esc(title)}</div>`;
}

function emptyNote(text: string): string {
  return `<div style="${FONT};font-size:13px;line-height:18px;color:${MUTED}">${esc(text)}</div>`;
}

function swatch(color: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="10" height="10"><tr><td bgcolor="${color}" width="10" height="10" style="width:10px;height:10px;${BLOCK}">&nbsp;</td></tr></table>`;
}

function numberCell(item: EmailWidgetInput, data: NumberData): string {
  const delta = deltaOf(item.meta, data);
  const deltaRow = delta
    ? `<tr><td style="${FONT};font-size:12px;line-height:16px;color:${delta.color};padding-top:2px">${delta.arrow} ${esc(delta.text)}</td></tr>`
    : '';
  return `<td width="33%" valign="top" style="padding:4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="border:1px solid ${BORDER};border-radius:8px"><tr><td style="padding:12px 12px 2px;${FONT};font-size:12px;line-height:16px;color:${MUTED}">${esc(item.meta.title)}</td></tr><tr><td style="padding:0 12px;${FONT};font-size:28px;line-height:34px;font-weight:bold;color:${TEXT}">${esc(formatNumber(data.value))}</td></tr>${deltaRow}<tr><td height="10" style="${BLOCK}">&nbsp;</td></tr></table></td>`;
}

function numberRow(items: { item: EmailWidgetInput; data: NumberData }[]): string {
  const cells = items.map(({ item, data }) => numberCell(item, data));
  while (cells.length < 3) cells.push('<td width="33%" style="padding:4px">&nbsp;</td>');
  return `<tr><td style="padding:4px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells.join('')}</tr></table></td></tr>`;
}

// --- Irisan: batang bertumpuk + legenda ---------------------------------------------------------------------------

interface Slice {
  label: string;
  value: number;
  color: string;
}

/** Irisan bernilai > 0, maks. `PARTS_MAX` terbesar + "Lainnya"; jumlah = total. */
function topSlices(data: PartsData, limit: number): Slice[] {
  const positive = data.slices.filter((slice) => slice.value > 0);
  const sorted = [...positive].sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, limit);
  const rest = sorted.slice(limit);
  const slices: Slice[] = head.map((slice, index) => ({
    label: clean(slice.label),
    value: slice.value,
    color: SERIES_COLORS[index % SERIES_COLORS.length] as string,
  }));
  if (rest.length > 0) {
    slices.push({
      label: 'Lainnya',
      value: rest.reduce((sum, slice) => sum + slice.value, 0),
      color: OTHER_COLOR,
    });
  }
  return slices;
}

/** Lebar persen bulat tiap irisan yang berjumlah tepat 100 (sisa terbesar), minimal 1 untuk nilai positif. */
export function percentWidths(values: readonly number[]): number[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return values.map(() => 0);
  const exact = values.map((value) => (value / total) * 100);
  const widths = exact.map((share) => Math.floor(share));
  let remainder = 100 - widths.reduce((sum, width) => sum + width, 0);
  const order = exact
    .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of order) {
    if (remainder <= 0) break;
    widths[index] = (widths[index] ?? 0) + 1;
    remainder -= 1;
  }
  // Nilai positif tak boleh hilang dari batang: ambil 1 dari irisan terlebar.
  for (let index = 0; index < widths.length; index += 1) {
    if ((values[index] ?? 0) > 0 && widths[index] === 0) {
      let widest = 0;
      for (let other = 1; other < widths.length; other += 1) {
        if ((widths[other] ?? 0) > (widths[widest] ?? 0)) widest = other;
      }
      widths[widest] = (widths[widest] ?? 0) - 1;
      widths[index] = 1;
    }
  }
  return widths;
}

function stackedBar(data: PartsData): string {
  const slices = topSlices(data, PARTS_MAX);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (slices.length === 0 || total <= 0) return emptyNote('Belum ada data');
  const widths = percentWidths(slices.map((slice) => slice.value));
  const bar = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${slices
    .map(
      (slice, index) =>
        `<td width="${widths[index]}%" bgcolor="${slice.color}" height="16" style="height:16px;${BLOCK}">&nbsp;</td>`,
    )
    .join('')}</tr></table>`;
  const legend = slices
    .map(
      (slice, index) =>
        `<tr><td width="18" style="padding:4px 8px 0 0">${swatch(slice.color)}</td><td style="padding-top:4px;${FONT};font-size:13px;line-height:18px;color:${TEXT}">${esc(slice.label)}</td><td align="right" style="padding-top:4px;${FONT};font-size:13px;line-height:18px;font-weight:bold;color:${TEXT}">${esc(formatNumber(slice.value))}</td><td align="right" width="44" style="padding-top:4px;${FONT};font-size:12px;line-height:18px;color:${MUTED}">${widths[index]}%</td></tr>`,
    )
    .join('');
  return `${bar}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px">${legend}</table>`;
}

function horizontalBars(data: PartsData): string {
  const slices = topSlices(data, BARS_MAX);
  const max = Math.max(0, ...slices.map((slice) => slice.value));
  if (slices.length === 0 || max <= 0) return emptyNote('Belum ada data');
  const rows = slices
    .map((slice) => {
      const width = Math.max(1, Math.round((slice.value / max) * 100));
      return `<tr><td width="34%" style="padding:3px 8px 3px 0;${FONT};font-size:12px;line-height:16px;color:${TEXT}">${esc(slice.label)}</td><td width="54%" style="padding:3px 0"><table role="presentation" width="${width}%" cellpadding="0" cellspacing="0"><tr><td bgcolor="${PRIMARY}" height="12" style="height:12px;${BLOCK}">&nbsp;</td></tr></table></td><td align="right" style="padding:3px 0 3px 6px;${FONT};font-size:12px;line-height:16px;font-weight:bold;color:${TEXT}">${esc(formatNumber(slice.value))}</td></tr>`;
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`;
}

// --- Deret waktu: kolom --------------------------------------------------------------------------------------------

const CHART_HEIGHT = 80;

/** Ringkasan teks per seri (total dan puncak), sudah di-escape; nilai tetap tertulis walau grafik tak ditampilkan. */
function seriesSummary(
  series: readonly { label: string; values: readonly number[] }[],
  points: readonly { label: string }[],
): string {
  return series
    .map((entry) => {
      const sum = entry.values.reduce((a, b) => a + b, 0);
      const peak = Math.max(0, ...entry.values);
      const peakAt = points[entry.values.indexOf(peak)]?.label ?? '';
      return `${esc(entry.label)}: total ${esc(formatNumber(sum))}, tertinggi ${esc(formatNumber(peak))}${peakAt === '' ? '' : ` (${esc(peakAt, 12)})`}`;
    })
    .join(' &middot; ');
}

function seriesColumns(data: SeriesData, tier: Tier): string {
  const total = data.series.reduce(
    (sum, entry) => sum + entry.values.reduce((a, b) => a + b, 0),
    0,
  );
  if (data.points.length === 0 || data.series.length === 0 || total <= 0) {
    return emptyNote('Belum ada data');
  }
  if (tier.columns === 0)
    return `<div style="${FONT};font-size:12px;line-height:16px;color:${MUTED}">${seriesSummary(data.series, data.points)}</div>`;
  // Periode terbaru dipertahankan bila titik lebih banyak dari lebar kolom yang diizinkan.
  const count = Math.min(data.points.length, tier.columns);
  const skipped = data.points.length - count;
  const start = data.points.length - count;
  const points = data.points.slice(start);
  const series = data.series.map((entry) => ({ ...entry, values: entry.values.slice(start) }));
  const max = Math.max(1, ...series.flatMap((entry) => entry.values));
  const grouped = series.length > 1;
  const showValues = tier.valueLabels && (!grouped || count <= 14);
  const barWidth = Math.max(
    4,
    Math.min(18, Math.floor(500 / count / (grouped ? series.length : 1) - 3)),
  );
  const labelEvery = Math.max(1, Math.ceil(count / 8));
  const valueFont = count > 20 ? 9 : 11;

  const valueCells = points
    .map((_, index) => {
      const text = series.map((entry) => formatNumber(entry.values[index] ?? 0)).join('/');
      return `<td align="center" valign="bottom" style="${FONT};font-size:${valueFont}px;line-height:${valueFont + 3}px;color:${TEXT}">${esc(text)}</td>`;
    })
    .join('');
  const barCells = points
    .map((_, index) => {
      const bars = series
        .map((entry, seriesIndex) => {
          const value = entry.values[index] ?? 0;
          const height = value > 0 ? Math.max(2, Math.round((value / max) * CHART_HEIGHT)) : 0;
          const color = SERIES_COLORS[seriesIndex % SERIES_COLORS.length] as string;
          return height === 0
            ? `<td width="${barWidth}" style="${BLOCK}">&nbsp;</td>`
            : `<td valign="bottom" style="padding:0 1px"><table role="presentation" cellpadding="0" cellspacing="0" width="${barWidth}" height="${height}"><tr><td bgcolor="${color}" height="${height}" style="${BLOCK}">&nbsp;</td></tr></table></td>`;
        })
        .join('');
      return `<td align="center" valign="bottom" height="${CHART_HEIGHT}" style="height:${CHART_HEIGHT}px"><table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr valign="bottom">${bars}</tr></table></td>`;
    })
    .join('');
  const labelCells = points
    .map((point, index) => {
      const shown = index % labelEvery === 0 || index === count - 1;
      return `<td align="center" style="${FONT};font-size:10px;line-height:13px;color:${MUTED}">${shown ? esc(point.label, 12) : ''}</td>`;
    })
    .join('');
  const chart = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${showValues ? `<tr>${valueCells}</tr>` : ''}<tr>${barCells}</tr><tr>${labelCells}</tr></table>`;

  const legend = grouped
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:6px"><tr>${series
        .map(
          (entry, index) =>
            `<td style="padding-right:4px">${swatch(SERIES_COLORS[index % SERIES_COLORS.length] as string)}</td><td style="padding-right:12px;${FONT};font-size:12px;line-height:16px;color:${TEXT}">${esc(entry.label)}</td>`,
        )
        .join('')}</tr></table>`
    : '';
  const summary = seriesSummary(series, points);
  const note =
    skipped > 0
      ? `<div style="${FONT};font-size:11px;line-height:15px;color:${MUTED};padding-top:4px">Menampilkan ${count} periode terakhir dari ${data.points.length}</div>`
      : '';
  return `${chart}${legend}<div style="${FONT};font-size:12px;line-height:16px;color:${MUTED};padding-top:6px">${summary}</div>${note}`;
}

// --- Daftar ---------------------------------------------------------------------------------------------------------

function listTable(data: EmailWidgetData & { kind: 'list' }, tier: Tier): string {
  if (data.rows.length === 0) return emptyNote('Tidak ada data');
  const rows = data.rows.slice(0, tier.listRows);
  const head = data.columns
    .map(
      (column) =>
        `<td style="padding:4px 6px 4px 0;border-bottom:1px solid ${BORDER};${FONT};font-size:11px;line-height:14px;color:${MUTED}">${esc(column.label, 30)}</td>`,
    )
    .join('');
  const body = rows
    .map(
      (row) =>
        `<tr>${data.columns
          .map(
            (column) =>
              `<td valign="top" style="padding:5px 6px 5px 0;border-bottom:1px solid ${BORDER};${FONT};font-size:12px;line-height:16px;color:${TEXT}">${esc(row[column.key] ?? '')}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('');
  const total = Math.max(data.total, data.rows.length);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${head}</tr>${body}</table><div style="${FONT};font-size:11px;line-height:15px;color:${MUTED};padding-top:4px">Menampilkan ${rows.length} dari ${esc(formatNumber(total))}</div>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Rakitan

function widgetBlock(item: EmailWidgetInput, tier: Tier): string {
  const { meta, data } = item;
  let body: string;
  switch (data.kind) {
    case 'number':
      body = '';
      break;
    case 'parts':
      body =
        meta.visual === 'donut' || meta.visual === 'pie' ? stackedBar(data) : horizontalBars(data);
      break;
    case 'series':
      body = seriesColumns(data, tier);
      break;
    case 'list':
      body = listTable(data, tier);
      break;
  }
  return `<tr><td style="padding:4px 0">${card(`${widgetTitle(meta.title)}${body}`)}</td></tr>`;
}

function assembleHtml(input: EmailReportInput, tier: Tier): string {
  const blocks: string[] = [];
  let run: { item: EmailWidgetInput; data: NumberData }[] = [];
  const flush = () => {
    for (let index = 0; index < run.length; index += 3)
      blocks.push(numberRow(run.slice(index, index + 3)));
    run = [];
  };
  for (const item of input.widgets) {
    if (item.data.kind === 'number') {
      run.push({ item, data: item.data });
    } else {
      flush();
      blocks.push(widgetBlock(item, tier));
    }
  }
  flush();

  const name = esc(input.reportName, SUBJECT_NAME_MAX);
  const testNote = input.test
    ? `<div style="${FONT};font-size:12px;line-height:16px;font-weight:bold;color:${BAD};padding-bottom:4px">UJI: surel ini hanya dikirim ke pemilik laporan</div>`
    : '';
  const header = `<tr><td style="padding:20px 24px 12px" bgcolor="#ffffff">${testNote}<div style="${FONT};font-size:20px;line-height:26px;font-weight:bold;color:${TEXT}">${name}</div><div style="${FONT};font-size:13px;line-height:19px;color:${MUTED};padding-top:6px">Periode: ${esc(input.periodLabel)}<br>Cakupan: ${esc(input.scopeLabel, 200)}<br>Jadwal: ${esc(input.scheduleLabel)}</div></td></tr>`;
  const cta = `<tr><td align="center" style="padding:16px 24px 8px" bgcolor="#ffffff"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="${PRIMARY}" style="border-radius:6px"><a href="${esc(input.ctaUrl, 2000)}" style="display:inline-block;padding:12px 24px;${FONT};font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none">Buka dashboard lengkap</a></td></tr></table><div style="${FONT};font-size:12px;line-height:17px;color:${MUTED};padding-top:8px">${esc(input.linkExpiresLabel)}. Tautan hanya menampilkan periode dan cakupan laporan ini.</div></td></tr>`;
  const footer = `<tr><td style="padding:12px 24px 20px" bgcolor="#ffffff"><div style="${FONT};font-size:12px;line-height:17px;color:${MUTED}">Laporan &ldquo;${name}&rdquo; dikirim atas nama ${esc(input.ownerName)}. Hubungi pemilik untuk berhenti atau mengubah isinya.</div></td></tr>`;

  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${name}</title></head><body style="margin:0;padding:0;background:${PAGE_BG}" bgcolor="${PAGE_BG}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${PAGE_BG}"><tr><td align="center" style="padding:16px 8px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%">${header}<tr><td style="padding:0 16px" bgcolor="#ffffff"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${blocks.join('')}</table></td></tr>${cta}${footer}</table></td></tr></table></body></html>`;
}

// --- Teks polos ------------------------------------------------------------------------------------------------------

function plainWidget(item: EmailWidgetInput): string {
  const { meta, data } = item;
  const title = clean(meta.title);
  switch (data.kind) {
    case 'number': {
      const delta = deltaOf(meta, data);
      return `${title}: ${formatNumber(data.value)}${delta ? ` (${delta.text})` : ''}`;
    }
    case 'parts': {
      const slices = topSlices(
        data,
        meta.visual === 'donut' || meta.visual === 'pie' ? PARTS_MAX : BARS_MAX,
      );
      if (slices.length === 0) return `${title}\n  Belum ada data`;
      const widths = percentWidths(slices.map((slice) => slice.value));
      return `${title}\n${slices.map((slice, index) => `  ${slice.label}: ${formatNumber(slice.value)} (${widths[index]}%)`).join('\n')}`;
    }
    case 'series': {
      const total = data.series.reduce(
        (sum, entry) => sum + entry.values.reduce((a, b) => a + b, 0),
        0,
      );
      if (data.points.length === 0 || total <= 0) return `${title}\n  Belum ada data`;
      return `${title}\n${data.series
        .map((entry) => {
          const sum = entry.values.reduce((a, b) => a + b, 0);
          const cells = data.points
            .map(
              (point, index) =>
                `${clean(point.label, 20)} ${formatNumber(entry.values[index] ?? 0)}`,
            )
            .join(', ');
          return `  ${clean(entry.label)} (total ${formatNumber(sum)}): ${cells}`;
        })
        .join('\n')}`;
    }
    case 'list': {
      if (data.rows.length === 0) return `${title}\n  Tidak ada data`;
      const lines = data.rows.map(
        (row) =>
          `  - ${data.columns.map((column) => `${clean(column.label, 30)}: ${clean(row[column.key] ?? '')}`).join(' | ')}`,
      );
      return `${title}\n${lines.join('\n')}\n  Menampilkan ${data.rows.length} dari ${formatNumber(Math.max(data.total, data.rows.length))}`;
    }
  }
}

function plainText(input: EmailReportInput): string {
  const lines = [
    `${input.test ? '[UJI] ' : ''}${clean(input.reportName, SUBJECT_NAME_MAX)}`,
    `Periode: ${clean(input.periodLabel)}`,
    `Cakupan: ${clean(input.scopeLabel, 200)}`,
    `Jadwal: ${clean(input.scheduleLabel)}`,
    '',
    ...input.widgets.flatMap((item) => [plainWidget(item), '']),
    `Buka dashboard lengkap (${clean(input.linkExpiresLabel)}):`,
    input.ctaUrl,
    '',
    `Laporan dikirim atas nama ${clean(input.ownerName)}. Hubungi pemilik untuk berhenti atau mengubah isinya.`,
  ];
  return lines.join('\n');
}

function subjectOf(input: EmailReportInput): string {
  const name = clean(input.reportName, SUBJECT_NAME_MAX);
  return `${input.test ? '[UJI] ' : ''}[QC] ${name}, ${clean(input.periodLabel)}`;
}

/**
 * Merender surel: HTML + teks polos + subjek. Bila HTML melebihi `EMAIL_HTML_MAX_BYTES` dirender ulang lebih padat
 * (daftar lebih pendek, kolom lebih sedikit, tanpa angka di atas kolom), sampai tingkat terpadat.
 */
export function renderReportEmail(input: EmailReportInput): RenderedEmail {
  let html = '';
  for (const tier of TIERS) {
    html = assembleHtml(input, tier);
    if (Buffer.byteLength(html, 'utf8') <= EMAIL_HTML_MAX_BYTES) break;
  }
  return { subject: subjectOf(input), html, text: plainText(input) };
}
