// Dunia uji bersama tes tautan task Serah Terima (jalur B): lokasi dan pengguna Serah Terima + BU `serialwh`.
import type { Env } from '@server/core/env';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { ENV, seedHandover, seedHandoverEnv } from '@server-test/handover-env';
import { seedBrand, seedItem } from '@server-test/item-fixtures';

export const WH_USERS = {
  /** `handover: manage` di loc-a + `serialwh: edit` di BU A. */
  wh: 'gudang@gmail.com',
  /** `qc: edit` di loc-a dan loc-b + `serialwh: edit` di BU A. */
  qc: 'qc-gudang@gmail.com',
  /** `serialwh: edit` di BU A tetapi hanya `item: view` di lokasi (task tak terbaca). */
  blind: 'buta-task@gmail.com',
  /** `serialwh: view` di BU A + `handover: view` di loc-a. */
  viewer: 'pelihat-gudang@gmail.com',
  /** `serialwh: edit` di BU B saja + `handover: manage` di loc-a. */
  otherBu: 'bu-lain@gmail.com',
} as const;

export const SO_TIME = '2026-11-20T01:00:00.000Z';

export async function seedWarehouseWorld(env: Env): Promise<void> {
  await seedHandoverEnv(env);
  await seedBusinessUnit(env, { id: 'bu-a', code: 'A' });
  await seedBusinessUnit(env, { id: 'bu-b', code: 'B' });
  await seedRole(env, { id: 'r-wh-edit', name: 'Gudang edit', permissions: { serialwh: 'edit' } });
  await seedRole(env, { id: 'r-wh-view', name: 'Gudang lihat', permissions: { serialwh: 'view' } });
  const who = (
    id: string,
    email: string,
    locations: Array<[string, string]>,
    bu: Array<[string, string]>,
  ) =>
    seedUser(env, {
      id,
      email,
      assignments: locations.map(([locationId, roleId]) => ({ locationId, roleIds: [roleId] })),
      buAssignments: bu.map(([buId, roleId]) => ({ buId, roleIds: [roleId] })),
    });
  await who('u-g-wh', WH_USERS.wh, [[ENV.locA, 'role-wh']], [['bu-a', 'r-wh-edit']]);
  await who(
    'u-g-qc',
    WH_USERS.qc,
    [
      [ENV.locA, 'role-qc'],
      [ENV.locB, 'role-qc'],
    ],
    [['bu-a', 'r-wh-edit']],
  );
  await who('u-g-blind', WH_USERS.blind, [[ENV.locA, 'role-item']], [['bu-a', 'r-wh-edit']]);
  await who('u-g-view', WH_USERS.viewer, [[ENV.locA, 'role-view']], [['bu-a', 'r-wh-view']]);
  await who('u-g-other', WH_USERS.otherBu, [[ENV.locA, 'role-wh']], [['bu-b', 'r-wh-edit']]);
  await seedBrand(env, 'Tenda');
  await seedItem(env, {
    id: 'i-ax300',
    brand: 'Tenda',
    model: 'AX300',
    businessUnitIds: ['bu-a'],
  });
  await seedItem(env, {
    id: 'i-b-only',
    brand: 'Tenda',
    model: 'BX900',
    businessUnitIds: ['bu-b'],
  });
}

export async function seedOrder(
  env: Env,
  order: { id: string; number?: string; buId?: string; updatedAt?: string },
): Promise<void> {
  const number = order.number ?? `SO-${order.id}`;
  await env.DB.prepare(
    "INSERT INTO warehouse_orders (id, number, `key`, bu_id, customer_id, customer_name, last_dispatched_on, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, 'cust-pt-maju', 'PT Maju', '', ?, 'seed', ?, 'seed')",
  )
    .bind(
      order.id,
      number,
      number.toLowerCase(),
      order.buId ?? 'bu-a',
      SO_TIME,
      order.updatedAt ?? SO_TIME,
    )
    .run();
}

export async function linkOrder(env: Env, orderId: string, handoverId: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO warehouse_order_handovers (order_id, handover_id, created_at, created_by) VALUES (?, ?, ?, 'seed')",
  )
    .bind(orderId, handoverId, SO_TIME)
    .run();
}

export async function seedTask(
  env: Env,
  task: {
    id: string;
    number?: string;
    locationId?: string;
    note?: string;
    createdAt?: string;
    customerId?: string;
    customerName?: string;
    boardStatus?: 'new' | 'in_progress' | 'done' | 'cancelled';
    deleted?: boolean;
  },
): Promise<void> {
  await seedHandover(env, {
    id: task.id,
    number: task.number ?? `ST-${task.id}`,
    locationId: task.locationId ?? ENV.locA,
    note: task.note ?? '',
    ...(task.createdAt ? { createdAt: task.createdAt, updatedAt: task.createdAt } : {}),
    ...(task.customerId ? { customerId: task.customerId } : {}),
    ...(task.customerName ? { customerName: task.customerName } : {}),
  });
  if (task.boardStatus && task.boardStatus !== 'new') {
    await env.DB.prepare('UPDATE handovers SET board_status = ? WHERE id = ?')
      .bind(task.boardStatus, task.id)
      .run();
  }
  if (task.deleted) {
    await env.DB.prepare(
      "UPDATE handovers SET deleted_at = '2026-11-21T00:00:00.000Z', deleted_by = 'seed' WHERE id = ?",
    )
      .bind(task.id)
      .run();
  }
}
