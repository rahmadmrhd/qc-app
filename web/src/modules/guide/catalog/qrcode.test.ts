import type { MeDto } from '@shared/contract';
import { GUIDE_IDS, GUIDE_VERSIONS } from '@shared/guides';
import { describe, expect, test } from 'vitest';
import { guideForRoute } from '../lib/guide-for-route';
import { offeredGuides } from '../lib/offer';
import { GUIDE_CATALOG } from './index';
import { QRCODE_BUAT, QRCODE_DASAR, QRCODE_GUIDES } from './qrcode';

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

const reader = me({ qrcode: 'view' });
const writer = me({ qrcode: 'edit' });

function offers(user: MeDto) {
  return offeredGuides({
    me: user,
    catalog: GUIDE_CATALOG,
    done: new Map(),
    derived: new Map(),
    activeLocationIds: [],
  });
}

const qrIds = (user: MeDto) =>
  offers(user)
    .map((o) => o.entry.id)
    .filter((id) => id.startsWith('qrcode-'));

describe('panduan QR Code Manual Book', () => {
  test('dua panduan (daftar dan formulir): id terdaftar di GUIDE_IDS dengan versi yang sama, ada di katalog', () => {
    expect(QRCODE_GUIDES.map((entry) => entry.id)).toEqual(['qrcode-dasar', 'qrcode-buat']);
    expect(GUIDE_IDS as readonly string[]).not.toContain('qrcode-label');
    for (const entry of QRCODE_GUIDES) {
      expect(GUIDE_IDS as readonly string[]).toContain(entry.id);
      expect((GUIDE_VERSIONS as Record<string, number>)[entry.id]).toBe(entry.version);
      expect(GUIDE_CATALOG).toContain(entry);
    }
    // Daftar pendek; formulir tetap SATU panduan (satu halaman, satu tugas), dipersingkat lewat penggabungan langkah.
    expect(QRCODE_DASAR.steps.length).toBeLessThanOrEqual(3);
    expect(QRCODE_BUAT.steps.length).toBeLessThanOrEqual(7);
  });

  test('pembaca hanya ditawari daftar (2 langkah); penulis ditawari daftar dan formulir', () => {
    expect(qrIds(reader)).toEqual(['qrcode-dasar']);
    expect(offers(reader).find((o) => o.entry.id === 'qrcode-dasar')?.stepCount).toBe(2);
    expect(qrIds(writer)).toEqual(['qrcode-dasar', 'qrcode-buat']);
  });

  test('banner: daftar di /qrcode, formulir di /qrcode/new, tanpa tumpang tindih', () => {
    const all = offers(writer);
    const idAt = (list: typeof all, path: string) => guideForRoute(list, path)?.entry.id;
    expect(idAt(all, '/qrcode')).toBe('qrcode-dasar');
    expect(idAt(all, '/qrcode/new')).toBe('qrcode-buat');
    // Panduan formulir selesai: /qrcode/new tidak jatuh ke banner daftar.
    expect(
      idAt(
        all.filter((o) => o.entry.id === 'qrcode-dasar'),
        '/qrcode/new',
      ),
    ).toBeUndefined();
  });

  test('formulir: dua langkah wait (item lalu konfigurasi default), lalu sampai tombol simpan', () => {
    expect(QRCODE_BUAT.steps.map((step) => [step.target, step.advance, step.waitFor])).toEqual([
      ['qr-items', 'wait', 'qr-preset'],
      ['qr-preset', 'wait', 'qr-name'],
      ['qr-name', 'next', undefined],
      ['qr-source', 'next', undefined],
      ['qr-label', 'next', undefined],
      ['qr-preview', 'next', undefined],
      ['qr-save', 'next', undefined],
    ]);
    expect(QRCODE_BUAT.steps[0]?.route).toBe('/qrcode/new');
    // Logo, bingkai, dan ukuran dijelaskan dalam langkah label (bukan langkah sendiri).
    const label = QRCODE_BUAT.steps.find((step) => step.target === 'qr-label')?.text ?? '';
    expect(label).toMatch(/logo/i);
    expect(label).toMatch(/bingkai/i);
    expect(label).toMatch(/ukuran/i);
  });

  test('daftar mengecualikan formulir baru, View, dan rute di bawahnya dari bannernya', () => {
    expect(QRCODE_DASAR.halaman).toBe('/qrcode');
    expect(QRCODE_DASAR.halamanKecuali).toEqual(['/qrcode/$id']);
    const dasar = offers(reader).filter((o) => o.entry.id === 'qrcode-dasar');
    const idAt = (path: string) => guideForRoute(dasar, path)?.entry.id;
    expect(idAt('/qrcode')).toBe('qrcode-dasar');
    for (const path of [
      '/qrcode/new',
      '/qrcode/q1',
      '/qrcode/q1/edit',
      '/qrcode/default',
      '/qrcode/default/p1',
    ]) {
      expect(idAt(path)).toBeUndefined();
    }
  });

  test('langkah di tab lain membuka tabnya lewat buka: { tab }; target di luar tab tidak memintanya', () => {
    const tabOf = (target: string) => {
      const step = QRCODE_BUAT.steps.find((entry) => entry.target === target);
      return typeof step?.buka === 'object' ? step.buka.tab : undefined;
    };
    expect(tabOf('qr-source')).toBe('sumber');
    expect(tabOf('qr-label')).toBe('label');
    // Item, konfigurasi default, nama (tab Item), pratinjau, dan tombol simpan (bar halaman) tak bergantung tab.
    for (const target of ['qr-items', 'qr-preset', 'qr-name', 'qr-preview', 'qr-save']) {
      expect(tabOf(target)).toBeUndefined();
    }
  });

  test('daftar punya target qr-header, qr-new, dan qr-table', () => {
    expect(QRCODE_DASAR.steps.map((step) => step.target)).toEqual([
      'qr-header',
      'qr-table',
      'qr-new',
    ]);
  });
});
