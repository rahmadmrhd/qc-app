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

/** Gaya satu bagian teks (title, subtitle, atau footer). */
export interface QrTextStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  /** Ditampilkan sebagai HURUF KAPITAL (teks tersimpan tetap apa adanya). */
  uppercase: boolean;
}

export const QR_TEXT_STYLE_KEYS = ['bold', 'italic', 'underline', 'strike', 'uppercase'] as const;

export const QR_FRAME_KINDS = ['none', 'corners', 'box'] as const;
export type QrFrameKind = (typeof QR_FRAME_KINDS)[number];

/** Bingkai di sekeliling QR: siku di empat sudut (seperti bingkai pemindai) atau kotak penuh. */
export interface QrFrame {
  kind: QrFrameKind;
  /** Tebal garis dan jarak ke QR (mm); lengkung sudut (mm); panjang siku (% sisi bingkai). */
  thickness: number;
  gap: number;
  radius: number;
  arm: number;
}

export const QR_FRAME_KEYS = ['thickness', 'gap', 'radius', 'arm'] as const;

export const QR_FRAME_RANGES: Record<
  (typeof QR_FRAME_KEYS)[number],
  { min: number; max: number; step: number; unit: 'mm' | '%'; label: string }
> = {
  thickness: { min: 0.1, max: 1.5, step: 0.05, unit: 'mm', label: 'Tebal bingkai' },
  gap: { min: 0, max: 4, step: 0.1, unit: 'mm', label: 'Jarak bingkai ke QR' },
  radius: { min: 0, max: 4, step: 0.1, unit: 'mm', label: 'Lengkung sudut' },
  arm: { min: 10, max: 50, step: 1, unit: '%', label: 'Panjang siku' },
};

export interface QrStyle {
  title: QrTextStyle;
  subtitle: QrTextStyle;
  footer: QrTextStyle;
  frame: QrFrame;
}

const PLAIN_TEXT_STYLE: QrTextStyle = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  uppercase: false,
};

/** Title tebal (seperti contoh), lainnya polos, tanpa bingkai. */
export const DEFAULT_QR_STYLE: QrStyle = {
  title: { ...PLAIN_TEXT_STYLE, bold: true },
  subtitle: { ...PLAIN_TEXT_STYLE },
  footer: { ...PLAIN_TEXT_STYLE },
  frame: { kind: 'none', thickness: 0.5, gap: 1, radius: 1.5, arm: 25 },
};

const QR_STYLE_PARTS = ['title', 'subtitle', 'footer'] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isQrStyle(value: unknown): value is QrStyle {
  if (!isPlainObject(value)) return false;
  for (const part of QR_STYLE_PARTS) {
    const entry = value[part];
    if (!isPlainObject(entry)) return false;
    if (!QR_TEXT_STYLE_KEYS.every((key) => typeof entry[key] === 'boolean')) return false;
  }
  const frame = value.frame;
  if (!isPlainObject(frame)) return false;
  if (!(QR_FRAME_KINDS as readonly unknown[]).includes(frame.kind)) return false;
  return QR_FRAME_KEYS.every((key) => {
    const entry = frame[key];
    const range = QR_FRAME_RANGES[key];
    return (
      typeof entry === 'number' &&
      Number.isFinite(entry) &&
      entry >= range.min &&
      entry <= range.max
    );
  });
}

/** Memulihkan gaya tersimpan/tak tepercaya: nilai tak sah memakai bawaan, angka dijepit ke rentang. */
export function clampQrStyle(value: unknown): QrStyle {
  const source = isPlainObject(value) ? value : {};
  const out: QrStyle = {
    title: { ...DEFAULT_QR_STYLE.title },
    subtitle: { ...DEFAULT_QR_STYLE.subtitle },
    footer: { ...DEFAULT_QR_STYLE.footer },
    frame: { ...DEFAULT_QR_STYLE.frame },
  };
  for (const part of QR_STYLE_PARTS) {
    const entry = source[part];
    if (!isPlainObject(entry)) continue;
    for (const key of QR_TEXT_STYLE_KEYS) {
      if (typeof entry[key] === 'boolean') out[part][key] = entry[key];
    }
  }
  const frame = source.frame;
  if (isPlainObject(frame)) {
    if ((QR_FRAME_KINDS as readonly unknown[]).includes(frame.kind)) {
      out.frame.kind = frame.kind as QrFrameKind;
    }
    for (const key of QR_FRAME_KEYS) {
      const entry = frame[key];
      if (typeof entry !== 'number' || !Number.isFinite(entry)) continue;
      const range = QR_FRAME_RANGES[key];
      out.frame[key] = Math.min(range.max, Math.max(range.min, entry));
    }
  }
  return out;
}

