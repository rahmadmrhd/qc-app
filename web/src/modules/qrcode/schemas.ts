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
import type { QrDesignDto, QrPresetDto, SaveQrDesignInput, SaveQrPresetInput } from '@shared/rpc';
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
export const QR_PRESET_FIELD_KEYS = [
  'name',
  'title',
  'subtitle',
  'footer',
  'layout',
  'style',
  'defaultLogoId',
] as const;
export type QrPresetFieldErrors = Partial<Record<(typeof QR_PRESET_FIELD_KEYS)[number], string>>;
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

const qrFormShape = (titleRequired: boolean, nameRequired: boolean) => ({
  /** Hanya konfigurasi default: nama untuk dipilih user saat membuat QR. Konfigurasi QR mengabaikannya. */
  name: z
    .string()
    .trim()
    .max(QR_LIMITS.presetName, `Maksimal ${QR_LIMITS.presetName} karakter`)
    .refine((value) => !nameRequired || value !== '', 'Wajib diisi')
    .default(''),
  title: text(QR_LIMITS.title, titleRequired),
  linkSource: z.enum(['url', 'pdf']),
  link: z.string().trim().max(QR_LIMITS.link, `Maksimal ${QR_LIMITS.link} karakter`),
  documentId: z.string(),
  subtitle: text(QR_LIMITS.subtitle, false),
  footer: text(QR_LIMITS.footer, false),
  /** QR: logo terpilih dari pustaka. Default: logo awal pada QR baru. */
  logoFileId: z.string(),
  layout: layoutSchema,
  style: styleSchema,
});

/** Konfigurasi default: tanpa sumber link, nama wajib, title boleh kosong. */
export const qrPresetFormSchema = z.object(qrFormShape(false, true));

export const qrDesignFormSchema = z.object(qrFormShape(true, false)).superRefine((value, ctx) => {
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
    name: '',
    title: design?.title ?? '',
    linkSource: design?.linkSource ?? 'pdf',
    link: design?.linkSource === 'url' ? design.link : '',
    documentId: design?.documentId ?? '',
    subtitle: design?.subtitle ?? '',
    footer: design?.footer ?? '',
    logoFileId: design?.logoFileId ?? '',
    layout: design ? { ...design.layout } : { ...DEFAULT_QR_LAYOUT },
    style: structuredClone(design ? design.style : DEFAULT_QR_STYLE),
  };
}

/** Satu konfigurasi default sebagai nilai form (logoFileId = logo awal). Tanpa sumber link. */
export function toPresetFormValues(preset?: QrPresetDto): QrFormInput {
  return {
    name: preset?.name ?? '',
    title: preset?.title ?? '',
    linkSource: 'pdf',
    link: '',
    documentId: '',
    subtitle: preset?.subtitle ?? '',
    footer: preset?.footer ?? '',
    logoFileId: preset?.defaultLogoId ?? '',
    layout: preset ? { ...preset.layout } : { ...DEFAULT_QR_LAYOUT },
    style: structuredClone(preset ? preset.style : DEFAULT_QR_STYLE),
  };
}

/** QR baru: semua isian awal diambil dari konfigurasi default yang dipilih (tanpa sumber link). */
export function toNewDesignFromPreset(preset: QrPresetDto): QrFormInput {
  return { ...toPresetFormValues(preset), name: '' };
}

/** Bagian isi (opsional) yang disalin ulang dari konfigurasi default; gaya, ukuran, dan bingkai selalu ikut. */
export interface PresetApplyParts {
  title: boolean;
  subtitle: boolean;
  footer: boolean;
  logo: boolean;
}

export type PresetPatch = Partial<
  Pick<QrFormInput, 'title' | 'subtitle' | 'footer' | 'logoFileId'>
> &
  Pick<QrFormInput, 'layout' | 'style'>;

export function presetPatch(preset: QrPresetDto, parts: PresetApplyParts): PresetPatch {
  const values = toNewDesignFromPreset(preset);
  return {
    ...(parts.title ? { title: values.title } : {}),
    ...(parts.subtitle ? { subtitle: values.subtitle } : {}),
    ...(parts.footer ? { footer: values.footer } : {}),
    ...(parts.logo ? { logoFileId: values.logoFileId } : {}),
    layout: values.layout,
    style: values.style,
  };
}

export function toSaveQrPresetInput(
  values: z.output<typeof qrPresetFormSchema>,
  id?: string,
  expectedUpdatedAt?: string,
): SaveQrPresetInput {
  return {
    ...(id ? { id } : {}),
    ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
    name: values.name,
    title: values.title,
    subtitle: values.subtitle,
    footer: values.footer,
    layout: values.layout,
    style: values.style,
    defaultLogoId: values.logoFileId,
  };
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
