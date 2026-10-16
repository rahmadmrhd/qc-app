import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { listAuditRecords_ } from '@gas/modules/access/repo';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { qrPdfDocumentId, qrRpc, seedQrEnv } from '@gas-test/qrcode-env';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import { insertQrDesign_, listQrDocuments_ } from './repo';
import { cleanupQrDocuments_ } from './service';

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
const url = {
  title: 'Panduan',
  linkSource: 'pdf',
  link: '',
  get documentId() {
    return qrPdfDocumentId();
  },
  subtitle: '',
  footer: '',
  logoFileId: '',
  layout: DEFAULT_QR_LAYOUT,
  style: DEFAULT_QR_STYLE,
};
const save = (payload: Record<string, unknown> = {}) =>
  call('qredit@gmail.com', 'qrcodes.save', { ...url, ...payload });
const upload = (name = 'manual.pdf') =>
  call('qredit@gmail.com', 'qrcodes.uploadPdf', { name, base64: PDF });
const usePdf = (documentId: string, extra: Record<string, unknown> = {}) =>
  save({ linkSource: 'pdf', link: '', documentId, ...extra });
const docs = () => listQrDocuments_();
const driveIdOf = (documentId: string) => docs().find((d) => d.id === documentId)?.driveId ?? '';
const audits = () => listAuditRecords_().map((r) => r.action);

// ---- expectedUpdatedAt wajib saat ubah

test('simpan-ubah wajib menyertakan expectedUpdatedAt (pertahanan berlapis terhadap timpa diam-diam)', () => {
  const made = save();
  const without = save({ id: made.data.id, title: 'Baru' });
  expect(without.error.code).toBe('VALIDATION');
  expect(without.error.fields.expectedUpdatedAt).toBeDefined();
  expect(save({ id: made.data.id, title: 'Baru', expectedUpdatedAt: made.data.updatedAt }).ok).toBe(
    true,
  );
  expect(save({ title: 'Buat baru tanpa id' }).ok).toBe(true); // buat tidak butuh
});

// ---- flag "tidak muat" (Opsi A)

test('flag overflow dari peramban: tersimpan, tampil di get/list, bawaan false, dipertahankan bila tidak dikirim', () => {
  expect(save({ title: 'Biasa' }).data.overflow).toBe(false);
  const made = save({ title: 'Meluber', overflow: true });
  expect(made.data.overflow).toBe(true);
  expect(call('qrview@gmail.com', 'qrcodes.get', { id: made.data.id }).data.overflow).toBe(true);
  const listed = call('qrview@gmail.com', 'qrcodes.list', null).data;
  expect(listed.find((d: { id: string }) => d.id === made.data.id).overflow).toBe(true);
  clock += 60_000;
  const changed = save({
    id: made.data.id,
    expectedUpdatedAt: made.data.updatedAt,
    title: 'Meluber 2',
  });
  expect(changed.data.overflow).toBe(true); // tidak dikirim = dipertahankan
  expect(save({ title: 'x', overflow: 'ya' }).error.code).toBe('VALIDATION');
});

test('hanya flag overflow yang berubah: tersimpan diam-diam tanpa menaikkan updatedAt atau mencatat audit', () => {
  const made = save({ overflow: true });
  clock += 60_000;
  const out = save({
    id: made.data.id,
    documentId: made.data.documentId,
    expectedUpdatedAt: made.data.updatedAt,
    overflow: false,
  });
  expect(out.ok).toBe(true);
  expect(out.data.overflow).toBe(false);
  expect(out.data.updatedAt).toBe(made.data.updatedAt);
  expect(audits()).toEqual(['qrcode.create']);
});

test('ekspor ditolak server bila konfigurasi ditandai tidak muat; tidak ada berkas dibuat di Drive', () => {
  const made = save({ overflow: true });
  const before = platform.drive.size; // PDF sumber fixture sudah ada
  const out = call('qrmanage@gmail.com', 'qrcodes.export', {
    id: made.data.id,
    expectedUpdatedAt: made.data.updatedAt,
    pdfBase64: PDF,
    pngBase64: PNG,
  });
  expect(out.error.code).toBe('VALIDATION');
  expect(out.error.message).toContain('melebihi kanvas');
  expect(platform.drive.size).toBe(before);
});

// ---- pencabutan berbagi PDF sumber yang tidak dipakai

test('menghapus konfigurasi yang terakhir memakai PDF mencabut berbagi PDF itu', () => {
  const doc = upload().data;
  const design = usePdf(doc.id).data;
  expect(platform.sharedFiles.has(driveIdOf(doc.id))).toBe(true);
  expect(call('qrmanage@gmail.com', 'qrcodes.delete', { id: design.id }).ok).toBe(true);
  expect(platform.sharedFiles.has(driveIdOf(doc.id))).toBe(false);
  expect(docs().find((d) => d.id === doc.id)?.shared).toBe(false);
  expect(platform.drive.has(driveIdOf(doc.id))).toBe(true); // berkasnya tetap ada, hanya tidak publik lagi
});

