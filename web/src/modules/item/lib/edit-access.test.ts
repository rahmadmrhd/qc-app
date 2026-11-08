import type { MeDto } from '@shared/contract';
import { isRedirect } from '@tanstack/react-router';
import { expect, test } from 'vitest';
import { assertCanEditItem } from './edit-access';

function me(levels: Record<string, 'view' | 'edit'>): MeDto {
  return {
    email: 'a@x.com',
    name: 'A',
    isSuperAdmin: false,
    permissions: {
      access: 'none',
      item: 'edit',
      qrcode: 'none',
      handover: 'none',
      qc: 'none',
      stock: 'none',
    },
    locations: [],
    businessUnits: Object.entries(levels).map(([id, level]) => ({
      id,
      code: id.toUpperCase(),
      name: id,
      status: 'active' as const,
      permissions: { item: level },
    })),
  };
}

const ref = (id: string) => ({ id, code: id.toUpperCase(), name: id });

test('berhak ubah pada semua BU item: tidak dialihkan', () => {
  expect(() =>
    assertCanEditItem(me({ a: 'edit', b: 'edit' }), {
      id: 'i1',
      businessUnits: [ref('a'), ref('b')],
    }),
  ).not.toThrow();
});

test('edit di BU A tetapi hanya view di BU B: dialihkan ke detail item', () => {
  let thrown: unknown;
  try {
    assertCanEditItem(me({ a: 'edit', b: 'view' }), {
      id: 'i1',
      businessUnits: [ref('a'), ref('b')],
    });
  } catch (error) {
    thrown = error;
  }
  expect(isRedirect(thrown)).toBe(true);
  expect(thrown).toMatchObject({ options: { to: '/item/$itemId', params: { itemId: 'i1' } } });
});
