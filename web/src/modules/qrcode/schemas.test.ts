import { DEFAULT_QR_LAYOUT } from '@shared/qrcode';
import { expect, test } from 'vitest';
import {
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
