import { hashText } from './items';

export const QR_LIMITS = {
  title: 60,
  subtitle: 80,
  footer: 80,
  link: 300,
  documentName: 150,
  documentMaxBytes: 10 * 1024 * 1024,
  exportMaxBytes: 8 * 1024 * 1024,
} as const;

export const LABEL_MM = 30;
export const SHEET = { widthMm: 300, heightMm: 420, columns: 10, rows: 14 } as const;
export const PT_PER_MM = 72 / 25.4;
/** Modul QR lebih kecil dari ini sulit dicetak dan dipindai. */
export const MIN_MODULE_MM = 0.3;
const QR_LINE_HEIGHT = 1.25;

export type QrLinkSource = 'url' | 'pdf';
export type QrExportStatus = 'none' | 'current' | 'stale';

export interface QrLayout {
  /** Ukuran font dalam pt. */
  titleSize: number;
  subtitleSize: number;
  footerSize: number;
  /** Sisi QR dalam mm. */
  qrSize: number;
  /** Sisi logo sebagai persen sisi QR. */
  logoPercent: number;
  /** Jarak antarbagian dan padding kanvas dalam mm. */
  gap: number;
  padding: number;
}

export const QR_LAYOUT_KEYS = [
  'titleSize',
  'subtitleSize',
  'footerSize',
  'qrSize',
  'logoPercent',
  'gap',
  'padding',
] as const;

export const QR_LAYOUT_RANGES: Record<
  keyof QrLayout,
  { min: number; max: number; step: number; unit: 'pt' | 'mm' | '%'; label: string }
> = {
  titleSize: { min: 4, max: 14, step: 0.5, unit: 'pt', label: 'Ukuran title' },
  subtitleSize: { min: 3, max: 12, step: 0.5, unit: 'pt', label: 'Ukuran subtitle' },
  footerSize: { min: 3, max: 10, step: 0.5, unit: 'pt', label: 'Ukuran footer' },
  qrSize: { min: 10, max: 26, step: 0.5, unit: 'mm', label: 'Ukuran QR' },
  logoPercent: { min: 8, max: 30, step: 1, unit: '%', label: 'Ukuran logo' },
  gap: { min: 0, max: 5, step: 0.1, unit: 'mm', label: 'Jarak antarbagian' },
  padding: { min: 0, max: 5, step: 0.1, unit: 'mm', label: 'Padding kanvas' },
};

/** Total tinggi bila title, subtitle, dan footer masing-masing satu baris ≈ 29,0 mm dari 30 mm. */
export const DEFAULT_QR_LAYOUT: QrLayout = {
  titleSize: 6,
  subtitleSize: 5,
  footerSize: 4,
  qrSize: 17,
  logoPercent: 22,
  gap: 1,
  padding: 1.2,
};

export function isQrLayout(value: unknown): value is QrLayout {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return QR_LAYOUT_KEYS.every((key) => {
    const entry = record[key];
    const range = QR_LAYOUT_RANGES[key];
    return (
      typeof entry === 'number' &&
      Number.isFinite(entry) &&
      entry >= range.min &&
      entry <= range.max
    );
  });
}

/** Menyaring nilai tersimpan/tak tepercaya: tiap field dijepit ke rentang; yang bukan angka memakai bawaan. */
export function clampQrLayout(value: Partial<Record<string, unknown>>): QrLayout {
  const out: QrLayout = { ...DEFAULT_QR_LAYOUT };
  for (const key of QR_LAYOUT_KEYS) {
    const entry = value[key];
    if (typeof entry !== 'number' || !Number.isFinite(entry)) continue;
    const range = QR_LAYOUT_RANGES[key];
    out[key] = Math.min(range.max, Math.max(range.min, entry));
  }
  return out;
}

export function isHttpUrl(text: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(text);
}

const QR_EXTRA_ALLOWED_CODES = [
  0x131, 0x152, 0x153, 0x2bb, 0x2bc, 0x2c6, 0x2da, 0x2dc, 0x20ac, 0x2122, 0x2212,
];

