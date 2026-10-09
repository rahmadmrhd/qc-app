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

export function user(
  overrides: Partial<NewUserRecord> & Pick<NewUserRecord, 'id' | 'email'>,
): NewUserRecord {
  return {
    name: overrides.email,
    status: 'active',
    roleIds: [],
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
    updatedBy: 'seed',
    ...overrides,
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
