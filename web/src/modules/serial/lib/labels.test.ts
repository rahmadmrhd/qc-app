import { SERIAL_FLOW } from '@shared/serial-flow';
import { SERIAL_ACTIONS, SERIAL_EVENT_TYPES } from '@shared/serials';
import { expect, test } from 'vitest';
import {
  ACTION_LABEL,
  EVENT_LABEL,
  flowRowLabel,
  HISTORY_GROUP_LABEL,
  LEG_LABEL,
  legEventLabel,
  STEP_ORDER,
} from './labels';

test('label lengkap untuk semua aksi dan jenis riwayat', () => {
  expect(Object.keys(ACTION_LABEL).sort()).toEqual([...SERIAL_ACTIONS].sort());
  for (const type of SERIAL_EVENT_TYPES) expect(EVENT_LABEL[type]).toBeTruthy();
  expect(Object.values(HISTORY_GROUP_LABEL)).toEqual(['Semua', 'Pengecekan', 'Perubahan data']);
});

test('label kirim/terima mengikuti leg; baris lain memakai label aksi', () => {
  const labels = SERIAL_FLOW.filter((row) => row.action === 'send' || row.action === 'receive').map(
    flowRowLabel,
  );
  expect(labels).toEqual([
    'Kirim ke servis',
    'Terima di servis',
    'Kirim balik ke QC',
    'Terima di QC',
    'Kirim antar lokasi',
    'Terima antar lokasi',
  ]);
  expect(flowRowLabel({ action: 'declare_broken' })).toBe('Nyatakan rusak');
  expect(Object.keys(LEG_LABEL)).toHaveLength(5);
});

test('judul kartu kirim/terima menurut leg; leg tak dikenal jatuh ke label dasar', () => {
  expect(legEventLabel('send', 'to_service')).toBe('Dikirim ke servis');
  expect(legEventLabel('receive', 'at_qc')).toBe('Diterima di QC');
  expect(legEventLabel('send', undefined)).toBe('Dikirim');
});

test('urutan tahap: tujuh tahap, tahap terakhir Lolos / Rusak', () => {
  expect(STEP_ORDER.map((step) => step.label)).toEqual([
    'Lolos',
    'Tidak lolos',
    'Perbaikan QC',
    'Di servis',
    'Perbaikan servis',
    'Cek ulang',
    'Lolos / Rusak',
  ]);
});
