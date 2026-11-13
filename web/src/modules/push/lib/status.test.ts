import type { PushUserStatusDto } from '@shared/contract';
import { expect, test } from 'vitest';
import { countPushStates, filterPushStatuses, PUSH_STATE_LABELS, sortPushStatuses } from './status';

const rows: PushUserStatusDto[] = [
  { email: 'budi@qc.local', name: 'Budi', state: 'active' },
  { email: 'ani@qc.local', name: 'Ani', state: 'active' },
  { email: 'cici@qc.local', name: 'Cici', state: 'denied' },
  { email: 'dodi@qc.local', name: 'Dodi', state: 'failing' },
  { email: 'eka@qc.local', name: 'Eka', state: 'none' },
  { email: 'fani@qc.local', name: 'Fani', state: 'disabled' },
];

test('urut: masalah dulu (ditolak, gagal, belum berlangganan, dimatikan, aktif), lalu nama', () => {
  expect(sortPushStatuses(rows).map((row) => row.name)).toEqual([
    'Cici',
    'Dodi',
    'Eka',
    'Fani',
    'Ani',
    'Budi',
  ]);
});

test('urut tidak mengubah daftar asli', () => {
  const before = rows.map((row) => row.name);
  sortPushStatuses(rows);
  expect(rows.map((row) => row.name)).toEqual(before);
});

test('cari nama atau email tanpa membedakan huruf besar/kecil; kosong = semua', () => {
  expect(filterPushStatuses(rows, 'CICI').map((row) => row.name)).toEqual(['Cici']);
  expect(filterPushStatuses(rows, 'dodi@').map((row) => row.name)).toEqual(['Dodi']);
  expect(filterPushStatuses(rows, '  ')).toHaveLength(rows.length);
  expect(filterPushStatuses(rows, 'tidak-ada')).toEqual([]);
});

test('ringkasan jumlah per status', () => {
  expect(countPushStates(rows)).toEqual({ denied: 1, failing: 1, none: 1, disabled: 1, active: 2 });
});

test('label berbahasa Indonesia dan tak memuat istilah perangkat atau endpoint', () => {
  const text = Object.values(PUSH_STATE_LABELS).join(' ');
  expect(text).toContain('Izin ditolak');
  expect(text).not.toMatch(/endpoint|perangkat|device/i);
});
