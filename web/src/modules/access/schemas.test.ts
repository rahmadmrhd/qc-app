import type { UserDto } from '@shared/contract';
import { expect, test } from 'vitest';
import { toUserFormDefaults, userFormSchema } from './schemas';

const user: UserDto = {
  id: '1',
  email: 'a@gmail.com',
  name: 'A',
  status: 'active',
  assignments: [
    { locationId: null, roleIds: ['ada', 'basi'] },
    { locationId: 'l-a', roleIds: ['basi'] },
    { locationId: 'l-b', roleIds: ['ada'] },
  ],
  createdAt: '',
  updatedAt: '',
  updatedBy: '',
};

test('toUserFormDefaults membuang role basi dan penugasan yang menjadi kosong; Semua lokasi menjadi tanda bintang', () => {
  expect(toUserFormDefaults(user, ['ada', 'lain']).assignments).toEqual([
    { locationId: '*', roleIds: ['ada'] },
    { locationId: 'l-b', roleIds: ['ada'] },
  ]);
});

test('tanpa daftar role yang diketahui, penugasan disalin apa adanya', () => {
  expect(toUserFormDefaults(user).assignments).toEqual([
    { locationId: '*', roleIds: ['ada', 'basi'] },
    { locationId: 'l-a', roleIds: ['basi'] },
    { locationId: 'l-b', roleIds: ['ada'] },
  ]);
});

const base = { email: 'a@gmail.com', name: 'A', status: 'active' as const };

test('skema mengubah tanda bintang menjadi null dan menerima penugasan sah', () => {
  expect(
    userFormSchema.parse({
      ...base,
      assignments: [
        { locationId: '*', roleIds: ['r1'] },
        { locationId: 'l-a', roleIds: ['r2'] },
      ],
    }).assignments,
  ).toEqual([
    { locationId: null, roleIds: ['r1'] },
    { locationId: 'l-a', roleIds: ['r2'] },
  ]);
});

test('skema menolak lokasi kosong, lokasi ganda, dan penugasan tanpa role dengan pesan bernomor', () => {
  const messages = (assignments: unknown[]) => {
    const result = userFormSchema.safeParse({ ...base, assignments });
    return result.success ? [] : result.error.issues.map((issue) => issue.message);
  };
  expect(messages([{ locationId: '', roleIds: ['r'] }])).toEqual(['Penugasan 1: pilih lokasi']);
  expect(
    messages([
      { locationId: 'l-a', roleIds: ['r'] },
      { locationId: 'l-a', roleIds: ['r'] },
    ]),
  ).toEqual(['Penugasan 2: lokasi sudah dipakai di penugasan lain']);
  expect(messages([{ locationId: '*', roleIds: [] }])).toEqual([
    'Penugasan 1: pilih minimal satu role atau hapus penugasannya',
  ]);
  expect(
    messages([
      { locationId: '*', roleIds: ['r'] },
      { locationId: '*', roleIds: ['r'] },
    ]),
  ).toEqual(['Penugasan 2: lokasi sudah dipakai di penugasan lain']);
});
