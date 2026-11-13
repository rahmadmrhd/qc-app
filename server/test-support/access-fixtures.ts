import type { Env } from '@server/core/env';
import type { Assignment } from '@shared/assignments';
import type { BuAssignment } from '@shared/business-units';
import type { PartialPermissionMap } from '@shared/permissions';

const SEED_TIME = '2026-01-01T00:00:00.000Z';

export async function seedRole(
  env: Pick<Env, 'DB'>,
  role: { id: string; name: string; permissions?: PartialPermissionMap },
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO roles (id, name, permissions, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(role.id, role.name, JSON.stringify(role.permissions ?? {}), SEED_TIME, SEED_TIME, 'seed')
    .run();
}

export async function seedUser(
  env: Pick<Env, 'DB'>,
  user: {
    id: string;
    email: string;
    name?: string;
    status?: 'active' | 'inactive';
    /**
     * Pintasan: role yang sama dipakai sebagai penugasan "Semua lokasi" DAN "Semua BU" (agar tes yang memberi role
     * `item` lewat `roleIds` tetap berlaku). `assignments`/`buAssignments` eksplisit menang atas bagiannya masing-masing.
     */
    roleIds?: string[];
    assignments?: Assignment[];
    buAssignments?: BuAssignment[];
    /** Akun bersama (`users.shared_account`); bawaan false. */
    sharedAccount?: boolean;
  },
): Promise<void> {
  const hasRoles = user.roleIds !== undefined && user.roleIds.length > 0;
  const assignments =
    user.assignments ?? (hasRoles ? [{ locationId: null, roleIds: user.roleIds ?? [] }] : []);
  const buAssignments: BuAssignment[] =
    user.buAssignments ?? (hasRoles ? [{ buId: null, roleIds: user.roleIds ?? [] }] : []);
  await env.DB.prepare(
    'INSERT INTO users (id, email, name, status, assignments, bu_assignments, shared_account, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      user.id,
      user.email,
      user.name ?? user.email,
      user.status ?? 'active',
      JSON.stringify(assignments),
      JSON.stringify(buAssignments),
      user.sharedAccount === true ? 1 : 0,
      SEED_TIME,
      SEED_TIME,
      'seed',
    )
    .run();
}

export async function seedLocation(
  env: Pick<Env, 'DB'>,
  location: { id: string; code: string; name?: string; status?: 'active' | 'inactive' },
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO locations (id, code, name, status, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      location.id,
      location.code,
      location.name ?? location.code,
      location.status ?? 'active',
      SEED_TIME,
      SEED_TIME,
      'seed',
    )
    .run();
}

/** BU uji; `name` bawaan = kode. Idempoten tidak dijamin: id/kode ganda melempar galat duplikat. */
export async function seedBusinessUnit(
  env: Pick<Env, 'DB'>,
  bu: { id: string; code: string; name?: string; status?: 'active' | 'inactive' },
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO business_units (id, code, name, status, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(bu.id, bu.code, bu.name ?? bu.code, bu.status ?? 'active', SEED_TIME, SEED_TIME, 'seed')
    .run();
}
