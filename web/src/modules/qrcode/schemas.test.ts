import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import { expect, test } from 'vitest';
import {
  frameRangeMessage,
  qrDesignFormSchema,
  toDuplicateDefaults,
  toQrFormDefaults,
  toSaveQrDesignInput,
} from './schemas';

const valid = {
  title: 'Panduan',
  linkSource: 'url' as const,
  link: 'https://contoh.com/a',
  documentId: '',
  subtitle: '',
  footer: '',
  logoFileId: '',
  layout: DEFAULT_QR_LAYOUT,
  style: DEFAULT_QR_STYLE,
};

test('skema: sumber url butuh link http(s); sumber pdf butuh documentId', () => {
  expect(qrDesignFormSchema.safeParse(valid).success).toBe(true);
  expect(qrDesignFormSchema.safeParse({ ...valid, link: 'ftp://x' }).success).toBe(false);
  expect(qrDesignFormSchema.safeParse({ ...valid, link: '' }).success).toBe(false);
  expect(qrDesignFormSchema.safeParse({ ...valid, linkSource: 'pdf', link: '' }).success).toBe(
    false,
  );
  expect(
    qrDesignFormSchema.safeParse({ ...valid, linkSource: 'pdf', link: '', documentId: 'd1' })
      .success,
  ).toBe(true);
});

test('skema: batas teks, karakter di luar font, dan rentang ukuran', () => {
  expect(qrDesignFormSchema.safeParse({ ...valid, title: '' }).success).toBe(false);
  expect(qrDesignFormSchema.safeParse({ ...valid, title: 'x'.repeat(61) }).success).toBe(false);
  expect(qrDesignFormSchema.safeParse({ ...valid, footer: '中文' }).success).toBe(false);
  expect(
    qrDesignFormSchema.safeParse({ ...valid, layout: { ...DEFAULT_QR_LAYOUT, qrSize: 99 } })
      .success,
  ).toBe(false);
  expect(
    qrDesignFormSchema.safeParse({ ...valid, layout: { ...DEFAULT_QR_LAYOUT, gap: Number.NaN } })
      .success,
  ).toBe(false);
});

test('toSaveQrDesignInput: id dan expectedUpdatedAt hanya untuk ubah; link dikosongkan bila sumber pdf', () => {
  const parsed = qrDesignFormSchema.parse(valid);
  expect('id' in toSaveQrDesignInput(parsed)).toBe(false);
  expect(toSaveQrDesignInput(parsed, 'q1', 't')).toMatchObject({
    id: 'q1',
    expectedUpdatedAt: 't',
  });
  const pdf = qrDesignFormSchema.parse({
    ...valid,
    linkSource: 'pdf',
    link: 'abaikan',
    documentId: 'd1',
  });
  expect(toSaveQrDesignInput(pdf)).toMatchObject({ link: '', documentId: 'd1' });
});

test('defaults: kosong memakai layout bawaan; duplikat menyalin semuanya dengan judul "(salinan)" dalam batas 60', () => {
  expect(toQrFormDefaults().layout).toEqual(DEFAULT_QR_LAYOUT);
  const design = {
    id: 'q1',
    title: 'x'.repeat(58),
    linkSource: 'url' as const,
    link: 'https://a.co',
    documentId: '',
    documentName: '',
    documentUses: 0,
    subtitle: 's',
    footer: 'f',
    logoFileId: 'logo-1',
    layout: DEFAULT_QR_LAYOUT,
    style: DEFAULT_QR_STYLE,
    exportStatus: 'current' as const,
    exportedAt: 't',
    exportedBy: 'a',
    createdAt: 't',
    createdBy: 'a',
    updatedAt: 't',
    updatedBy: 'a',
  };
  const copy = toDuplicateDefaults(design);
  expect(copy.title.length).toBeLessThanOrEqual(60);
  expect(copy.title.endsWith('(salinan)')).toBe(true);
  expect(copy).toMatchObject({
    link: 'https://a.co',
    logoFileId: 'logo-1',
    subtitle: 's',
    footer: 'f',
  });
});

test('skema gaya: bingkai di luar rentang atau jenis tak dikenal ditolak; gaya sah diterima', () => {
  const frame = DEFAULT_QR_STYLE.frame;
  const withFrame = (patch: Record<string, unknown>) => ({
    ...valid,
    style: { ...DEFAULT_QR_STYLE, frame: { ...frame, ...patch } },
  });
  expect(qrDesignFormSchema.safeParse(withFrame({ kind: 'corners' })).success).toBe(true);
  expect(qrDesignFormSchema.safeParse(withFrame({ kind: 'bulat' })).success).toBe(false);
  expect(qrDesignFormSchema.safeParse(withFrame({ thickness: 9 })).success).toBe(false);
  expect(qrDesignFormSchema.safeParse(withFrame({ gap: Number.NaN })).success).toBe(false);
  const badTitle = { ...DEFAULT_QR_STYLE, title: { ...DEFAULT_QR_STYLE.title, italic: 'ya' } };
  expect(qrDesignFormSchema.safeParse({ ...valid, style: badTitle }).success).toBe(false);
});

test('gaya dikirim ke server dan disalin saat duplikat; bawaan form = gaya bawaan', () => {
  const style = { ...DEFAULT_QR_STYLE, footer: { ...DEFAULT_QR_STYLE.footer, underline: true } };
  const parsed = qrDesignFormSchema.parse({ ...valid, style });
  expect(toSaveQrDesignInput(parsed).style).toEqual(style);
  expect(toQrFormDefaults().style).toEqual(DEFAULT_QR_STYLE);
  const design = {
    id: 'q1',
    title: 'Dengan gaya',
    linkSource: 'url' as const,
    link: 'https://a.co',
    documentId: '',
    documentName: '',
    documentUses: 0,
    subtitle: '',
    footer: '',
    logoFileId: '',
    layout: DEFAULT_QR_LAYOUT,
    style,
    exportStatus: 'none' as const,
    exportedAt: '',
    exportedBy: '',
    createdAt: 't',
    createdBy: 'a',
    updatedAt: 't',
    updatedBy: 'a',
  };
  expect(toDuplicateDefaults(design).style).toEqual(style);
});

test('frameRangeMessage: pesan per isian bingkai', () => {
  expect(frameRangeMessage('thickness', 0.5)).toBeNull();
  expect(frameRangeMessage('thickness', 9)).toBe('Maksimal 1.5 mm');
  expect(frameRangeMessage('arm', 5)).toBe('Minimal 10 %');
  expect(frameRangeMessage('gap', Number.NaN)).toBe('Wajib diisi angka');
});
