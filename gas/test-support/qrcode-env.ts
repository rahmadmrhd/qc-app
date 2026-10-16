import { platform_ } from '@gas/core/platform';
import { insertRole_, insertUser_ } from '@gas/modules/access/repo';
import { ensureQrDocFolder_ } from '@gas/modules/qrcode/folders';
import { insertQrDocument_ } from '@gas/modules/qrcode/repo';
import { role, user } from './access-fixtures';
import { rpc } from './handover-env';

/** Panggil SETELAH `setPlatform_`. qrview@/qredit@/qrmanage@ = modul qrcode per level (Semua lokasi); noqr@ = item view saja. */
export function seedQrEnv(): void {
  insertRole_(role({ id: 'r-qv', name: 'QR view', permissions: { qrcode: 'view' } }));
  insertRole_(role({ id: 'r-qe', name: 'QR edit', permissions: { qrcode: 'edit' } }));
  insertRole_(role({ id: 'r-qm', name: 'QR manage', permissions: { qrcode: 'manage' } }));
  insertRole_(role({ id: 'r-item', name: 'Item', permissions: { item: 'view' } }));
  insertUser_(user({ id: 'u-qv', email: 'qrview@gmail.com', roleIds: ['r-qv'] }));
  insertUser_(user({ id: 'u-qe', email: 'qredit@gmail.com', roleIds: ['r-qe'] }));
  insertUser_(user({ id: 'u-qm', email: 'qrmanage@gmail.com', roleIds: ['r-qm'] }));
  insertUser_(user({ id: 'u-nq', email: 'noqr@gmail.com', roleIds: ['r-item'] }));
}

export const qrRpc = rpc;

/**
 * Id dokumen PDF sumber untuk fixture tes BARU di tiap pemanggilan (satu PDF hanya untuk satu konfigurasi QR), dibuat langsung lewat repo tanpa audit: sumber
 * link baru wajib PDF/Drive, jadi fixture memakainya lewat getter `documentId` (dievaluasi saat tes berjalan).
 */
export function qrPdfDocumentId(): string {
  const platform = platform_();
  const driveId = platform.driveCreateFile(
    ensureQrDocFolder_(),
    'sumber.pdf',
    'application/pdf',
    'JVBERi0xLjQK',
  );
  platform.driveShareAnyoneWithLink(driveId);
  const id = platform.uuid();
  const now = '2026-10-16T00:00:00.000Z';
  insertQrDocument_({
    id,
    driveId,
    name: 'sumber.pdf',
    size: 9,
    shared: true,
    createdAt: now,
    createdBy: 'seed@gmail.com',
    updatedAt: now,
    updatedBy: 'seed@gmail.com',
  });
  return id;
}
