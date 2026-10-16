import type { NewLocationRecord, NewRoleRecord, NewUserRecord } from '@gas/modules/access/repo';

const SEED_TIME = '2026-01-01T00:00:00.000Z';

export function role(
  overrides: Partial<NewRoleRecord> & Pick<NewRoleRecord, 'id' | 'name'>,
): NewRoleRecord {
  return {
    description: '',
    permissions: {},
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
    updatedBy: 'seed',
    ...overrides,
  };
}

type UserFixture = Partial<NewUserRecord> &
  Pick<NewUserRecord, 'id' | 'email'> & {
    /** Pintasan: penugasan "Semua lokasi" dengan role ini. `assignments` eksplisit menang. */
    roleIds?: string[];
  };

export function user(overrides: UserFixture): NewUserRecord {
  const { roleIds, ...rest } = overrides;
  return {
    name: rest.email,
    status: 'active',
    assignments: roleIds && roleIds.length > 0 ? [{ locationId: null, roleIds }] : [],
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
    updatedBy: 'seed',
    ...rest,
  };
}

export function location(
  overrides: Partial<NewLocationRecord> & Pick<NewLocationRecord, 'id' | 'code'>,
): NewLocationRecord {
  return {
    name: overrides.code,
    status: 'active',
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
    updatedBy: 'seed',
    ...overrides,
  };
}
