import { handleRpc_ } from '@gas/core/router';
import { signSessionToken_ } from '@gas/core/session';
import { insertLocation_, insertRole_, insertUser_ } from '@gas/modules/access/repo';
import { insertBrand_ } from '@gas/modules/brand/repo';
import { insertItem_ } from '@gas/modules/item/repo';
import { getRoutes_ } from '@gas/routes';
import type { RpcResult } from '@shared/rpc';
import { location, role, user } from './access-fixtures';
import { brand, item } from './item-fixtures';

export const ENV = {
  locA: 'loc-a',
  locB: 'loc-b',
  /** Lokasi nonaktif. */
  locOff: 'loc-off',
  itemA: item({ id: 'item-a', brand: 'Ubiquiti', model: 'ES 24' }).id,
  itemB: item({ id: 'item-b', brand: 'Mikrotik', model: 'hAP ac2' }).id,
  itemOff: item({ id: 'item-off', brand: 'Ubiquiti', model: 'Lama' }).id,
};

/**
 * Memasang lokasi, peran, user, merk, dan item untuk tes serah terima. Panggil SETELAH `setPlatform_`.
 *  - wh@: handover manage di loc-a        - whedit@: handover edit di loc-a
 *  - qc@: qc edit di loc-a dan loc-b      - viewer@: handover view di loc-a
 *  - noaccess@: hanya item view di loc-a  - multi@: handover manage di loc-a dan loc-b
 */
export function seedHandoverEnv(): void {
  insertLocation_(location({ id: ENV.locA, code: 'A', name: 'Lokasi A' }));
  insertLocation_(location({ id: ENV.locB, code: 'B', name: 'Lokasi B' }));
  insertLocation_(location({ id: ENV.locOff, code: 'X', name: 'Lokasi Off', status: 'inactive' }));
  insertRole_(role({ id: 'role-wh', name: 'WH', permissions: { handover: 'manage' } }));
  insertRole_(role({ id: 'role-wh-edit', name: 'WH edit', permissions: { handover: 'edit' } }));
  insertRole_(role({ id: 'role-qc', name: 'QC', permissions: { qc: 'edit' } }));
  insertRole_(role({ id: 'role-view', name: 'Viewer', permissions: { handover: 'view' } }));
  insertRole_(role({ id: 'role-item', name: 'Item', permissions: { item: 'view' } }));
  const assign = (id: string, email: string, rows: Array<[string, string]>) =>
    insertUser_(
      user({
        id,
        email,
        assignments: rows.map(([locationId, roleId]) => ({ locationId, roleIds: [roleId] })),
      }),
    );
  assign('u-wh', 'wh@gmail.com', [[ENV.locA, 'role-wh']]);
  assign('u-whedit', 'whedit@gmail.com', [[ENV.locA, 'role-wh-edit']]);
  assign('u-qc', 'qc@gmail.com', [
    [ENV.locA, 'role-qc'],
    [ENV.locB, 'role-qc'],
  ]);
  assign('u-viewer', 'viewer@gmail.com', [[ENV.locA, 'role-view']]);
  assign('u-noaccess', 'noaccess@gmail.com', [[ENV.locA, 'role-item']]);
  assign('u-multi', 'multi@gmail.com', [
    [ENV.locA, 'role-wh'],
    [ENV.locB, 'role-wh'],
  ]);
  insertBrand_(brand('Ubiquiti'));
  insertBrand_(brand('Mikrotik'));
  insertItem_(item({ id: ENV.itemA, brand: 'Ubiquiti', model: 'ES 24' }));
  insertItem_(item({ id: ENV.itemB, brand: 'Mikrotik', model: 'hAP ac2', aliases: ['hap'] }));
  insertItem_(item({ id: ENV.itemOff, brand: 'Ubiquiti', model: 'Lama', status: 'inactive' }));
}

/** Memanggil RPC sebagai user (token sesi sah) lewat router sungguhan. */
export function rpc(email: string, method: string, payload: unknown): RpcResult<unknown> {
  return handleRpc_(method, JSON.stringify(payload), signSessionToken_(email), getRoutes_());
}
