import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { listAuditRecords_ } from '@gas/modules/access/repo';
import { listFiles_ } from '@gas/modules/files/repo';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { qrRpc, seedQrEnv } from '@gas-test/qrcode-env';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import { insertQrDocument_, listQrDesigns_, updateQrDesign_ } from './repo';

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
const input = {
  title: 'Panduan',
  linkSource: 'url',
  link: 'https://contoh.com/a',
  documentId: '',
  subtitle: 'Sub',
  footer: 'foot',
  logoFileId: '',
  layout: DEFAULT_QR_LAYOUT,
};
const save = (payload: Record<string, unknown> = {}, email = 'qredit@gmail.com') =>
  call(email, 'qrcodes.save', { ...input, ...payload });
const audits = () => listAuditRecords_().map((r) => r.action);

test('izin: view membaca, edit menyimpan, manage menghapus; tanpa modul qrcode FORBIDDEN', () => {
  expect(call('qrview@gmail.com', 'qrcodes.list', null).ok).toBe(true);
  expect(call('qrview@gmail.com', 'qrcodes.save', input).error.code).toBe('FORBIDDEN');
  expect(call('noqr@gmail.com', 'qrcodes.list', null).error.code).toBe('FORBIDDEN');
  const made = save();
  expect(made.ok).toBe(true);
  expect(call('qredit@gmail.com', 'qrcodes.delete', { id: made.data.id }).error.code).toBe(
    'FORBIDDEN',
  );
  expect(call('qrmanage@gmail.com', 'qrcodes.delete', { id: made.data.id }).ok).toBe(true);
});

test('buat: status Belum diekspor, audit qrcode.create, pembuat tercatat', () => {
  const out = save();
  expect(out.data).toMatchObject({
    title: 'Panduan',
    linkSource: 'url',
    link: 'https://contoh.com/a',
    exportStatus: 'none',
    createdBy: 'qredit@gmail.com',
    layout: DEFAULT_QR_LAYOUT,
  });
  expect(audits()).toEqual(['qrcode.create']);
  expect(call('qrview@gmail.com', 'qrcodes.get', { id: out.data.id }).data.title).toBe('Panduan');
  expect(call('qrview@gmail.com', 'qrcodes.get', { id: 'tidak-ada' }).error.code).toBe('NOT_FOUND');
});

test('ubah: audit qrcode.update dengan before/after; tanpa perubahan tidak mencatat apa pun dan updatedAt tetap', () => {
  const made = save();
  clock += 60_000;
  const same = save({ id: made.data.id });
  expect(same.data.updatedAt).toBe(made.data.updatedAt);
  expect(audits()).toEqual(['qrcode.create']);
  const changed = save({ id: made.data.id, title: 'Baru' });
  expect(changed.data.title).toBe('Baru');
  expect(changed.data.updatedAt).not.toBe(made.data.updatedAt);
  expect(audits()).toEqual(['qrcode.create', 'qrcode.update']);
  expect(listAuditRecords_().at(-1)).toMatchObject({
    before: { title: 'Panduan' },
    after: { title: 'Baru' },
  });
});

test('konkurensi optimistis: expectedUpdatedAt basi → CONFLICT dan data tidak berubah', () => {
  const made = save();
  const stale = save({
    id: made.data.id,
    title: 'Timpa',
    expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
  });
  expect(stale.error.code).toBe('CONFLICT');
  expect(listQrDesigns_()[0]?.title).toBe('Panduan');
  expect(
    save({ id: made.data.id, title: 'Cocok', expectedUpdatedAt: made.data.updatedAt }).ok,
  ).toBe(true);
});

test('sumber pdf: dokumen harus dikenal; link efektif = URL berbagi; documentUses dihitung', () => {
  expect(
    save({ linkSource: 'pdf', link: '', documentId: 'tidak-ada' }).error.fields.documentId,
  ).toBeDefined();
  insertQrDocument_({
    id: 'd1',
    driveId: 'file-77',
    name: 'manual.pdf',
    size: 10,
    createdAt: 't',
    createdBy: 'a',
    updatedAt: 't',
    updatedBy: 'a',
  });
  const a = save({ linkSource: 'pdf', link: '', documentId: 'd1' });
  expect(a.data).toMatchObject({
    link: 'https://drive.google.com/file/d/file-77/view',
    documentName: 'manual.pdf',
    documentUses: 1,
  });
  save({ title: 'Kedua', linkSource: 'pdf', link: '', documentId: 'd1' });
  expect(call('qredit@gmail.com', 'qrcodes.get', { id: a.data.id }).data.documentUses).toBe(2);
});

test('logo: berkas yang tak dikenal ditolak; logo yang sama boleh dirujuk banyak konfigurasi', () => {
  expect(save({ logoFileId: 'tidak-ada' }).error.code).toBe('VALIDATION');
  const upload = call('qredit@gmail.com', 'files.upload', {
    mime: 'image/png',
    base64: 'iVBORw0KGgoAAAANSUhEUg==',
    width: 1,
    height: 1,
  });
  expect(upload.ok).toBe(true);
  const logo = upload.data.id as string;
  expect(save({ title: 'A', logoFileId: logo }).ok).toBe(true);
  expect(save({ title: 'B', logoFileId: logo }).ok).toBe(true);
  expect(listFiles_().find((f) => f.id === logo)).toMatchObject({
    ownerType: 'qrlogo',
    ownerId: 'shared',
  });
});

