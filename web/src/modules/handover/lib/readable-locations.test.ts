import type { MeDto } from '@shared/rpc';
import { expect, test } from 'vitest';
import { readableLocationIds } from './readable-locations';

const loc = (id: string, perms: Record<string, string>) => ({
  id,
  code: id,
  name: id,
  permissions: { handover: 'none', qc: 'none', stock: 'none', ...perms },
});
const me = {
  email: 'a@gmail.com',
  name: 'A',
  isSuperAdmin: false,
  permissions: { access: 'none', item: 'none', handover: 'none', qc: 'none', stock: 'none' },
  locations: [
    loc('a', { handover: 'view' }),
    loc('b', { stock: 'view' }), // hanya stok: tidak boleh membaca task
    loc('c', { qc: 'edit' }),
    loc('d', { handover: 'manage' }),
  ],
} as unknown as MeDto;

test('hanya lokasi terpilih yang boleh dibaca (handover view ke atas atau qc edit); lokasi stok-saja dibuang', () => {
  expect(readableLocationIds(me, ['a', 'b', 'c', 'd'])).toEqual(['a', 'c', 'd']);
  expect(readableLocationIds(me, ['b'])).toEqual([]);
  expect(readableLocationIds(me, ['a', 'zzz'])).toEqual(['a']);
  expect(readableLocationIds(me, [])).toEqual([]);
});
