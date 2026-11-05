import type { Env } from '@server/core/env';
import { callRoute } from '@server/core/router';
import { signSessionToken } from '@server/core/session';
import type { HandoverRecord, StoredComment } from '@server/modules/handover/repo';
import { insertHandoverStmt } from '@server/modules/handover/repo';
import { getRoutes } from '@server/routes';
import type { RpcResult } from '@shared/rpc';
import { seedLocation, seedRole, seedUser } from './access-fixtures';

export const ENV = {
  locA: 'loc-a',
  locB: 'loc-b',
  /** Lokasi nonaktif. */
  locOff: 'loc-off',
};

/**
 * Memasang lokasi, peran, dan user untuk tes serah terima.
 *  - wh@: handover manage di loc-a        - whedit@: handover edit di loc-a
 *  - qc@: qc edit di loc-a dan loc-b      - viewer@: handover view di loc-a
 *  - noaccess@: hanya item view di loc-a  - multi@: handover manage di loc-a dan loc-b
 */
export async function seedHandoverEnv(env: Pick<Env, 'DB'>): Promise<void> {
  await seedLocation(env, { id: ENV.locA, code: 'A', name: 'Lokasi A' });
  await seedLocation(env, { id: ENV.locB, code: 'B', name: 'Lokasi B' });
  await seedLocation(env, { id: ENV.locOff, code: 'X', name: 'Lokasi Off', status: 'inactive' });
  await seedRole(env, { id: 'role-wh', name: 'WH', permissions: { handover: 'manage' } });
  await seedRole(env, { id: 'role-wh-edit', name: 'WH edit', permissions: { handover: 'edit' } });
  await seedRole(env, { id: 'role-qc', name: 'QC', permissions: { qc: 'edit' } });
  await seedRole(env, { id: 'role-view', name: 'Viewer', permissions: { handover: 'view' } });
  await seedRole(env, { id: 'role-item', name: 'Item', permissions: { item: 'view' } });
  const assign = (id: string, email: string, rows: Array<[string, string]>) =>
    seedUser(env, {
      id,
      email,
      assignments: rows.map(([locationId, roleId]) => ({ locationId, roleIds: [roleId] })),
    });
  await assign('u-wh', 'wh@gmail.com', [[ENV.locA, 'role-wh']]);
  await assign('u-whedit', 'whedit@gmail.com', [[ENV.locA, 'role-wh-edit']]);
  await assign('u-qc', 'qc@gmail.com', [
    [ENV.locA, 'role-qc'],
    [ENV.locB, 'role-qc'],
  ]);
  await assign('u-viewer', 'viewer@gmail.com', [[ENV.locA, 'role-view']]);
  await assign('u-noaccess', 'noaccess@gmail.com', [[ENV.locA, 'role-item']]);
  await assign('u-multi', 'multi@gmail.com', [
    [ENV.locA, 'role-wh'],
    [ENV.locB, 'role-wh'],
  ]);
}

/** Memanggil RPC sebagai user (token sesi sah) lewat router sungguhan. */
export async function rpc(
  env: Env,
  email: string,
  method: string,
  payload: unknown,
): Promise<RpcResult<unknown>> {
  const token = await signSessionToken(env, email, (env.NOW ?? Date.now)());
  return callRoute(env, token, method, payload, getRoutes());
}

const SEED_TIME = '2026-01-01T00:00:00.000Z';

export function handoverRecord(
  overrides: Partial<HandoverRecord> & Pick<HandoverRecord, 'id' | 'number' | 'locationId'>,
): HandoverRecord {
  return {
    customerId: 'cust-pt-maju',
    customerName: 'PT Maju',
    note: '',
    status: 'open',
    checks: [],
    completedAt: '',
    completedBy: '',
    createdAt: SEED_TIME,
    createdBy: 'seed',
    updatedAt: SEED_TIME,
    updatedBy: 'seed',
    version: 1,
    ...overrides,
  };
}

/** Menyisipkan task langsung ke D1 (kolom turunan dihitung seperti penulisan nyata), beserta komentarnya. */
export async function seedHandover(
  env: Pick<Env, 'DB'>,
  overrides: Partial<HandoverRecord> & Pick<HandoverRecord, 'id' | 'number' | 'locationId'>,
  comments: StoredComment[] = [],
): Promise<HandoverRecord> {
  const record = handoverRecord(overrides);
  await insertHandoverStmt(env.DB, record).run();
  // Satu INSERT banyak-baris per 50 komentar (bukan satu round trip per komentar): menyemai puluhan komentar murah.
  for (let from = 0; from < comments.length; from += 50) {
    const chunk = comments.slice(from, from + 50);
    const rows = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    await env.DB.prepare(
      `INSERT INTO handover_comments (id, handover_id, author, created_at, quote, \`before\`, \`after\`, body) VALUES ${rows}`,
    )
      .bind(
        ...chunk.flatMap((comment) => [
          comment.id,
          record.id,
          comment.author,
          comment.at,
          comment.quote,
          comment.before,
          comment.after,
          comment.body,
        ]),
      )
      .run();
  }
  return record;
}
