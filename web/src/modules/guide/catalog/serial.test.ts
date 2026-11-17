import type { MeDto } from '@shared/contract';
import { GUIDE_IDS, GUIDE_VERSIONS } from '@shared/guides';
import { describe, expect, test } from 'vitest';
import { offeredGuides } from '../lib/offer';
import { GUIDE_CATALOG } from './index';
import { SERIAL_DASAR, SERIAL_GUIDES, SERIAL_LAPORAN } from './serial';

/** `permissions` = izin global tergabung (untuk modul ber-BU: level tertinggi di antara penugasan BU akun). */
function me(permissions: Record<string, string>): MeDto {
  return {
    email: 'a@qc.local',
    name: 'A',
    isSuperAdmin: false,
    permissions: permissions as MeDto['permissions'],
    locations: [],
    businessUnits: [],
    canManageSerialSettings: false,
    sharedAccount: false,
  };
}

const reader = me({ serial: 'view' });
const writer = me({ serial: 'edit' });
const serviceOnly = me({ serialservice: 'view' });

function offer(user: MeDto, id: string) {
  return offeredGuides({
    me: user,
    catalog: GUIDE_CATALOG,
    done: new Map(),
    derived: new Map(),
    activeLocationIds: [],
  }).find((candidate) => candidate.entry.id === id);
}

describe('panduan Serial Number', () => {
  test('id terdaftar di GUIDE_IDS dengan versi yang sama, dan ada di katalog', () => {
    for (const entry of SERIAL_GUIDES) {
      expect(GUIDE_IDS as readonly string[]).toContain(entry.id);
      expect((GUIDE_VERSIONS as Record<string, number>)[entry.id]).toBe(entry.version);
      expect(GUIDE_CATALOG).toContain(entry);
      expect(entry.kind).toBe('dasar');
    }
  });

  test('panduan Laporan lebih dulu dari panduan dasar: banner /serial/reports tidak tertutup banner dasar', () => {
    const order = GUIDE_CATALOG.map((entry) => entry.id);
    expect(order.indexOf(SERIAL_LAPORAN.id)).toBeLessThan(order.indexOf(SERIAL_DASAR.id));
    expect(SERIAL_DASAR.halaman).toBe('/serial');
    expect(SERIAL_LAPORAN.halaman).toBe('/serial/reports');
  });

  test('pembaca (serial: view) hanya melihat langkah daftar; penulis melihat seluruh langkah', () => {
    expect(offer(reader, SERIAL_DASAR.id)?.stepCount).toBe(2);
    expect(offer(writer, SERIAL_DASAR.id)?.stepCount).toBe(SERIAL_DASAR.steps.length);
    expect(offer(reader, SERIAL_LAPORAN.id)?.stepCount).toBe(6);
    expect(offer(writer, SERIAL_LAPORAN.id)?.stepCount).toBe(SERIAL_LAPORAN.steps.length);
  });

  test('tim servis tanpa serial tidak ditawari (belum dicakup panduan ini)', () => {
    expect(offer(serviceOnly, SERIAL_DASAR.id)).toBeUndefined();
    expect(offer(serviceOnly, SERIAL_LAPORAN.id)).toBeUndefined();
  });

  test('dasar: berhenti tepat sebelum Simpan, semua langkah berjenis next', () => {
    const targets = SERIAL_DASAR.steps.map((step) => step.target);
    expect(targets.at(-1)).toBe('serial-save');
    expect(targets.indexOf('serial-new')).toBeLessThan(targets.indexOf('serial-defaults'));
    for (const step of SERIAL_DASAR.steps) expect(step.advance).toBe('next');
    // Satu-satunya perpindahan rute: dari daftar ke halaman Catat (setelah tombol Tambah).
    expect(SERIAL_DASAR.steps.filter((step) => step.route).map((step) => step.route)).toEqual([
      '/serial',
      '/serial/new',
    ]);
  });

  test('laporan: langkah pencarian menunggu hasil, dan Lapor rusak adalah langkah terakhir (tidak ditekan)', () => {
    const steps = SERIAL_LAPORAN.steps;
    const search = steps.find((step) => step.target === 'report-serial');
    expect(search?.advance).toBe('wait');
    expect(search?.waitFor).toBe('report-result');
    expect(steps.at(-1)?.target).toBe('report-submit');
    expect(steps.indexOf(search as (typeof steps)[number])).toBeLessThan(steps.length - 1);
  });

  test('laporan: langkah bergantung data (detail serial, hasil pencarian) punya teks pengganti', () => {
    for (const target of [
      'case-open',
      'serial-stepper',
      'serial-actions',
      'serial-timeline',
      'report-new-fields',
      'report-message',
      'report-submit',
    ]) {
      const step = SERIAL_LAPORAN.steps.find((candidate) => candidate.target === target);
      expect(step?.teksJikaKosong, target).toBeDefined();
    }
    // Daftar, filter, dan formulir pencarian selalu dirender: tanpa teks pengganti.
    for (const target of ['case-table', 'case-filters', 'report-serial', 'report-result']) {
      const step = SERIAL_LAPORAN.steps.find((candidate) => candidate.target === target);
      expect(step?.teksJikaKosong, target).toBeUndefined();
    }
  });

  test('klik nomor LP membuka detail: langkah detail tanpa route, kembali ke daftar lewat langkah Lapor Rusak', () => {
    const steps = SERIAL_LAPORAN.steps;
    const open = steps.findIndex((step) => step.target === 'case-open');
    expect(steps[open]?.advance).toBe('click');
    for (const target of ['serial-stepper', 'serial-actions', 'serial-timeline']) {
      const step = steps.find((candidate) => candidate.target === target);
      expect(step?.route, target).toBeUndefined();
      expect(steps.indexOf(step as (typeof steps)[number])).toBeGreaterThan(open);
    }
    const back = steps.find((step) => step.target === 'case-report');
    expect(back?.route).toBe('/serial/reports');
  });
});
