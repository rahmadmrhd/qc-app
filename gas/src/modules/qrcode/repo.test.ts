import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import {
  insertQrDesign_,
  insertQrDocument_,
  listQrDesigns_,
  listQrDocuments_,
  updateQrDesign_,
} from './repo';

beforeEach(() => setPlatform_(createMemoryPlatform()));

const design = {
  id: 'q1',
  title: '0815',
  linkSource: 'url' as const,
  link: 'https://a.co/x',
  documentId: '',
  subtitle: '=bukan formula',
  footer: '',
  logoFileId: '',
  layout: DEFAULT_QR_LAYOUT,
  style: DEFAULT_QR_STYLE,
  overflow: false,
  exportedHash: '',
  exportedAt: '',
  exportedBy: '',
  exportPdfDriveId: '',
  exportPngDriveId: '',
  createdAt: '2026-10-16T00:00:00.000Z',
  createdBy: 'a@x.com',
  updatedAt: '2026-10-16T00:00:00.000Z',
  updatedBy: 'a@x.com',
};

test('desain: simpan, baca, ubah — teks mirip angka/formula tetap apa adanya, layout kembali utuh', () => {
  insertQrDesign_(design);
  const [saved] = listQrDesigns_();
  expect(saved).toMatchObject({
    id: 'q1',
    title: '0815',
    subtitle: '=bukan formula',
    layout: DEFAULT_QR_LAYOUT,
  });
  updateQrDesign_({
    ...(saved as NonNullable<typeof saved>),
    exportedHash: 'abc12345',
    exportPdfDriveId: 'file-9',
  });
  expect(listQrDesigns_()[0]).toMatchObject({
    exportedHash: 'abc12345',
    exportPdfDriveId: 'file-9',
  });
});

test('layout tersimpan yang rusak dipulihkan ke bawaan, bukan melempar', () => {
  insertQrDesign_({ ...design, layout: { ...DEFAULT_QR_LAYOUT } });
  const platform = createMemoryPlatform();
  setPlatform_(platform);
  insertQrDesign_(design);
  const sheet = platform.db.sheet('qr_designs');
  const header = sheet.rows[0] as string[];
  (sheet.rows[1] as unknown[])[header.indexOf('layout')] = '{bukan json';
  expect(listQrDesigns_()[0]?.layout).toEqual(DEFAULT_QR_LAYOUT);
});

test('dokumen: simpan dan baca', () => {
  insertQrDocument_({
    id: 'd1',
    driveId: 'file-1',
    name: 'manual.pdf',
    size: 1200,
    shared: true,
    createdAt: '2026-10-16T00:00:00.000Z',
    createdBy: 'a@x.com',
    updatedAt: '2026-10-16T00:00:00.000Z',
    updatedBy: 'a@x.com',
  });
  expect(listQrDocuments_()[0]).toMatchObject({
    id: 'd1',
    driveId: 'file-1',
    size: 1200,
    shared: true,
  });
  // kolom shared kosong (baris lama) dianggap dibagikan; '0' = sudah dicabut
  const platform = createMemoryPlatform();
  setPlatform_(platform);
  insertQrDocument_({
    id: 'd2',
    driveId: 'file-2',
    name: 'x.pdf',
    size: 1,
    shared: false,
    createdAt: 't',
    createdBy: 'a',
    updatedAt: 't',
    updatedBy: 'a',
  });
  expect(listQrDocuments_()[0]?.shared).toBe(false);
  const sheet = platform.db.sheet('qr_documents');
  const header = sheet.rows[0] as string[];
  (sheet.rows[1] as unknown[])[header.indexOf('shared')] = '';
  expect(listQrDocuments_()[0]?.shared).toBe(true);
});

test('gaya tersimpan kembali utuh; kolom style kosong atau rusak dipulihkan ke bawaan', () => {
  const styled = {
    ...DEFAULT_QR_STYLE,
    frame: { ...DEFAULT_QR_STYLE.frame, kind: 'box' as const },
  };
  insertQrDesign_({ ...design, style: styled });
  expect(listQrDesigns_()[0]?.style).toEqual(styled);
  const platform = createMemoryPlatform();
  setPlatform_(platform);
  insertQrDesign_(design);
  const sheet = platform.db.sheet('qr_designs');
  const header = sheet.rows[0] as string[];
  const row = sheet.rows[1] as unknown[];
  row[header.indexOf('style')] = '';
  expect(listQrDesigns_()[0]?.style).toEqual(DEFAULT_QR_STYLE);
  row[header.indexOf('style')] = '{bukan json';
  expect(listQrDesigns_()[0]?.style).toEqual(DEFAULT_QR_STYLE);
});
