import { afterEach, beforeEach, expect, test } from 'vitest';
import { previousPath, resetTrail } from '@/lib/stack-nav';
import { appRoutePatterns, insertParentChain, parentChainFor } from './parent-chain';

const patterns = appRoutePatterns();

test('rantai induk: butir menu = Beranda saja; detail/ubah/tambah naik per tingkat', () => {
  expect(parentChainFor('/', patterns)).toEqual([]);
  expect(parentChainFor('/item', patterns)).toEqual(['/']);
  expect(parentChainFor('/item/new', patterns)).toEqual(['/', '/item']);
  expect(parentChainFor('/item/abc', patterns)).toEqual(['/', '/item']);
  expect(parentChainFor('/item/abc/edit', patterns)).toEqual(['/', '/item', '/item/abc']);
  expect(parentChainFor('/item/brands/b1', patterns)).toEqual(['/', '/item/brands']);
  expect(parentChainFor('/handover/h1/edit', patterns)).toEqual(['/', '/handover', '/handover/h1']);
  expect(parentChainFor('/serial/report', patterns)).toEqual(['/', '/serial/reports']);
  // Detail laporan Serial: induknya daftar Laporan; detail Serial tetap di bawah daftar Serial.
  expect(parentChainFor('/serial/reports/c1', patterns)).toEqual(['/', '/serial/reports']);
  expect(parentChainFor('/serial/s1', patterns)).toEqual(['/', '/serial']);
  expect(parentChainFor('/sticker/library', patterns)).toEqual(['/']);
});

test('detail ready: induk menaut ke tab Ready Riwayat Gudang', () => {
  expect(parentChainFor('/serial/gudang/riwayat/ready/r1', patterns)).toEqual([
    '/',
    '/serial/gudang/riwayat?tab=ready',
  ]);
  expect(parentChainFor('/serial/gudang/riwayat/o1', patterns)).toEqual([
    '/',
    '/serial/gudang/riwayat',
  ]);
});

let width: number;
beforeEach(() => {
  width = window.innerWidth;
  window.innerWidth = 390;
  resetTrail();
  window.history.replaceState(null, '', '/item/abc/edit?x=1');
});
afterEach(() => {
  window.innerWidth = width;
});

test('tautan dalam di ponsel: entri induk disisipkan, halaman asli tetap di atas, back naik satu tingkat', () => {
  const before = window.history.length;
  expect(insertParentChain(window, patterns)).toBe(true);
  expect(window.history.length).toBe(before + 3);
  expect(window.location.pathname + window.location.search).toBe('/item/abc/edit?x=1');
  const state = window.history.state as { __TSR_index: number };
  expect(state.__TSR_index).toBe(3);
  expect(previousPath()).toBe('/item/abc');
});

test('aman muat ulang: entri berindeks > 0 tidak disisipi lagi', () => {
  insertParentChain(window, patterns);
  const length = window.history.length;
  expect(insertParentChain(window, patterns)).toBe(false);
  expect(window.history.length).toBe(length);
});

test('desktop, Beranda, login, dan halaman publik tidak disisipi', () => {
  window.innerWidth = 1200;
  expect(insertParentChain(window, patterns)).toBe(false);
  window.innerWidth = 390;
  for (const path of ['/', '/login', '/laporan/v1.1.2.sig', '/dashboard-publik/v1.ds1.2.sig']) {
    window.history.replaceState(null, '', path);
    const length = window.history.length;
    expect(insertParentChain(window, patterns)).toBe(false);
    expect(window.history.length).toBe(length);
  }
});

test('belum masuk (tamu) tidak disisipi (review nav M1)', () => {
  const length = window.history.length;
  expect(insertParentChain(window, patterns, false)).toBe(false);
  expect(window.history.length).toBe(length);
});

test('/country-lock dilewati', () => {
  for (const path of ['/country-lock']) {
    window.history.replaceState(null, '', path);
    const length = window.history.length;
    expect(insertParentChain(window, patterns)).toBe(false);
    expect(window.history.length).toBe(length);
  }
});

test('jalur //host tidak disisipi (review nav M2)', () => {
  const fake = {
    history: { state: null, pushState: () => undefined, replaceState: () => undefined },
    location: { pathname: '//evil.test/item/abc', search: '', hash: '' },
  } as unknown as Window;
  expect(insertParentChain(fake, patterns)).toBe(false);
});