/** Karakter yang dicakup font label (Poppins latin): satu baris, tanpa kontrol. */
export function isRenderableLabelText(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const ok =
      (code >= 0x20 && code <= 0x7e) ||
      (code >= 0xa0 && code <= 0xff) ||
      (code >= 0x2010 && code <= 0x2027) ||
      QR_EXTRA_ALLOWED_CODES.includes(code);
    if (!ok) return false;
  }
  return true;
}

export function driveShareUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

export function labelFileSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug === '' ? 'label' : slug;
}

/** Lebar teks dalam mm untuk ukuran font (pt) dan ketebalan tertentu. */
export type Measure = (text: string, sizePt: number, bold: boolean) => number;
export type LabelRole = 'title' | 'subtitle' | 'footer';

export type LabelElement =
  | {
      kind: 'text';
      role: LabelRole;
      text: string;
      /** Titik tengah horizontal dan garis dasar, dalam mm dari pojok kiri atas label. */
      centerMm: number;
      baselineMm: number;
      sizePt: number;
      bold: boolean;
    }
  | { kind: 'qr'; xMm: number; yMm: number; sizeMm: number }
  | {
      kind: 'logo';
      xMm: number;
      yMm: number;
      /** Ukuran logo mengikuti rasio berkas: sisi terpanjang = persen sisi QR. */
      widthMm: number;
      heightMm: number;
      /** Latar putih di belakang logo (sedikit lebih besar), terpusat pada logo. */
      backdropWidthMm: number;
      backdropHeightMm: number;
    };

export interface LabelInput {
  title: string;
  subtitle: string;
  footer: string;
  hasLogo: boolean;
  /** Lebar ÷ tinggi gambar logo; tidak sah atau kosong = 1 (persegi). */
  logoAspect?: number;
  layout: QrLayout;
  /** Jumlah modul per sisi matriks QR (untuk ukuran modul). */
  qrModules: number;
}

export interface LabelLayout {
  elements: LabelElement[];
  /** Isi tidak muat di kanvas 30 × 30 mm: ekspor harus diblokir. */
  overflow: boolean;
  moduleMm: number;
  /** Modul < `MIN_MODULE_MM`: peringatan saja. */
  tooDense: boolean;
}

function wrapLabelText(
  text: string,
  maxMm: number,
  sizePt: number,
  bold: boolean,
  measure: Measure,
): { lines: string[]; tooWide: boolean } {
  const lines: string[] = [];
  let tooWide = false;
  let line = '';
  for (const word of text.split(' ').filter((w) => w !== '')) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (measure(candidate, sizePt, bold) <= maxMm) {
      line = candidate;
      continue;
    }
    if (line !== '') lines.push(line);
    line = word;
    if (measure(word, sizePt, bold) > maxMm) tooWide = true;
  }
  if (line !== '') lines.push(line);
  return { lines, tooWide };
}

interface Block {
  role: LabelRole;
  lines: string[];
  sizePt: number;
  bold: boolean;
  heightMm: number;
}

function toLabelBlock(
  role: LabelRole,
  text: string,
  sizePt: number,
  bold: boolean,
  maxMm: number,
  measure: Measure,
): { block: Block | null; tooWide: boolean } {
  if (text.trim() === '') return { block: null, tooWide: false };
  const { lines, tooWide } = wrapLabelText(text.trim(), maxMm, sizePt, bold, measure);
  const heightMm = (lines.length * sizePt * QR_LINE_HEIGHT) / PT_PER_MM;
  return { block: { role, lines, sizePt, bold, heightMm }, tooWide };
}

function labelTextElements(block: Block, topMm: number): LabelElement[] {
  const sizeMm = block.sizePt / PT_PER_MM;
  return block.lines.map(
    (text, index): LabelElement => ({
      kind: 'text',
      role: block.role,
      text,
      centerMm: LABEL_MM / 2,
      baselineMm: topMm + (index * QR_LINE_HEIGHT + 1) * sizeMm,
      sizePt: block.sizePt,
      bold: block.bold,
    }),
  );
}

/**
 * Menyusun elemen label (satuan mm, pojok kiri atas): title dan subtitle di atas, footer menempel di dasar,
 * QR di tengah ruang tersisa. Fungsi murni: pratinjau, PNG, dan PDF memakai hasil yang sama.
 */
