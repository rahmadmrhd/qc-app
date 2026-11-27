import type { Env } from '@server/core/env';
import { seedRole, seedUser } from './access-fixtures';
import { seedSerialWorld } from './serial-fixtures';

/** Pengguna Keluar Gudang (di atas dunia uji Serial Number: BU `bu-a`/`bu-b`, item `i-a1`/`i-a2`/`i-b`). */
export const WH_USERS = {
  /** `serialwh: edit` di BU A saja. */
  edit: 'gudang@gmail.com',
  /** `serialwh: edit` di BU B saja. */
  editB: 'gudang-b@gmail.com',
  /** `serialwh: view` di BU A saja. */
  view: 'gudang-lihat@gmail.com',
  /** `serialwh: edit` di BU A dan B. */
  both: 'gudang-dua@gmail.com',
  /** Hanya `serial: edit` di BU A (tanpa `serialwh`). */
  serialOnly: 'pencatat@gmail.com',
} as const;

/** Dunia uji Serial Number + peran dan pengguna `serialwh`; stok stiker `s1`/`s2` di `loc-sby` = 10. */
export async function seedWarehouseWorld(env: Env): Promise<void> {
  await seedSerialWorld(env);
  await seedRole(env, { id: 'r-wh-edit', name: 'Gudang edit', permissions: { serialwh: 'edit' } });
  await seedRole(env, { id: 'r-wh-view', name: 'Gudang view', permissions: { serialwh: 'view' } });
  await seedUser(env, {
    id: 'u-wh',
    email: WH_USERS.edit,
    buAssignments: [{ buId: 'bu-a', roleIds: ['r-wh-edit'] }],
  });
  await seedUser(env, {
    id: 'u-wh-b',
    email: WH_USERS.editB,
    buAssignments: [{ buId: 'bu-b', roleIds: ['r-wh-edit'] }],
  });
  await seedUser(env, {
    id: 'u-wh-v',
    email: WH_USERS.view,
    buAssignments: [{ buId: 'bu-a', roleIds: ['r-wh-view'] }],
  });
  await seedUser(env, {
    id: 'u-wh-both',
    email: WH_USERS.both,
    buAssignments: [
      { buId: 'bu-a', roleIds: ['r-wh-edit'] },
      { buId: 'bu-b', roleIds: ['r-wh-edit'] },
    ],
  });
  await env.DB.prepare(
    "INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES ('s1', 'loc-sby', 10, ''), ('s2', 'loc-sby', 10, '')",
  ).run();
}

export interface DispatchOptions {
  /** Catat ready (tanpa SO): `orderNumber`/`customerName`/`handoverIds` diabaikan. */
  ready?: boolean;
  orderNumber?: string;
  buId?: string;
  customerName?: string;
  itemId?: string;
  dispatchedOn?: string;
  note?: string;
  handoverIds?: string[];
  /** Mode ready: nomor kardus pertama (bawaan: nomor unik per panggilan) dan pcs per kardus (bawaan 10). */
  boxStart?: number;
  boxSize?: number;
  /** Serial yang sudah ada (id + nomor). */
  existing?: { id: string; serial: string }[];
  /** Nomor serial baru yang dibuat (lokasi `loc-sby`). */
  fresh?: string[];
}

let readyBoxCursor = 1;

/** Satu pengeluaran sekali kirim (satu potongan) lewat kabel REST; mengembalikan hasil `serialWarehouse.submit`. */
export async function submitDispatch(env: Env, email: string, options: DispatchOptions) {
  const rows = [
    ...(options.existing ?? []).map((row) => ({
      kind: 'existing' as const,
      serialId: row.id,
      serial: row.serial,
    })),
    ...(options.fresh ?? []).map((serial) => ({
      kind: 'new' as const,
      clientId: crypto.randomUUID(),
      serial,
      locationId: 'loc-sby',
      testDate: '2026-11-12',
    })),
  ];
  const boxStart = options.boxStart ?? readyBoxCursor;
  if (options.ready && options.boxStart === undefined) readyBoxCursor += 100;
  const { restCall } = await import('./rest-call');
  return (await restCall(env, email, 'serialWarehouse.submit', {
    clientId: crypto.randomUUID(),
    chunkIndex: 0,
    header: {
      ...(options.ready ? { mode: 'ready', boxStart, boxSize: options.boxSize ?? 10 } : {}),
      dispatchedOn: options.dispatchedOn ?? '2026-11-12',
      orderNumber: options.ready ? '' : (options.orderNumber ?? 'SO-1'),
      buId: options.buId ?? 'bu-a',
      customerName: options.ready ? '' : (options.customerName ?? 'PT Maju'),
      itemId: options.itemId ?? 'i-a1',
      note: options.note ?? '',
      handoverIds: options.ready ? [] : (options.handoverIds ?? []),
      total: rows.length,
      chunkSize: 200,
    },
    rows,
  })) as { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } };
}