/** Lebar teks dalam mm untuk ukuran font (pt), ketebalan, dan kemiringan tertentu. */
export type Measure = (text: string, sizePt: number, bold: boolean, italic: boolean) => number;
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
      italic: boolean;
      underline: boolean;
      strike: boolean;
    }
  | { kind: 'qr'; xMm: number; yMm: number; sizeMm: number }
  | {
      kind: 'frame';
      variant: 'corners' | 'box';
      /** Pojok kiri atas dan sisi persegi GARIS TENGAH bingkai (garis digambar selebar `thicknessMm`). */
      xMm: number;
      yMm: number;
      sideMm: number;
      thicknessMm: number;
      radiusMm: number;
      /** Panjang tiap siku (hanya untuk `corners`). */
      armMm: number;
    }
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
  /** Gaya teks dan bingkai; kosong = `DEFAULT_QR_STYLE`. */
  style?: QrStyle;
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
  italic: boolean,
  measure: Measure,
): { lines: string[]; tooWide: boolean } {
  const lines: string[] = [];
  let tooWide = false;
  let line = '';
  for (const word of text.split(' ').filter((w) => w !== '')) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (measure(candidate, sizePt, bold, italic) <= maxMm) {
      line = candidate;
      continue;
    }
    if (line !== '') lines.push(line);
    line = word;
    if (measure(word, sizePt, bold, italic) > maxMm) tooWide = true;
  }
  if (line !== '') lines.push(line);
  return { lines, tooWide };
}

interface Block {
  role: LabelRole;
  lines: string[];
  sizePt: number;
  style: QrTextStyle;
  heightMm: number;
}

function toLabelBlock(
  role: LabelRole,
  text: string,
  sizePt: number,
  style: QrTextStyle,
  maxMm: number,
  measure: Measure,
): { block: Block | null; tooWide: boolean } {
  if (text.trim() === '') return { block: null, tooWide: false };
  const shown = style.uppercase ? text.trim().toUpperCase() : text.trim();
  const { lines, tooWide } = wrapLabelText(shown, maxMm, sizePt, style.bold, style.italic, measure);
  const heightMm = (lines.length * sizePt * QR_LINE_HEIGHT) / PT_PER_MM;
  return { block: { role, lines, sizePt, style, heightMm }, tooWide };
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
      bold: block.style.bold,
      italic: block.style.italic,
      underline: block.style.underline,
      strike: block.style.strike,
    }),
  );
}

/**
 * Menyusun elemen label (satuan mm, pojok kiri atas): title dan subtitle di atas, footer menempel di dasar,
 * QR di tengah ruang tersisa. Fungsi murni: pratinjau, PNG, dan PDF memakai hasil yang sama.
 */
export function layoutLabel(input: LabelInput, measure: Measure): LabelLayout {
  const { layout } = input;
  const style = input.style ?? DEFAULT_QR_STYLE;
  const innerW = LABEL_MM - 2 * layout.padding;
  const title = toLabelBlock('title', input.title, layout.titleSize, style.title, innerW, measure);
  const subtitle = toLabelBlock(
    'subtitle',
    input.subtitle,
    layout.subtitleSize,
    style.subtitle,
    innerW,
    measure,
  );
  const footer = toLabelBlock(
    'footer',
    input.footer,
    layout.footerSize,
    style.footer,
    innerW,
    measure,
  );
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
  // Bingkai ikut memakan ruang: tebal + jarak di tiap sisi QR.
  const frame = style.frame;
  const framed = frame.kind !== 'none';
  const frameOffset = framed ? frame.gap + frame.thickness : 0;
  const blockSize = qrSize + 2 * frameOffset;
  const blockY = headerBottom + gapAbove + Math.max(0, (available - blockSize) / 2);
  const qrY = blockY + frameOffset;
  const qrX = (LABEL_MM - qrSize) / 2;
  if (framed) {
    const sideMm = qrSize + 2 * frame.gap + frame.thickness;
    elements.push({
      kind: 'frame',
      variant: frame.kind === 'box' ? 'box' : 'corners',
      xMm: qrX - frame.gap - frame.thickness / 2,
      yMm: qrY - frame.gap - frame.thickness / 2,
      sideMm,
      thicknessMm: frame.thickness,
      radiusMm: frame.radius,
      armMm: (sideMm * frame.arm) / 100,
    });
  }
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
    blockSize > innerW + 1e-9 ||
    available < blockSize - 1e-9;
  const moduleMm = qrSize / Math.max(1, input.qrModules);
  return { elements, overflow, moduleMm, tooDense: moduleMm < MIN_MODULE_MM };
}

