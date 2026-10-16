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
import type { QrDesignDto, SaveQrDesignInput } from '@shared/rpc';
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
  logoPercent: num('logoPercent'),
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

export const qrDesignFormSchema = z
  .object({
    title: text(QR_LIMITS.title, true),
    linkSource: z.enum(['url', 'pdf']),
    link: z.string().trim().max(QR_LIMITS.link, `Maksimal ${QR_LIMITS.link} karakter`),
    documentId: z.string(),
    subtitle: text(QR_LIMITS.subtitle, false),
    footer: text(QR_LIMITS.footer, false),
    logoFileId: z.string(),
    layout: layoutSchema,
    style: styleSchema,
  })
  .superRefine((value, ctx) => {
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
    linkSource: design?.linkSource ?? 'url',
    link: design?.linkSource === 'url' ? design.link : '',
    documentId: design?.documentId ?? '',
    subtitle: design?.subtitle ?? '',
    footer: design?.footer ?? '',
    logoFileId: design?.logoFileId ?? '',
    layout: design ? { ...design.layout } : { ...DEFAULT_QR_LAYOUT },
    style: structuredClone(design ? design.style : DEFAULT_QR_STYLE),
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