test('mengganti PDF sumber ke dokumen lain mencabut berbagi PDF yang tidak lagi dipakai', () => {
  const doc = upload().data;
  const other = upload('lain.pdf').data;
  const design = usePdf(doc.id).data;
  const switched = usePdf(other.id, { id: design.id, expectedUpdatedAt: design.updatedAt });
  expect(switched.ok).toBe(true);
  expect(platform.sharedFiles.has(driveIdOf(doc.id))).toBe(false);
  expect(platform.sharedFiles.has(driveIdOf(other.id))).toBe(true);
});

test('link harus dari Drive: simpan dengan link manual baru ditolak; konfigurasi lama berlink manual tetap dapat disimpan ulang tanpa mengubah link', () => {
  const rejected = save({ linkSource: 'url', link: 'https://contoh.com/a', documentId: '' });
  expect(rejected.error.code).toBe('VALIDATION');
  expect(rejected.error.fields.link).toContain('Drive');
  // konfigurasi lama (sebelum aturan ini) disisipkan langsung ke repo
  const now = '2026-10-16T00:00:00.000Z';
  insertQrDesign_({
    id: 'legacy',
    title: 'Lama',
    subtitle: '',
    footer: '',
    linkSource: 'url',
    link: 'https://contoh.com/lama',
    documentId: '',
    logoFileId: '',
    layout: DEFAULT_QR_LAYOUT,
    style: DEFAULT_QR_STYLE,
    overflow: false,
    exportedHash: '',
    exportPdfDriveId: '',
    exportPngDriveId: '',
    exportedAt: '',
    exportedBy: '',
    createdAt: now,
    createdBy: 'seed@gmail.com',
    updatedAt: now,
    updatedBy: 'seed@gmail.com',
  });
  const legacy = { linkSource: 'url', link: 'https://contoh.com/lama', documentId: '' };
  const same = save({ id: 'legacy', title: 'Lama diubah', expectedUpdatedAt: now, ...legacy });
  expect(same.ok).toBe(true);
  const changed = save({
    id: 'legacy',
    expectedUpdatedAt: same.data.updatedAt,
    ...legacy,
    link: 'https://contoh.com/baru',
  });
  expect(changed.error.code).toBe('VALIDATION');
});

test('memakai kembali PDF yang sudah dicabut membagikannya lagi', () => {
  const doc = upload().data;
  const design = usePdf(doc.id).data;
  call('qrmanage@gmail.com', 'qrcodes.delete', { id: design.id });
  expect(platform.sharedFiles.has(driveIdOf(doc.id))).toBe(false);
  expect(usePdf(doc.id, { title: 'Pakai lagi' }).ok).toBe(true);
  expect(platform.sharedFiles.has(driveIdOf(doc.id))).toBe(true);
  expect(docs().find((d) => d.id === doc.id)?.shared).toBe(true);
});

test('unggahan yatim (tidak pernah dipakai) dicabut setelah masa tenggang 1 jam; yang baru dan yang dipakai tetap', () => {
  const orphan = upload('yatim.pdf').data;
  const used = upload('dipakai.pdf').data;
  usePdf(used.id);
  clock += 30 * 60_000;
  const fresh = upload('baru.pdf').data; // memicu pembersihan; yatim baru berumur 30 menit
  expect(platform.sharedFiles.has(driveIdOf(orphan.id))).toBe(true);
  clock += 45 * 60_000; // yatim kini 75 menit, "baru" 45 menit
  upload('pemicu.pdf');
  expect(platform.sharedFiles.has(driveIdOf(orphan.id))).toBe(false);
  expect(platform.sharedFiles.has(driveIdOf(fresh.id))).toBe(true);
  expect(platform.sharedFiles.has(driveIdOf(used.id))).toBe(true);
});

test('gagal mencabut berbagi di Drive tidak menggagalkan hapus; galat dicatat', () => {
  const doc = upload().data;
  const design = usePdf(doc.id).data;
  platform.driveRevokeSharing = () => {
    throw new Error('Drive menolak');
  };
  expect(call('qrmanage@gmail.com', 'qrcodes.delete', { id: design.id }).ok).toBe(true);
  expect(platform.errors.some((m) => m.includes('Drive menolak'))).toBe(true);
});

// ---- temuan review PR #15

test('simpan basi yang membagikan ulang PDF dan ditolak CONFLICT: berbagi dicabut lagi', () => {
  const doc = upload().data.id;
  const made = usePdf(doc);
  const stale = made.data.updatedAt;
  // konfigurasi dialihkan ke link manual: PDF lepas dan berbaginya dicabut
  clock += 1000;
  expect(save({ id: made.data.id, expectedUpdatedAt: stale }).ok).toBe(true);
  expect(docs().find((d) => d.id === doc)?.shared).toBe(false);
  // form lama (masih memegang PDF) disimpan: CONFLICT, PDF tidak boleh tetap publik
  const result = usePdf(doc, { id: made.data.id, expectedUpdatedAt: stale });
  expect(result.error.code).toBe('CONFLICT');
  expect(docs().find((d) => d.id === doc)?.shared).toBe(false);
  expect(platform.sharedFiles.has(driveIdOf(doc))).toBe(false);
});

