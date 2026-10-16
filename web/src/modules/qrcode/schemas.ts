import {
  DEFAULT_QR_LAYOUT,
  DEFAULT_QR_STYLE,
  isHttpUrl,
  isRenderableLabelText,
  type QR_FRAME_KEYS,
  QR_FRAME_KINDS,
  QR_FRAME_LINES,
  QR_FRAME_RANGES,
  QR_LAYOUT_RANGES,
  QR_LIMITS,
} from '@shared/qrcode';
import type {
  QrDefaultsDto,
  QrDesignDto,
  SaveQrDefaultsInput,
  SaveQrDesignInput,
} from '@shared/rpc';
import { z } from 'zod';

export const QR_FIELD_KEYS = [
  'title',
  'link',
  'documentId',
  'subtitle',
  'footer',
  'logoFileId',
  'layout',
  'style',
] as const;
export const QR_DEFAULTS_FIELD_KEYS = [
  'title',
  'subtitle',
  'footer',
  'layout',
  'style',
  'logoFileIds',
  'defaultLogoId',
] as const;
export type QrDefaultsFieldErrors = Partial<
  Record<(typeof QR_DEFAULTS_FIELD_KEYS)[number], string>
>;
export type QrFieldErrors = Partial<Record<(typeof QR_FIELD_KEYS)[number], string>>;

const num = (key: keyof typeof QR_LAYOUT_RANGES) => {
  const range = QR_LAYOUT_RANGES[key];
  return z
    .number('Wajib diisi angka')
    .min(range.min, `Minimal ${range.min} ${range.unit}`)
    .max(range.max, `Maksimal ${range.max} ${range.unit}`);
};

const textStyleSchema = z.object({
  bold: z.boolean(),
  italic: z.boolean(),
  underline: z.boolean(),
  strike: z.boolean(),
  uppercase: z.boolean(),
});

const frameNum = (key: (typeof QR_FRAME_KEYS)[number]) => {
  const range = QR_FRAME_RANGES[key];
  return z
    .number('Wajib diisi angka')
    .min(range.min, `Minimal ${range.min} ${range.unit}`)
    .max(range.max, `Maksimal ${range.max} ${range.unit}`);
};

const styleSchema = z.object({
  title: textStyleSchema,
  subtitle: textStyleSchema,
  footer: textStyleSchema,
  frame: z.object({
    kind: z.enum(QR_FRAME_KINDS),
    line: z.enum(QR_FRAME_LINES),
    thickness: frameNum('thickness'),
    gap: frameNum('gap'),
    radius: frameNum('radius'),
    arm: frameNum('arm'),
  }),
});

const layoutSchema = z.object({
  titleSize: num('titleSize'),
  subtitleSize: num('subtitleSize'),
  footerSize: num('footerSize'),
  qrSize: num('qrSize'),
  logoArea: num('logoArea'),
  gap: num('gap'),
  padding: num('padding'),
});

const text = (max: number, required: boolean) =>
  z
    .string()
    .trim()
    .max(max, `Maksimal ${max} karakter`)
    .refine((value) => !required || value !== '', 'Wajib diisi')
    .refine(
      isRenderableLabelText,
      'Karakter tidak didukung font label (gunakan huruf Latin, angka, tanda baca umum)',
    );

const qrFormShape = (titleRequired: boolean) => ({
  title: text(QR_LIMITS.title, titleRequired),
  linkSource: z.enum(['url', 'pdf']),
  link: z.string().trim().max(QR_LIMITS.link, `Maksimal ${QR_LIMITS.link} karakter`),
  documentId: z.string(),
  subtitle: text(QR_LIMITS.subtitle, false),
  footer: text(QR_LIMITS.footer, false),
  /** QR: logo terpilih dari pustaka. Default: logo awal pada QR baru. */
  logoFileId: z.string(),
  /** Hanya konfigurasi default: pustaka logo. Konfigurasi QR mengabaikannya. */
  logoLibrary: z
    .array(z.string())
    .max(QR_LIMITS.logoLibrary, `Maksimal ${QR_LIMITS.logoLibrary} logo`)
    .default([]),
  layout: layoutSchema,
  style: styleSchema,
});

/** Konfigurasi default: tanpa sumber link, title boleh kosong. */
export const qrDefaultsFormSchema = z.object(qrFormShape(false));

export const qrDesignFormSchema = z.object(qrFormShape(true)).superRefine((value, ctx) => {
  if (value.linkSource === 'url') {
    if (value.link === '')
      ctx.addIssue({ code: 'custom', path: ['link'], message: 'Link wajib diisi' });
    else if (!isHttpUrl(value.link)) {
      ctx.addIssue({
        code: 'custom',
        path: ['link'],
        message: 'Link harus diawali http:// atau https:// tanpa spasi',
      });
    }
  } else if (value.documentId === '') {
    ctx.addIssue({ code: 'custom', path: ['documentId'], message: 'Unggah PDF dulu' });
  }
});