test('pengguna qrcode tanpa izin item dapat mengunggah dan membaca logo', () => {
  const up = call('qredit@gmail.com', 'files.upload', {
    mime: 'image/png',
    base64: 'iVBORw0KGgoAAAANSUhEUg==',
    width: 1,
    height: 1,
  });
  expect(up.ok).toBe(true);
  expect(call('qrview@gmail.com', 'files.get', { id: up.data.id }).ok).toBe(true);
  expect(call('noqr@gmail.com', 'files.get', { id: up.data.id }).ok).toBe(true); // item view
});

test('hapus: baris hilang, audit qrcode.delete, berkas ekspor masuk sampah, logo dan dokumen tidak dibuang', () => {
  insertQrDocument_({
    id: 'd1',
    driveId: 'file-77',
    name: 'm.pdf',
    size: 1,
    createdAt: 't',
    createdBy: 'a',
    updatedAt: 't',
    updatedBy: 'a',
  });
  const folder = platform.driveCreateFolder('x');
  const pdfId = platform.driveCreateFile(folder, 'a.pdf', 'application/pdf', 'QUJD');
  const doc = platform.driveCreateFile(folder, 'm.pdf', 'application/pdf', 'QUJD');
  const made = save({ linkSource: 'pdf', link: '', documentId: 'd1' });
  const record = listQrDesigns_()[0];
  if (!record) throw new Error('kosong');
  updateQrDesign_({ ...record, exportPdfDriveId: pdfId }); // simulasikan ekspor lama
  expect(call('qrmanage@gmail.com', 'qrcodes.delete', { id: made.data.id }).ok).toBe(true);
  expect(listQrDesigns_()).toHaveLength(0);
  expect(platform.drive.has(pdfId)).toBe(false);
  expect(platform.drive.has(doc)).toBe(true);
  expect(audits().at(-1)).toBe('qrcode.delete');
  expect(call('qrmanage@gmail.com', 'qrcodes.delete', { id: made.data.id }).error.code).toBe(
    'NOT_FOUND',
  );
});

test('daftar: terbaru dahulu', () => {
  save({ title: 'Pertama' });
  clock += 60_000;
  save({ title: 'Kedua' });
  expect(
    call('qrview@gmail.com', 'qrcodes.list', null).data.map((d: { title: string }) => d.title),
  ).toEqual(['Kedua', 'Pertama']);
});

const framedStyle = {
  title: { bold: false, italic: true, underline: false, strike: false, uppercase: true },
  subtitle: { bold: false, italic: false, underline: true, strike: false, uppercase: false },
  footer: { bold: false, italic: false, underline: false, strike: true, uppercase: false },
  frame: { kind: 'corners', thickness: 0.6, gap: 1.2, radius: 2, arm: 30 },
};

test('gaya teks dan bingkai: tersimpan dan dikembalikan; tanpa style = bawaan', () => {
  const plain = save();
  expect(plain.data.style).toEqual(DEFAULT_QR_STYLE);
  const styled = save({ title: 'Bergaya', style: framedStyle });
  expect(styled.ok).toBe(true);
  expect(styled.data.style).toEqual(framedStyle);
  expect(call('qrview@gmail.com', 'qrcodes.get', { id: styled.data.id }).data.style).toEqual(
    framedStyle,
  );
});

test('gaya tak sah ditolak per field style', () => {
  expect(
    save({ style: { ...framedStyle, frame: { ...framedStyle.frame, kind: 'bulat' } } }).error.fields
      .style,
  ).toBeDefined();
  expect(
    save({ style: { ...framedStyle, frame: { ...framedStyle.frame, thickness: 99 } } }).error.code,
  ).toBe('VALIDATION');
  expect(save({ style: null }).error.code).toBe('VALIDATION');
});

test('mengubah gaya saja = perubahan: updatedAt naik, audit qrcode.update memuat gaya sebelum dan sesudah', () => {
  const made = save();
  clock += 60_000;
  const changed = save({ id: made.data.id, style: framedStyle });
  expect(changed.data.updatedAt).not.toBe(made.data.updatedAt);
  expect(audits()).toEqual(['qrcode.create', 'qrcode.update']);
  const entry = listAuditRecords_().at(-1);
  expect(entry?.before).toMatchObject({ frame: 'none' });
  expect(entry?.after).toMatchObject({ frame: 'corners' });
});

test('ubah tanpa menyertakan style mempertahankan gaya yang ada', () => {
  const made = save({ style: framedStyle });
  const { style: _omit, ...withoutStyle } = {
    ...input,
    id: made.data.id,
    title: 'Judul Baru',
  } as Record<string, unknown>;
  const out = call('qredit@gmail.com', 'qrcodes.save', withoutStyle);
  expect(out.ok).toBe(true);
  expect(out.data.style).toEqual(framedStyle);
});
