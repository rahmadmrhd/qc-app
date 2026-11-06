import type { Env } from '@server/core/env';
import type { Assignment } from '@shared/assignments';
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
    /** Pintasan: penugasan "Semua lokasi". `assignments` eksplisit menang. */
    roleIds?: string[];
    assignments?: Assignment[];
  },
): Promise<void> {
  const assignments =
    user.assignments ??
    (user.roleIds && user.roleIds.length > 0 ? [{ locationId: null, roleIds: user.roleIds }] : []);
  await env.DB.prepare(
    'INSERT INTO users (id, email, name, status, assignments, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      user.id,
      user.email,
      user.name ?? user.email,
      user.status ?? 'active',
      JSON.stringify(assignments),
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
