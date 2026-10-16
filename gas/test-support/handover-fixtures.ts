import type { NewCustomerRecord } from '@gas/modules/customer/repo';
import type { NewHandoverLineRecord, NewHandoverRecord } from '@gas/modules/handover/repo';
import { customerKey } from '@shared/handover';

const SEED_TIME = '2026-01-01T00:00:00.000Z';

export function customer(
  name: string,
  overrides: Partial<NewCustomerRecord> = {},
): NewCustomerRecord {
  const key = customerKey(name);
  return {
    id: `cust-${key.split(' ').join('-')}`,
    name,
    key,
    status: 'active',
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
    updatedBy: 'seed',
    ...overrides,
  };
}

export function handover(
  overrides: Partial<NewHandoverRecord> & Pick<NewHandoverRecord, 'id' | 'number' | 'locationId'>,
): NewHandoverRecord {
  return {
    customerId: 'cust-pt-maju',
    customerName: 'PT Maju',
    note: '',
    status: 'open',
    createdAt: SEED_TIME,
    createdBy: 'seed',
    updatedAt: SEED_TIME,
    updatedBy: 'seed',
    ...overrides,
  };
}

export function handoverLine(
  overrides: Partial<NewHandoverLineRecord> &
    Pick<NewHandoverLineRecord, 'id' | 'handoverId' | 'itemId'>,
): NewHandoverLineRecord {
  return {
    itemLabel: 'Ubiquiti ES 24',
    qty: 1,
    doneQty: 0,
    doneAt: '',
    doneBy: '',
    ...overrides,
  };
}