export function layoutLabel(input: LabelInput, measure: Measure): LabelLayout {
  const { layout } = input;
  const innerW = LABEL_MM - 2 * layout.padding;
  const title = toLabelBlock('title', input.title, layout.titleSize, true, innerW, measure);
  const subtitle = toLabelBlock(
    'subtitle',
    input.subtitle,
    layout.subtitleSize,
    false,
    innerW,
    measure,
  );
  const footer = toLabelBlock('footer', input.footer, layout.footerSize, false, innerW, measure);
  const elements: LabelElement[] = [];
  let y = layout.padding;
  let headerExists = false;
  for (const entry of [title, subtitle]) {
    if (!entry.block) continue;
    if (headerExists) y += layout.gap;
    elements.push(...labelTextElements(entry.block, y));
    y += entry.block.heightMm;
    headerExists = true;
  }
  const headerBottom = y;
  const footerTop = footer.block
    ? LABEL_MM - layout.padding - footer.block.heightMm
    : LABEL_MM - layout.padding;
  if (footer.block) elements.push(...labelTextElements(footer.block, footerTop));
  const gapAbove = headerExists ? layout.gap : 0;
  const gapBelow = footer.block ? layout.gap : 0;
  const available = footerTop - headerBottom - gapAbove - gapBelow;
  const qrSize = layout.qrSize;
  const qrY = headerBottom + gapAbove + Math.max(0, (available - qrSize) / 2);
  const qrX = (LABEL_MM - qrSize) / 2;
  elements.push({ kind: 'qr', xMm: qrX, yMm: qrY, sizeMm: qrSize });
  if (input.hasLogo) {
    const aspect =
      input.logoAspect !== undefined && Number.isFinite(input.logoAspect) && input.logoAspect > 0
        ? input.logoAspect
        : 1;
    const longest = (qrSize * layout.logoPercent) / 100;
    const widthMm = aspect >= 1 ? longest : longest * aspect;
    const heightMm = aspect >= 1 ? longest / aspect : longest;
    elements.push({
      kind: 'logo',
      xMm: LABEL_MM / 2 - widthMm / 2,
      yMm: qrY + qrSize / 2 - heightMm / 2,
      widthMm,
      heightMm,
      backdropWidthMm: widthMm * 1.15,
      backdropHeightMm: heightMm * 1.15,
    });
  }
  const overflow =
    title.tooWide ||
    subtitle.tooWide ||
    footer.tooWide ||
    qrSize > innerW + 1e-9 ||
    available < qrSize - 1e-9;
  const moduleMm = qrSize / Math.max(1, input.qrModules);
  return { elements, overflow, moduleMm, tooDense: moduleMm < MIN_MODULE_MM };
}

/** Sel lembar 10 × 14: pojok kiri atas tiap label, urut baris demi baris. */
export function sheetCells(): Array<{ xMm: number; yMm: number }> {
  const cells: Array<{ xMm: number; yMm: number }> = [];
  for (let row = 0; row < SHEET.rows; row++) {
    for (let column = 0; column < SHEET.columns; column++) {
      cells.push({ xMm: column * LABEL_MM, yMm: row * LABEL_MM });
    }
  }
  return cells;
}

export interface QrContent {
  linkSource: QrLinkSource;
  /** Link efektif (untuk sumber `pdf`: URL berbagi berkas). */
  link: string;
  title: string;
  subtitle: string;
  footer: string;
  logoFileId: string;
  layout: QrLayout;
}

export function qrContentHash(content: QrContent): string {
  return hashText(
    JSON.stringify([
      content.linkSource,
      content.link,
      content.title,
      content.subtitle,
      content.footer,
      content.logoFileId,
      QR_LAYOUT_KEYS.map((key) => content.layout[key]),
    ]),
  );
}

export function qrExportStatus(exportedHash: string, content: QrContent): QrExportStatus {
  if (exportedHash === '') return 'none';
  return exportedHash === qrContentHash(content) ? 'current' : 'stale';
}
