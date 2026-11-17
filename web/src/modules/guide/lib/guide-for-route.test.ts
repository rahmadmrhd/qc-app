import { describe, expect, test } from 'vitest';
import { guideForRoute, hasPendingGuide } from './guide-for-route';
import type { GuideOffer } from './offer';
import type { GuideEntry } from './types';

function offer(id: string, halaman?: string): GuideOffer {
  const entry: GuideEntry = {
    id,
    kind: 'dasar',
    status: 'disimpan',
    version: 1,
    title: id,
    halaman,
    steps: [],
  };
  return { entry, stepCount: 1, updated: false };
}

describe('guideForRoute', () => {
  const handover = offer('handover-dasar', '/handover');

  test('awalan cocok dengan rute itu sendiri dan anak rutenya', () => {
    expect(guideForRoute([handover], '/handover')).toBe(handover);
    expect(guideForRoute([handover], '/handover/new')).toBe(handover);
    expect(guideForRoute([handover], '/handover/abc/edit')).toBe(handover);
  });

  test('tidak cocok dengan rute yang hanya berawalan huruf sama', () => {
    expect(guideForRoute([handover], '/handovers-lain')).toBeNull();
    expect(guideForRoute([handover], '/item')).toBeNull();
  });

  test('bila beberapa cocok, hanya yang pertama menurut urutan katalog', () => {
    const umum = offer('item-dasar', '/item');
    const khusus = offer('merk-dasar', '/item/brands');
    expect(guideForRoute([umum, khusus], '/item/brands')).toBe(umum);
    expect(guideForRoute([khusus, umum], '/item/brands')).toBe(khusus);
  });

  test('halamanKecuali melewati rute di bawah awalan itu, dan rute lain tetap cocok', () => {
    const catat: GuideOffer = {
      ...offer('serial-dasar', '/serial'),
      entry: {
        ...offer('serial-dasar', '/serial').entry,
        halaman: '/serial',
        halamanKecuali: ['/serial/reports', '/serial/report'],
      },
    };
    const laporan = offer('serial-detail', '/serial/reports');
    expect(guideForRoute([catat, laporan], '/serial')).toBe(catat);
    expect(guideForRoute([catat, laporan], '/serial/new')).toBe(catat);
    expect(guideForRoute([catat, laporan], '/serial/reports')).toBe(laporan);
    expect(guideForRoute([catat], '/serial/reports')).toBeNull();
    expect(guideForRoute([catat], '/serial/report')).toBeNull();
    // Awalan kecuali hanya cocok sampai batas segmen (`/serial/reportsx` bukan `/serial/reports`).
    expect(guideForRoute([catat], '/serial/reportsx')).toBe(catat);
  });

  test('panduan tanpa halaman (mis. dasar-layout) tidak pernah cocok', () => {
    const layout = offer('dasar-layout');
    expect(guideForRoute([layout], '/')).toBeNull();
    expect(guideForRoute([layout], '/handover')).toBeNull();
  });

  test('halaman "/" hanya cocok persis, bukan semua rute', () => {
    const beranda = offer('beranda', '/');
    expect(guideForRoute([beranda], '/')).toBe(beranda);
    expect(guideForRoute([beranda], '/item')).toBeNull();
  });

  test('tanpa penawaran: null', () => {
    expect(guideForRoute([], '/handover')).toBeNull();
  });
});

describe('hasPendingGuide', () => {
  test('true untuk item sidebar yang tujuannya sama dengan halaman panduan', () => {
    const offers = [offer('handover-dasar', '/handover')];
    expect(hasPendingGuide(offers, '/handover')).toBe(true);
  });

  test('false untuk item lain, termasuk anak rute dan rute berawalan serupa', () => {
    const offers = [offer('item-dasar', '/item')];
    expect(hasPendingGuide(offers, '/item/brands')).toBe(false);
    expect(hasPendingGuide(offers, '/items')).toBe(false);
    expect(hasPendingGuide(offers, '/customer')).toBe(false);
  });

  test('panduan tanpa halaman tidak menandai item mana pun', () => {
    expect(hasPendingGuide([offer('dasar-layout')], '/')).toBe(false);
  });

  test('tanpa penawaran: false', () => {
    expect(hasPendingGuide([], '/handover')).toBe(false);
  });
});
