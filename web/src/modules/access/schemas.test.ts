import type { UserDto } from '@shared/contract';
import { expect, test } from 'vitest';
import {
  businessUnitFormSchema,
  toBusinessUnitFormDefaults,
  toUserFormDefaults,
  userFormSchema,
} from './schemas';

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
  buAssignments: [],
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

const base = {
  email: 'a@gmail.com',
  name: 'A',
  status: 'active' as const,
  buAssignments: [],
};

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

test('toUserFormDefaults memetakan buId null menjadi tanda bintang dan membuang role basi', () => {
  const withBu: UserDto = {
    ...user,
    buAssignments: [
      { buId: null, roleIds: ['ada', 'basi'] },
      { buId: 'bu-a', roleIds: ['basi'] },
      { buId: 'bu-b', roleIds: ['ada'] },
    ],
  };
  expect(toUserFormDefaults(withBu, ['ada']).buAssignments).toEqual([
    { buId: '*', roleIds: ['ada'] },
    { buId: 'bu-b', roleIds: ['ada'] },
  ]);
  expect(toUserFormDefaults(withBu).buAssignments).toEqual([
    { buId: '*', roleIds: ['ada', 'basi'] },
    { buId: 'bu-a', roleIds: ['basi'] },
    { buId: 'bu-b', roleIds: ['ada'] },
  ]);
  expect(toUserFormDefaults().buAssignments).toEqual([]);
});

test('skema mengubah tanda bintang BU menjadi null', () => {
  expect(
    userFormSchema.parse({
      ...base,
      assignments: [],
      buAssignments: [
        { buId: '*', roleIds: ['r1'] },
        { buId: 'bu-a', roleIds: ['r2'] },
      ],
    }).buAssignments,
  ).toEqual([
    { buId: null, roleIds: ['r1'] },
    { buId: 'bu-a', roleIds: ['r2'] },
  ]);
});

test('skema menolak BU kosong, BU kembar, dan penugasan BU tanpa role', () => {
  const messages = (buAssignments: unknown[]) => {
    const result = userFormSchema.safeParse({ ...base, assignments: [], buAssignments });
    return result.success ? [] : result.error.issues.map((issue) => issue.message);
  };
  expect(messages([{ buId: '', roleIds: ['r'] }])).toEqual(['Penugasan BU 1: pilih BU']);
  expect(
    messages([
      { buId: 'bu-a', roleIds: ['r'] },
      { buId: 'bu-a', roleIds: ['r'] },
    ]),
  ).toEqual(['Penugasan BU 2: BU sudah dipakai di penugasan lain']);
  expect(
    messages([
      { buId: '*', roleIds: ['r'] },
      { buId: '*', roleIds: ['r'] },
    ]),
  ).toEqual(['Penugasan BU 2: BU sudah dipakai di penugasan lain']);
  expect(messages([{ buId: 'bu-a', roleIds: [] }])).toEqual([
    'Penugasan BU 1: pilih minimal satu role atau hapus penugasannya',
  ]);
});

test('skema user menolak buAssignments yang hilang', () => {
  expect(
    userFormSchema.safeParse({ email: 'a@gmail.com', name: 'A', status: 'active', assignments: [] })
      .success,
  ).toBe(false);
});

test('skema BU: kode huruf besar, maks. 10, hanya huruf/angka/tanda hubung', () => {
  expect(businessUnitFormSchema.parse({ code: ' rtl-01 ', name: ' Retail ' })).toEqual({
    code: 'RTL-01',
    name: 'Retail',
  });
  expect(businessUnitFormSchema.safeParse({ code: 'ABCDEFGHIJK', name: 'X' }).success).toBe(false);
  expect(businessUnitFormSchema.safeParse({ code: 'AB CD', name: 'X' }).success).toBe(false);
  expect(toBusinessUnitFormDefaults()).toEqual({ code: '', name: '' });
  expect(toBusinessUnitFormDefaults({ code: 'RTL', name: 'Retail' })).toEqual({
    code: 'RTL',
    name: 'Retail',
  });
});
