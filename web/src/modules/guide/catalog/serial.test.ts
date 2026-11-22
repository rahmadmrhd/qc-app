import type { MeDto } from '@shared/contract';
import { GUIDE_IDS, GUIDE_VERSIONS } from '@shared/guides';
import { describe, expect, test } from 'vitest';
import { guideForRoute } from '../lib/guide-for-route';
import { offeredGuides } from '../lib/offer';
import { GUIDE_CATALOG } from './index';
import {
  SERIAL_CATAT,
  SERIAL_DAFTAR,
  SERIAL_DETAIL,
  SERIAL_GUIDES,
  SERIAL_LAPORAN,
  SERIAL_LAPORAN_DAFTAR,
} from './serial';

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

function offers(user: MeDto) {
  return offeredGuides({
    me: user,
    catalog: GUIDE_CATALOG,
    done: new Map(),
    derived: new Map(),
    activeLocationIds: [],
  });
}

const serialIds = (user: MeDto) =>
  offers(user)
    .map((o) => o.entry.id)
    .filter((id) => id.startsWith('serial-'));

describe('panduan Serial Number', () => {
  test('lima panduan: id terdaftar di GUIDE_IDS dengan versi yang sama, ada di katalog', () => {
    expect(SERIAL_GUIDES.map((entry) => entry.id)).toEqual([
      'serial-daftar',
      'serial-detail',
      'serial-catat',
      'serial-laporan-daftar',
      'serial-laporan',
    ]);
    for (const entry of SERIAL_GUIDES) {
      expect(GUIDE_IDS as readonly string[]).toContain(entry.id);
      expect((GUIDE_VERSIONS as Record<string, number>)[entry.id]).toBe(entry.version);
      expect(GUIDE_CATALOG).toContain(entry);
      expect(entry.kind).toBe('dasar');
    }
  });

  test('tiap panduan ringkas (maksimal 7 langkah) dan izinnya sesuai tugasnya', () => {
    for (const entry of SERIAL_GUIDES) expect(entry.steps.length).toBeLessThanOrEqual(7);
    for (const entry of [SERIAL_DAFTAR, SERIAL_DETAIL, SERIAL_LAPORAN_DAFTAR]) {
      expect(entry.izin).toEqual({ module: 'serial', level: 'view' });
    }
    for (const entry of [SERIAL_CATAT, SERIAL_LAPORAN]) {
      expect(entry.izin).toEqual({ module: 'serial', level: 'edit' });
    }
  });

  test('pembaca (serial: view) ditawari daftar, detail, dan daftar Laporan; penulis semuanya', () => {
    expect(serialIds(reader)).toEqual(['serial-daftar', 'serial-detail', 'serial-laporan-daftar']);
    for (const entry of SERIAL_GUIDES) expect(serialIds(writer)).toContain(entry.id);
  });

  test('tim servis tanpa serial tidak ditawari (belum dicakup panduan ini)', () => {
    expect(serialIds(serviceOnly)).toEqual([]);
  });

  test('langkah yang butuh izin edit (Tambah, Lapor Rusak) tersembunyi bagi pembaca', () => {
    const editOnly = (entry: (typeof SERIAL_GUIDES)[number]) =>
      entry.steps.filter((step) => step.izin !== undefined).map((step) => step.target);
    expect(editOnly(SERIAL_DAFTAR)).toEqual(['serial-new']);
    expect(editOnly(SERIAL_LAPORAN_DAFTAR)).toEqual(['case-report']);
    // Pembaca tetap melihat 2 langkah dasar di tiap panduan itu.
    expect(offers(reader).find((o) => o.entry.id === 'serial-daftar')?.stepCount).toBe(2);
    expect(offers(reader).find((o) => o.entry.id === 'serial-laporan-daftar')?.stepCount).toBe(2);
  });

  test('banner: tiap rute Serial punya satu panduan, tanpa tumpang tindih', () => {
    const all = offers(writer);
    const idAt = (list: typeof all, path: string) => guideForRoute(list, path)?.entry.id;
    expect(idAt(all, '/serial')).toBe('serial-daftar');
    expect(idAt(all, '/serial/new')).toBe('serial-catat');
    expect(idAt(all, '/serial/report')).toBe('serial-laporan');
    expect(idAt(all, '/serial/reports')).toBe('serial-laporan-daftar');
    expect(idAt(all, '/serial/settings')).toBeUndefined();
    // Halaman detail (ViewPage bertab) tidak jatuh ke banner daftar maupun banner detail milik daftar.
    expect(idAt(all, '/serial/s1')).toBeUndefined();
    // Detail laporan (View tanpa tab) tidak memunculkan banner daftar Laporan maupun daftar Serial.
    expect(idAt(all, '/serial/reports/c1')).toBeUndefined();
    // Panduan daftar selesai: detail jadi banner berikutnya di /serial.
    const without = (...ids: string[]) => all.filter((o) => !ids.includes(o.entry.id));
    expect(idAt(without('serial-daftar'), '/serial')).toBe('serial-detail');
    expect(idAt(without('serial-catat'), '/serial/new')).toBeUndefined();
    // Sesudah semuanya selesai, halaman Laporan/Pengaturan tidak jatuh ke banner halaman lain.
    const rest = without('serial-daftar', 'serial-detail');
    expect(idAt(rest, '/serial/reports')).toBe('serial-laporan-daftar');
    expect(idAt(without('serial-laporan-daftar'), '/serial/reports')).toBeUndefined();
    expect(idAt(without('serial-laporan'), '/serial/report')).toBeUndefined();
  });

  test('catat: satu panduan dari bawaan sampai Simpan, dengan dua langkah wait (baris draft, centang baris)', () => {
    const steps = SERIAL_CATAT.steps;
    expect(steps.map((step) => [step.target, step.advance, step.waitFor])).toEqual([
      ['serial-defaults', 'next', undefined],
      ['serial-scan', 'wait', 'serial-row'],
      ['serial-draft', 'next', undefined],
      ['serial-row-actions', 'next', undefined],
      ['serial-row-select', 'wait', 'serial-bulk'],
      ['serial-bulk', 'next', undefined],
      ['serial-save', 'next', undefined],
    ]);
    expect(steps[0]?.route).toBe('/serial/new');
    expect(GUIDE_IDS as readonly string[]).not.toContain('serial-massal');
    expect(SERIAL_CATAT.version).toBe(3);
  });

  test('catat: Default wajib dan item wajib foto disebut; langkah aksi baris punya kartu pengganti untuk ponsel', () => {
    const [defaults, scan, draft, rowActions, select, bulk, save] = SERIAL_CATAT.steps;
    expect(defaults?.text).toContain('Isi Default dulu');
    expect(scan?.text).toContain('wajib foto');
    expect(scan?.text).toContain('dua langkah');
    expect(draft?.text).toContain('Butuh n foto lagi');
    // `serial-row-actions` hanya ada pada tabel: di kartu (ponsel) langkahnya jatuh seketika ke kartu pengganti.
    expect(rowActions?.langsung).toBe(true);
    expect(rowActions?.teksJikaKosong).toContain('ketuk kartunya');
    // Target yang ada di tabel dan kartu tidak boleh `langsung`/berkartu pengganti.
    expect(select?.langsung).toBeUndefined();
    expect(select?.waitFor).toBe('serial-bulk');
    for (const text of ['Edit', 'Hapus', 'Batalkan pilihan']) expect(bulk?.text).toContain(text);
    expect(save?.text).toContain('foto bukti kurang');
  });

  test('laporan: pencarian menunggu hasil; langkah khusus hasil dilewati seketika (tanpa kartu pengganti)', () => {
    const steps = SERIAL_LAPORAN.steps;
    expect(steps[0]).toMatchObject({
      target: 'report-serial',
      advance: 'wait',
      waitFor: 'report-result',
    });
    expect(steps.find((step) => step.target === 'report-result')?.langsung).toBeUndefined();
    // Bagian yang hanya ada pada hasil tertentu: dilewati bila tak ada, jangan menampilkan kartu pengganti.
    for (const target of [
      'report-blocked-open',
      'report-new-fields',
      'report-message',
      'report-submit',
    ]) {
      const step = steps.find((candidate) => candidate.target === target);
      expect(step?.langsung, target).toBe(true);
      expect(step?.teksJikaKosong, target).toBeUndefined();
    }
    expect(steps.at(-1)?.target).toBe('report-submit');
  });

  test('detail: klik serial di daftar, lalu langkah detail bergantung data dengan teks pengganti', () => {
    const steps = SERIAL_DETAIL.steps;
    expect(steps[0]).toMatchObject({ target: 'serial-open', advance: 'click', route: '/serial' });
    for (const step of steps) expect(step.teksJikaKosong, step.target).toBeDefined();
    expect(steps.slice(1).map((step) => step.target)).toEqual([
      'serial-stepper',
      'serial-actions',
      'serial-actions',
      'serial-timeline',
    ]);
    for (const step of steps.slice(1)) expect(step.route).toBeUndefined();
  });

  test('detail: langkah menyorot isi tab ViewPage meminta tabnya dibuka (Detail untuk tahap, Riwayat untuk aksi dan linimasa)', () => {
    const tabOf = (target: string) =>
      SERIAL_DETAIL.steps
        .filter((step) => step.target === target)
        .map((step) => (typeof step.buka === 'object' ? step.buka.tab : undefined));
    expect(tabOf('serial-stepper')).toEqual(['detail']);
    expect(tabOf('serial-actions')).toEqual(['riwayat', 'riwayat']);
    expect(tabOf('serial-timeline')).toEqual(['riwayat']);
  });
});
