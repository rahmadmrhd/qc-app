import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { listAuditRecords_ } from '@gas/modules/access/repo';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { qrRpc, seedQrEnv } from '@gas-test/qrcode-env';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import { listQrDocuments_ } from './repo';

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
  linkSource: 'url',
  link: 'https://contoh.com/a',
  documentId: '',
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
  const out = save({ id: made.data.id, expectedUpdatedAt: made.data.updatedAt, overflow: false });
  expect(out.ok).toBe(true);
  expect(out.data.overflow).toBe(false);
  expect(out.data.updatedAt).toBe(made.data.updatedAt);
  expect(audits()).toEqual(['qrcode.create']);
});

test('ekspor ditolak server bila konfigurasi ditandai tidak muat; tidak ada berkas dibuat di Drive', () => {
  const made = save({ overflow: true });
  const out = call('qrmanage@gmail.com', 'qrcodes.export', {
    id: made.data.id,
    expectedUpdatedAt: made.data.updatedAt,
    pdfBase64: PDF,
    pngBase64: PNG,
  });
  expect(out.error.code).toBe('VALIDATION');
  expect(out.error.message).toContain('melebihi kanvas');
  expect(platform.drive.size).toBe(0);
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

test('PDF yang masih dipakai konfigurasi lain tetap dibagikan', () => {
  const doc = upload().data;
  const a = usePdf(doc.id, { title: 'A' }).data;
  usePdf(doc.id, { title: 'B' });
  call('qrmanage@gmail.com', 'qrcodes.delete', { id: a.id });
  expect(platform.sharedFiles.has(driveIdOf(doc.id))).toBe(true);
  expect(docs().find((d) => d.id === doc.id)?.shared).toBe(true);
});

test('mengubah sumber link dari PDF ke link manual mencabut berbagi PDF yang tidak lagi dipakai', () => {
  const doc = upload().data;
  const design = usePdf(doc.id).data;
  const switched = save({
    id: design.id,
    expectedUpdatedAt: design.updatedAt,
    linkSource: 'url',
    link: 'https://contoh.com/b',
  });
  expect(switched.ok).toBe(true);
  expect(platform.sharedFiles.has(driveIdOf(doc.id))).toBe(false);
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