/** Pesan galat satu isian ukuran (langsung, tanpa menunggu simpan); `null` bila sah. */
export function layoutRangeMessage(
  key: keyof typeof QR_LAYOUT_RANGES,
  value: number,
): string | null {
  const range = QR_LAYOUT_RANGES[key];
  if (Number.isNaN(value)) return 'Wajib diisi angka';
  if (value < range.min) return `Minimal ${range.min} ${range.unit}`;
  if (value > range.max) return `Maksimal ${range.max} ${range.unit}`;
  return null;
}

/** Pesan galat satu isian bingkai (langsung, tanpa menunggu simpan); `null` bila sah. */
export function frameRangeMessage(
  key: (typeof QR_FRAME_KEYS)[number],
  value: number,
): string | null {
  const range = QR_FRAME_RANGES[key];
  if (Number.isNaN(value)) return 'Wajib diisi angka';
  if (value < range.min) return `Minimal ${range.min} ${range.unit}`;
  if (value > range.max) return `Maksimal ${range.max} ${range.unit}`;
  return null;
}

export type QrFormInput = z.input<typeof qrDesignFormSchema>;
export type QrFormOutput = z.output<typeof qrDesignFormSchema>;

export function toQrFormDefaults(design?: QrDesignDto): QrFormInput {
  return {
    title: design?.title ?? '',
    linkSource: design?.linkSource ?? 'pdf',
    link: design?.linkSource === 'url' ? design.link : '',
    documentId: design?.documentId ?? '',
    subtitle: design?.subtitle ?? '',
    footer: design?.footer ?? '',
    logoFileId: design?.logoFileId ?? '',
    logoLibrary: [],
    layout: design ? { ...design.layout } : { ...DEFAULT_QR_LAYOUT },
    style: structuredClone(design ? design.style : DEFAULT_QR_STYLE),
  };
}

/** Konfigurasi default sebagai nilai form (title boleh kosong; logoFileId = logo awal; logoLibrary = pustaka). */
export function toQrDefaultsFormValues(defaults: QrDefaultsDto): QrFormInput {
  return {
    title: defaults.title,
    linkSource: 'pdf',
    link: '',
    documentId: '',
    subtitle: defaults.subtitle,
    footer: defaults.footer,
    logoFileId: defaults.defaultLogoId,
    logoLibrary: [...defaults.logoFileIds],
    layout: { ...defaults.layout },
    style: structuredClone(defaults.style),
  };
}

/** QR baru: semua isian awal diambil dari konfigurasi default (tanpa sumber link). */
export function toNewDesignDefaults(defaults: QrDefaultsDto): QrFormInput {
  return { ...toQrDefaultsFormValues(defaults), logoLibrary: [] };
}

export function toSaveQrDefaultsInput(
  values: z.output<typeof qrDefaultsFormSchema>,
  expectedUpdatedAt?: string,
): SaveQrDefaultsInput {
  return {
    ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
    title: values.title,
    subtitle: values.subtitle,
    footer: values.footer,
    layout: values.layout,
    style: values.style,
    logoFileIds: values.logoLibrary,
    defaultLogoId: values.logoFileId,
  };
}

/** Duplikat: salin seluruh isi (termasuk rujukan logo dan PDF); judul diberi "(salinan)" dalam batas panjang. */
export function toDuplicateDefaults(design: QrDesignDto): QrFormInput {
  const suffix = ' (salinan)';
  const title = `${design.title.slice(0, QR_LIMITS.title - suffix.length)}${suffix}`;
  return { ...toQrFormDefaults(design), title };
}

export function toSaveQrDesignInput(
  values: QrFormOutput,
  id?: string,
  expectedUpdatedAt?: string,
  /** Hasil pengukuran tata letak di peramban (isi tidak muat di kanvas). */
  overflow?: boolean,
): SaveQrDesignInput {
  const input: SaveQrDesignInput = {
    title: values.title,
    linkSource: values.linkSource,
    link: values.linkSource === 'url' ? values.link : '',
    documentId: values.linkSource === 'pdf' ? values.documentId : '',
    subtitle: values.subtitle,
    footer: values.footer,
    logoFileId: values.logoFileId,
    layout: values.layout,
    style: values.style,
    ...(overflow === undefined ? {} : { overflow }),
  };
  return id ? { id, ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}), ...input } : input;
}