test('pencabutan berbagi yang gagal (bukan "tidak ada") tidak ditandai privat dan dicoba lagi', () => {
  const doc = upload().data.id;
  const made = usePdf(doc);
  const driveId = driveIdOf(doc);
  const failing = {
    ...platform,
    driveRevokeSharing: () => {
      throw new Error('Quota exceeded');
    },
  };
  setPlatform_(failing);
  expect(save({ id: made.data.id, expectedUpdatedAt: made.data.updatedAt }).ok).toBe(true);
  expect(docs().find((d) => d.id === doc)?.shared).toBe(true); // tetap terbagi: akan dicoba lagi
  expect(platform.sharedFiles.has(driveId)).toBe(true);
  setPlatform_(platform);
  clock += 2 * 60 * 60 * 1000; // lewat masa tenggang unggahan yatim
  expect(upload('lain.pdf').ok).toBe(true); // pembersihan oportunistik berikutnya
  expect(docs().find((d) => d.id === doc)?.shared).toBe(false);
});

test('cleanupQrDocuments_ (trigger terjadwal) mencabut unggahan yatim setelah masa tenggang, tidak sebelumnya', () => {
  const doc = upload().data.id;
  expect(cleanupQrDocuments_()).toBe(0); // masih dalam masa tenggang
  expect(docs().find((d) => d.id === doc)?.shared).toBe(true);
  clock += 61 * 60 * 1000;
  expect(cleanupQrDocuments_()).toBe(1);
  expect(docs().find((d) => d.id === doc)?.shared).toBe(false);
  expect(platform.sharedFiles.has(driveIdOf(doc))).toBe(false);
  expect(cleanupQrDocuments_()).toBe(0); // idempoten
});

test('cleanupQrDocuments_ tidak mencabut PDF yang dipakai konfigurasi', () => {
  const doc = upload().data.id;
  usePdf(doc);
  clock += 5 * 60 * 60 * 1000;
  expect(cleanupQrDocuments_()).toBe(0);
  expect(docs().find((d) => d.id === doc)?.shared).toBe(true);
});

// ---- nama berkas PDF dan ganti-isi-saja setelah diekspor

test('menyimpan dengan PDF sumber mengganti nama berkas Drive menjadi {title}-{subtitle}-{timestamp}.pdf', () => {
  const doc = upload('FM BAK.09 form.pdf').data.id;
  const made = usePdf(doc, { title: 'Panduan Instalasi', subtitle: 'U7-Pro' });
  expect(made.ok).toBe(true);
  const expected = 'Panduan Instalasi-U7-Pro-20261016-100000.pdf'; // 03:00 UTC = 10:00 WIB
  expect(platform.drive.get(driveIdOf(doc))?.name).toBe(expected);
  expect(docs().find((d) => d.id === doc)?.name).toBe(expected);
  // subtitle kosong dihilangkan
  const doc2 = upload('lain.pdf').data.id;
  usePdf(doc2, { title: 'Tanpa Sub' });
  expect(platform.drive.get(driveIdOf(doc2))?.name).toBe('Tanpa Sub-20261016-100000.pdf');
});

test('setelah diekspor, PDF hanya boleh diganti isinya: memilih dokumen lain ditolak', () => {
  const doc = upload().data.id;
  const made = usePdf(doc);
  const exported = call('qrmanage@gmail.com', 'qrcodes.export', {
    id: made.data.id,
    expectedUpdatedAt: made.data.updatedAt,
    pdfBase64: PDF,
    pngBase64: PNG,
  });
  expect(exported.ok).toBe(true);
  const other = upload('baru.pdf').data.id;
  const result = usePdf(other, {
    id: made.data.id,
    expectedUpdatedAt: exported.data.updatedAt,
  });
  expect(result.error.code).toBe('VALIDATION');
  expect(result.error.fields.documentId).toContain('diekspor');
  // dokumen yang sama tetap boleh disimpan
  expect(usePdf(doc, { id: made.data.id, expectedUpdatedAt: exported.data.updatedAt }).ok).toBe(
    true,
  );
});

test('langkah pasca-simpan yang gagal (ubah nama berkas) tidak menggagalkan RPC setelah konfigurasi tersimpan', () => {
  const doc = upload().data.id;
  const failing = {
    ...platform,
    driveRenameFile: () => {
      throw new Error('Drive sementara gagal');
    },
  };
  setPlatform_(failing);
  const made = usePdf(doc, { title: 'Tetap Tersimpan' });
  expect(made.ok).toBe(true);
  setPlatform_(platform);
  expect(call('qrview@gmail.com', 'qrcodes.get', { id: made.data.id }).data.title).toBe(
    'Tetap Tersimpan',
  );
});
