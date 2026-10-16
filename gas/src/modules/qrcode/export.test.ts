import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { listAuditRecords_ } from '@gas/modules/access/repo';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { qrRpc, seedQrEnv } from '@gas-test/qrcode-env';
import { DEFAULT_QR_LAYOUT } from '@shared/qrcode';
import { listQrDesigns_ } from './repo';

let platform: MemoryPlatform;
let clock: number;
beforeEach(() => {
  clock = Date.parse('2026-10-16T03:00:00.000Z');
  platform = createMemoryPlatform({
    properties: { ADMIN_EMAIL: 'admin@gmail.com', SESSION_SECRET: 's' },
    now: () => clock,
  });
  setPlatform_(platform);
  seedQrEnv();
});
// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Result = { ok: boolean; data?: any; error?: any };
const call = (email: string, method: string, payload: unknown) =>
  qrRpc(email, method, payload) as Result;
const PDF = 'JVBERi0xLjQK';
const PNG = 'iVBORw0KGgoAAAANSUhEUg==';
const body = {
  title: 'Panduan Instalasi',
  linkSource: 'url',
  link: 'https://a.co/x',
  documentId: '',
  subtitle: '',
  footer: '',
  logoFileId: '',
  layout: DEFAULT_QR_LAYOUT,
};
const make = () => call('qredit@gmail.com', 'qrcodes.save', body).data;
const exportOf = (
  design: { id: string; updatedAt: string },
  extra: Record<string, unknown> = {},
  email = 'qrmanage@gmail.com',
) =>
  call(email, 'qrcodes.export', {
    id: design.id,
    expectedUpdatedAt: design.updatedAt,
    pdfBase64: PDF,
    pngBase64: PNG,
    ...extra,
  });

test('ekspor: PDF dan PNG di folder QR, status Sudah diekspor, pelaku dan waktu, audit qrcode.export', () => {
  const design = make();
  clock += 1000;
  const out = exportOf(design);
  expect(out.ok).toBe(true);
  expect(out.data).toMatchObject({ exportStatus: 'current', exportedBy: 'qrmanage@gmail.com' });
  const record = listQrDesigns_()[0];
  if (!record) throw new Error('kosong');
  const folder = platform.getProperty('QR_FOLDER_ID');
  expect(platform.drive.get(record.exportPdfDriveId)).toMatchObject({
    mime: 'application/pdf',
    folderId: folder,
  });
  expect(platform.drive.get(record.exportPngDriveId)).toMatchObject({
    mime: 'image/png',
    folderId: folder,
  });
  expect(platform.drive.get(record.exportPdfDriveId)?.name).toContain('panduan-instalasi');
  expect(listAuditRecords_().map((r) => r.action)).toEqual(['qrcode.create', 'qrcode.export']);
});

test('izin: hanya manage; edit dan view FORBIDDEN', () => {
  const design = make();
  expect(exportOf(design, {}, 'qredit@gmail.com').error.code).toBe('FORBIDDEN');
  expect(exportOf(design, {}, 'qrview@gmail.com').error.code).toBe('FORBIDDEN');
});

test('status Berubah sejak ekspor setelah konfigurasi diubah; ekspor ulang kembali Sudah', () => {
  const design = make();
  exportOf(design);
  clock += 1000;
  const changed = call('qredit@gmail.com', 'qrcodes.save', {
    ...body,
    id: design.id,
    expectedUpdatedAt: design.updatedAt,
    title: 'Judul Baru',
  }).data;
  expect(changed.exportStatus).toBe('stale');
  clock += 1000;
  expect(exportOf(changed).data.exportStatus).toBe('current');
});

test('ekspor ulang menimpa: berkas lama masuk sampah SETELAH pencatatan; hanya dua berkas ekspor tersisa', () => {
  const design = make();
  exportOf(design);
  const first = listQrDesigns_()[0];
  clock += 1000;
  const again = call('qrmanage@gmail.com', 'qrcodes.get', { id: design.id }).data;
  expect(exportOf(again).ok).toBe(true);
  const second = listQrDesigns_()[0];
  expect(second?.exportPdfDriveId).not.toBe(first?.exportPdfDriveId);
  expect(platform.drive.has(first?.exportPdfDriveId ?? '')).toBe(false);
  expect(platform.drive.has(first?.exportPngDriveId ?? '')).toBe(false);
  expect(
    [...platform.drive.values()].filter((f) => f.folderId === platform.getProperty('QR_FOLDER_ID')),
  ).toHaveLength(2);
});

test('konkurensi: expectedUpdatedAt basi → CONFLICT dan TIDAK ada berkas dibuat di Drive', () => {
  const design = make();
  const out = exportOf(design, { expectedUpdatedAt: '2020-01-01T00:00:00.000Z' });
  expect(out.error.code).toBe('CONFLICT');
  expect(platform.drive.size).toBe(0);
});

