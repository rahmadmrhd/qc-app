import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import { expect, test } from 'vitest';
import {
  frameRangeMessage,
  qrDesignFormSchema,
  qrPresetFormSchema,
  toNewDesignFromPreset,
  toPresetFormValues,
  toQrFormDefaults,
  toSaveQrDesignInput,
  toSaveQrPresetInput,
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
  overflow: false,
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

test('defaults: kosong memakai layout bawaan', () => {
  expect(toQrFormDefaults().layout).toEqual(DEFAULT_QR_LAYOUT);
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

test('gaya dikirim ke server; bawaan form = gaya bawaan', () => {
  const style = { ...DEFAULT_QR_STYLE, footer: { ...DEFAULT_QR_STYLE.footer, underline: true } };
  const parsed = qrDesignFormSchema.parse({ ...valid, style });
  expect(toSaveQrDesignInput(parsed).style).toEqual(style);
  expect(toQrFormDefaults().style).toEqual(DEFAULT_QR_STYLE);
});

test('frameRangeMessage: pesan per isian bingkai', () => {
  expect(frameRangeMessage('thickness', 0.5)).toBeNull();
  expect(frameRangeMessage('thickness', 9)).toBe('Maksimal 1.5 mm');
  expect(frameRangeMessage('arm', 5)).toBe('Minimal 10 %');
  expect(frameRangeMessage('gap', Number.NaN)).toBe('Wajib diisi angka');
});

test('skema bingkai: gaya garis solid/dashed/dotted diterima, lainnya ditolak', () => {
  const withLine = (line: string) => ({
    ...valid,
    style: { ...DEFAULT_QR_STYLE, frame: { ...DEFAULT_QR_STYLE.frame, line } },
  });
  for (const ok of ['solid', 'dashed', 'dotted'])
    expect(qrDesignFormSchema.safeParse(withLine(ok)).success).toBe(true);
  expect(qrDesignFormSchema.safeParse(withLine('zigzag')).success).toBe(false);
});

test('toSaveQrDesignInput menyertakan flag overflow hanya bila diberikan', () => {
  const parsed = qrDesignFormSchema.parse(valid);
  expect(toSaveQrDesignInput(parsed, undefined, undefined, true).overflow).toBe(true);
  expect(toSaveQrDesignInput(parsed, 'q1', 't', false).overflow).toBe(false);
  expect('overflow' in toSaveQrDesignInput(parsed)).toBe(false);
});

test('konfigurasi default: nama wajib, title boleh kosong; nilai awal QR baru dari default; simpan memetakan logo awal', () => {
  const preset = {
    id: 'p1',
    name: 'Standar',
    title: 'PT Contoh',
    subtitle: 'Label',
    footer: 'www.contoh.com',
    layout: { ...DEFAULT_QR_LAYOUT, qrSize: 18 },
    style: DEFAULT_QR_STYLE,
    defaultLogoId: 'b',
    createdAt: 't',
    createdBy: 'x',
    updatedAt: 't',
    updatedBy: 'x',
  };
  const fresh = toNewDesignFromPreset(preset);
  expect(fresh).toMatchObject({
    name: '',
    title: 'PT Contoh',
    subtitle: 'Label',
    footer: 'www.contoh.com',
    logoFileId: 'b',
    linkSource: 'pdf',
    link: '',
    documentId: '',
  });
  expect(fresh.layout.qrSize).toBe(18);
  expect(qrPresetFormSchema.safeParse({ ...toPresetFormValues(preset), name: '  ' }).success).toBe(
    false,
  );
  const values = qrPresetFormSchema.parse({ ...toPresetFormValues(preset), title: '' });
  expect(toSaveQrPresetInput(values, 'p1', 't')).toEqual({
    id: 'p1',
    expectedUpdatedAt: 't',
    name: 'Standar',
    title: '',
    subtitle: 'Label',
    footer: 'www.contoh.com',
    layout: preset.layout,
    style: preset.style,
    defaultLogoId: 'b',
  });
  expect(toSaveQrPresetInput(values)).not.toHaveProperty('id');
  expect(toSaveQrPresetInput(values)).not.toHaveProperty('expectedUpdatedAt');
  expect(toPresetFormValues()).toMatchObject({ name: '', title: '', logoFileId: '' });
});
