import { insertRole_, insertUser_ } from '@gas/modules/access/repo';
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
