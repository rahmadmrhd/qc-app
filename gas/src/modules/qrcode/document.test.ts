import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { listAuditRecords_ } from '@gas/modules/access/repo';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { qrRpc, seedQrEnv } from '@gas-test/qrcode-env';
import { DEFAULT_QR_LAYOUT } from '@shared/qrcode';
import { listQrDocuments_ } from './repo';

let platform: MemoryPlatform;
beforeEach(() => {
  platform = createMemoryPlatform({
    properties: { ADMIN_EMAIL: 'admin@gmail.com', SESSION_SECRET: 's' },
  });
  setPlatform_(platform);
  seedQrEnv();
});
// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Result = { ok: boolean; data?: any; error?: any };
const call = (email: string, method: string, payload: unknown) =>
  qrRpc(email, method, payload) as Result;
const PDF1 = 'JVBERi0xLjQK';
const PDF2 = 'JVBERi0xLjUK';
const upload = (payload: Record<string, unknown>, email = 'qredit@gmail.com') =>
  call(email, 'qrcodes.uploadPdf', { name: 'manual.pdf', base64: PDF1, ...payload });

test('unggah: berkas di folder dokumen, dibagikan via link, URL berbagi dikembalikan, audit qrcode.pdf_upload', () => {
  const out = upload({});
  expect(out.ok).toBe(true);
  const doc = listQrDocuments_()[0];
  if (!doc) throw new Error('dokumen kosong');
  expect(out.data).toMatchObject({
    name: 'manual.pdf',
    link: `https://drive.google.com/file/d/${doc.driveId}/view`,
    uses: 0,
  });
  expect(platform.sharedFiles.has(doc.driveId)).toBe(true);
  expect(platform.drive.get(doc.driveId)).toMatchObject({ mime: 'application/pdf', base64: PDF1 });
  expect(platform.drive.get(doc.driveId)?.folderId).toBe(
    platform.getProperty('QR_DOC_FOLDER_ID') ?? undefined,
  );
  expect(listAuditRecords_().map((r) => r.action)).toEqual(['qrcode.pdf_upload']);
});

test('izin: hanya edit ke atas; view dan tanpa modul ditolak', () => {
  expect(upload({}, 'qrview@gmail.com').error.code).toBe('FORBIDDEN');
  expect(upload({}, 'noqr@gmail.com').error.code).toBe('FORBIDDEN');
  expect(upload({}, 'qrmanage@gmail.com').ok).toBe(true);
});

test('bukan PDF atau terlalu besar ditolak sebelum menyentuh Drive', () => {
  expect(upload({ base64: 'QUJDRA==' }).error.code).toBe('VALIDATION');
  expect(platform.drive.size).toBe(0);
});

test('ganti: id dokumen, id berkas Drive, dan URL tetap sama; isi dan nama berubah', () => {
  const first = upload({});
  const driveId = listQrDocuments_()[0]?.driveId ?? '';
  const second = upload({ name: 'baru.pdf', base64: PDF2, replaceDocumentId: first.data.id });
  expect(second.ok).toBe(true);
  expect(second.data).toMatchObject({ id: first.data.id, link: first.data.link, name: 'baru.pdf' });
  expect(listQrDocuments_()).toHaveLength(1);
  expect(listQrDocuments_()[0]?.driveId).toBe(driveId);
  expect(platform.drive.get(driveId)?.base64).toBe(PDF2);
  expect(platform.drive.size).toBe(1);
});

test('ganti dokumen yang tidak dikenal → NOT_FOUND; uses menghitung konfigurasi pemakai', () => {
  expect(upload({ replaceDocumentId: 'tidak-ada' }).error.code).toBe('NOT_FOUND');
  const doc = upload({});
  const body = {
    title: 'T',
    linkSource: 'pdf',
    link: '',
    documentId: doc.data.id,
    subtitle: '',
    footer: '',
    logoFileId: '',
    layout: DEFAULT_QR_LAYOUT,
  };
  call('qredit@gmail.com', 'qrcodes.save', body);
  call('qredit@gmail.com', 'qrcodes.save', { ...body, title: 'T2' });
  expect(upload({ replaceDocumentId: doc.data.id }).data.uses).toBe(2);
});

test('gagal membagikan: berkas yang baru dibuat dibuang dan tidak ada catatan dokumen', () => {
  platform.driveShareAnyoneWithLink = () => {
    throw new Error('gagal bagikan');
  };
  expect(upload({}).ok).toBe(false);
  expect(listQrDocuments_()).toHaveLength(0);
  expect(platform.drive.size).toBe(0);
});

test('gagal mengganti isi: ditolak dengan pesan jelas, dokumen lama tidak berubah', () => {
  const first = upload({});
  const driveId = listQrDocuments_()[0]?.driveId ?? '';
  platform.driveReplaceFileContent = () => {
    throw new Error('Drive API 403');
  };
  const out = upload({ base64: PDF2, replaceDocumentId: first.data.id });
  expect(out.ok).toBe(false);
  expect(platform.drive.get(driveId)?.base64).toBe(PDF1);
  expect(listQrDocuments_()[0]?.name).toBe('manual.pdf');
});
