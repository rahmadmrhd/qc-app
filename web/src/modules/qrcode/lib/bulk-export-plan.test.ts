import type { QrDesignDto } from '@shared/contract';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import { expect, test } from 'vitest';
import { classifyForExport, summarizeBulkExport } from './bulk-export-plan';

const design = (id: string, patch: Partial<QrDesignDto> = {}): QrDesignDto => ({
  id,
  title: `Judul ${id}`,
  linkSource: 'url',
  link: 'https://contoh.com/a',
  documentId: '',
  documentName: '',
  subtitle: '',
  footer: '',
  logoFileId: '',
  layout: DEFAULT_QR_LAYOUT,
  style: DEFAULT_QR_STYLE,
  overflow: false,
  name: `MB ${id}`,
  namePlacement: '',
  presetId: '',
  items: [{ id: `it-${id}`, brand: 'PBE', model: `M-${id}` }],
  hiddenItemCount: 0,
  stickerVersion: 0,
  stickerStatus: '',
  exportStatus: 'none',
  exportedAt: '',
  exportedBy: '',
  createdAt: 't',
  createdBy: 'a@x.com',
  updatedAt: '2026-11-02T00:00:00.000Z',
  updatedBy: 'a@x.com',
  ...patch,
});

test('belum pernah diekspor: ekspor pertama, tanpa timpa', () => {
  expect(classifyForExport(design('a'))).toEqual({ kind: 'export-new', overwrites: false });
});

test('berubah sejak ekspor dan sudah punya versi stiker: versi baru (butuh alasan) dan menimpa', () => {
  const plan = classifyForExport(
    design('a', {
      exportStatus: 'stale',
      stickerVersion: 2,
      exportedAt: '2026-11-01T00:00:00.000Z',
    }),
  );
  expect(plan).toEqual({ kind: 'export-new-version', overwrites: true });
});

test('berubah tetapi diekspor sebelum 4a (versi 0): ekspor pertama tanpa alasan, tetap menimpa', () => {
  const plan = classifyForExport(
    design('a', {
      exportStatus: 'stale',
      stickerVersion: 0,
      exportedAt: '2026-10-01T00:00:00.000Z',
    }),
  );
  expect(plan).toEqual({ kind: 'export-new', overwrites: true });
});

test('sudah terbaru dilewati dan dibedakan dari yang tak lengkap', () => {
  expect(
    classifyForExport(design('a', { exportStatus: 'current', stickerVersion: 1, exportedAt: 'x' })),
  ).toEqual({ kind: 'skip', skipCause: 'current', skipReason: 'Sudah terbaru', overwrites: false });
});

test.each([
  ['terhapus', { deleted: { deletedAt: 't', deletedBy: 'a' } }, 'Konfigurasi sudah dihapus'],
  ['isi tak muat', { overflow: true }, 'Isi label tidak muat di kanvas 3 × 3 cm'],
  ['nama kosong', { name: '  ' }, 'Belum bernama'],
  ['tanpa item', { items: [], hiddenItemCount: 0 }, 'Belum punya item'],
  [
    'hanya item terhapus',
    { items: [{ id: 'i', brand: 'B', model: 'M', deleted: true }] },
    'Belum punya item',
  ],
] as const)('tak lengkap (%s) dilewati', (_label, patch, reason) => {
  const plan = classifyForExport(design('a', patch as Partial<QrDesignDto>));
  expect(plan).toMatchObject({ kind: 'skip', skipCause: 'incomplete', skipReason: reason });
});

test('item yang tak terlihat bagi pembaca tetap dihitung sebagai item', () => {
  const plan = classifyForExport(design('a', { items: [], hiddenItemCount: 2 }));
  expect(plan.kind).toBe('export-new');
});

test('ringkasan menghitung per jenis dan memisahkan sudah terbaru dari tak lengkap', () => {
  const summary = summarizeBulkExport([
    design('first'),
    design('ver', { exportStatus: 'stale', stickerVersion: 1, exportedAt: 'x' }),
    design('cur', { exportStatus: 'current', stickerVersion: 1, exportedAt: 'x' }),
    design('over', { overflow: true, name: 'Besar' }),
  ]);
  expect(summary).toEqual({
    exportable: 2,
    newVersions: 1,
    firstTime: 1,
    overwrites: 1,
    current: 1,
    skipped: [{ id: 'over', name: 'Besar', reason: 'Isi label tidak muat di kanvas 3 × 3 cm' }],
  });
});