export interface LabelPoint {
  x: number;
  y: number;
}

const ARC_SEGMENTS = 8;

/** Titik busur dari sudut `fromDeg` ke `toDeg` (derajat; sumbu y ke bawah). Radius 0 = satu titik sudut. */
function arcPoints(
  cx: number,
  cy: number,
  r: number,
  fromDeg: number,
  toDeg: number,
): LabelPoint[] {
  if (r < 1e-9) return [{ x: cx, y: cy }];
  const points: LabelPoint[] = [];
  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const angle = ((fromDeg + ((toDeg - fromDeg) * i) / ARC_SEGMENTS) * Math.PI) / 180;
    points.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }
  return points;
}

/**
 * Jalur garis bingkai (mm), siap digoreskan dengan ujung dan sambungan membulat: `corners` = empat siku
 * (kiri-atas, kanan-atas, kanan-bawah, kiri-bawah), `box` = satu jalur tertutup. Sudut membulat didekati
 * dengan ruas garis, sehingga canvas dan PDF menggambar bentuk yang sama.
 */
export function framePolylines(el: Extract<LabelElement, { kind: 'frame' }>): LabelPoint[][] {
  const { xMm: x, yMm: y, sideMm: s } = el;
  const arm = Math.min(el.armMm, s / 2);
  const r = Math.min(el.radiusMm, s / 2, el.variant === 'corners' ? arm : s / 2);
  const x2 = x + s;
  const y2 = y + s;
  if (el.variant === 'box') {
    const ring = [
      { x: x + r, y },
      ...arcPoints(x2 - r, y + r, r, -90, 0),
      ...arcPoints(x2 - r, y2 - r, r, 0, 90),
      ...arcPoints(x + r, y2 - r, r, 90, 180),
      ...arcPoints(x + r, y + r, r, 180, 270),
    ];
    return [[...ring, { ...(ring[0] as LabelPoint) }]];
  }
  return [
    [{ x: x + arm, y }, ...arcPoints(x + r, y + r, r, -90, -180), { x, y: y + arm }],
    [{ x: x2 - arm, y }, ...arcPoints(x2 - r, y + r, r, -90, 0), { x: x2, y: y + arm }],
    [{ x: x2, y: y2 - arm }, ...arcPoints(x2 - r, y2 - r, r, 0, 90), { x: x2 - arm, y: y2 }],
    [{ x: x + arm, y: y2 }, ...arcPoints(x + r, y2 - r, r, 90, 180), { x, y: y2 - arm }],
  ];
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
  style: QrStyle;
}

function qrStyleSignature(style: QrStyle | undefined): unknown {
  const source = style ?? DEFAULT_QR_STYLE;
  return [
    QR_STYLE_PARTS.map((part) =>
      QR_TEXT_STYLE_KEYS.map((key) => (source[part][key] ? 1 : 0)).join(''),
    ),
    source.frame.kind,
    QR_FRAME_KEYS.map((key) => source.frame[key]),
  ];
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
      qrStyleSignature(content.style),
    ]),
  );
}

export function qrExportStatus(exportedHash: string, content: QrContent): QrExportStatus {
  if (exportedHash === '') return 'none';
  return exportedHash === qrContentHash(content) ? 'current' : 'stale';
}