test('PDF/PNG palsu atau di atas batas ditolak sebelum Drive', () => {
  const design = make();
  expect(exportOf(design, { pdfBase64: PNG }).error.code).toBe('VALIDATION');
  expect(exportOf(design, { pngBase64: PDF }).error.code).toBe('VALIDATION');
  expect(platform.drive.size).toBe(0);
});

test('pencatatan gagal setelah Drive berhasil: berkas baru dibersihkan, berkas lama utuh', () => {
  const design = make();
  exportOf(design);
  const first = listQrDesigns_()[0];
  clock += 1000;
  const again = call('qrmanage@gmail.com', 'qrcodes.get', { id: design.id }).data;
  const original = platform.withLock.bind(platform);
  let calls = 0;
  platform.withLock = <T>(fn: () => T): T => {
    calls++;
    // Lock #1 = ensureQrFolder_ (sebelum Drive), lock #2 = pencatatan: gagalkan yang kedua.
    if (calls === 2) throw new Error('lock habis');
    return original(fn);
  };
  expect(exportOf(again).ok).toBe(false);
  platform.withLock = original;
  expect(platform.drive.has(first?.exportPdfDriveId ?? '')).toBe(true);
  expect(
    [...platform.drive.values()].filter((f) => f.folderId === platform.getProperty('QR_FOLDER_ID')),
  ).toHaveLength(2);
});

test('unduh: view cukup; belum diekspor NOT_FOUND; nama berkas dari judul; id Drive tidak pernah dari klien', () => {
  const design = make();
  expect(call('qrview@gmail.com', 'qrcodes.file', { id: design.id, kind: 'pdf' }).error.code).toBe(
    'NOT_FOUND',
  );
  exportOf(design);
  const pdf = call('qrview@gmail.com', 'qrcodes.file', { id: design.id, kind: 'pdf' });
  expect(pdf.data).toEqual({
    filename: 'panduan-instalasi.pdf',
    mime: 'application/pdf',
    base64: PDF,
  });
  const png = call('qrview@gmail.com', 'qrcodes.file', { id: design.id, kind: 'png' });
  expect(png.data).toMatchObject({
    filename: 'panduan-instalasi.png',
    mime: 'image/png',
    base64: PNG,
  });
  expect(call('noqr@gmail.com', 'qrcodes.file', { id: design.id, kind: 'pdf' }).error.code).toBe(
    'FORBIDDEN',
  );
  expect(
    call('qrview@gmail.com', 'qrcodes.file', { id: 'tidak-ada', kind: 'pdf' }).error.code,
  ).toBe('NOT_FOUND');
});

test('hapus setelah ekspor membuang kedua berkas ekspor', () => {
  const design = make();
  exportOf(design);
  expect(call('qrmanage@gmail.com', 'qrcodes.delete', { id: design.id }).ok).toBe(true);
  expect(
    [...platform.drive.values()].filter((f) => f.folderId === platform.getProperty('QR_FOLDER_ID')),
  ).toHaveLength(0);
});

test('mengubah gaya/bingkai setelah ekspor = Berubah sejak ekspor', () => {
  const design = make();
  exportOf(design);
  clock += 1000;
  const style = {
    title: { bold: true, italic: false, underline: false, strike: false, uppercase: false },
    subtitle: { bold: false, italic: false, underline: false, strike: false, uppercase: false },
    footer: { bold: false, italic: false, underline: false, strike: false, uppercase: false },
    frame: { kind: 'box', line: 'solid', thickness: 0.5, gap: 1, radius: 1.5, arm: 25 },
  };
  const changed = call('qredit@gmail.com', 'qrcodes.save', {
    ...body,
    id: design.id,
    expectedUpdatedAt: design.updatedAt,
    style,
  }).data;
  expect(changed.exportStatus).toBe('stale');
});

test('galat saat membuang berkas lama SETELAH pencatatan tidak menggagalkan ekspor dan tidak membuang berkas baru', () => {
  const design = make();
  exportOf(design);
  const first = listQrDesigns_()[0];
  clock += 1000;
  const again = call('qrmanage@gmail.com', 'qrcodes.get', { id: design.id }).data;
  const trash = platform.driveTrashFile.bind(platform);
  platform.driveTrashFile = (id: string) => {
    if (id === first?.exportPdfDriveId) throw new Error('Drive menolak');
    trash(id);
  };
  const out = exportOf(again);
  expect(out.ok).toBe(true);
  const second = listQrDesigns_()[0];
  expect(second?.exportPdfDriveId).not.toBe(first?.exportPdfDriveId);
  expect(platform.drive.has(second?.exportPdfDriveId ?? '')).toBe(true);
  expect(platform.drive.has(second?.exportPngDriveId ?? '')).toBe(true);
  expect(platform.errors.some((m) => m.includes('Drive menolak'))).toBe(true);
});
