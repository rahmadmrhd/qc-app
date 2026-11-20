import { QueryClient } from '@tanstack/react-query';
import { expect, test } from 'vitest';
import { buildCrumbs, type CrumbSpec, pageWidthOf } from './route-meta';

const queryClient = new QueryClient();
const trail = {
  parent: { label: 'Item' },
  item: { label: 'Daftar Item', to: '/item' },
};

test('buildCrumbs: induk, butir menu, lalu crumb rute berurutan', () => {
  const detail: CrumbSpec = ({ params }) => [
    { label: 'Asus RT-AX55', to: '/item/$itemId', params: { itemId: params.itemId ?? '' } },
    { label: 'Ubah' },
  ];
  const parts = buildCrumbs({
    trail,
    matches: [{ staticData: { crumb: detail }, params: { itemId: '1' } }, { params: {} }],
    queryClient,
  });
  expect(parts).toEqual([
    { label: 'Item' },
    { label: 'Daftar Item', to: '/item' },
    { label: 'Asus RT-AX55', to: '/item/$itemId', params: { itemId: '1' } },
    { label: 'Ubah' },
  ]);
});

test('crumb string menjadi label; fungsi yang mengembalikan undefined dilewati', () => {
  const parts = buildCrumbs({
    trail,
    matches: [
      { staticData: { crumb: 'Tambah' }, params: {} },
      { staticData: { crumb: () => undefined }, params: {} },
    ],
    queryClient,
  });
  expect(parts.map((part) => part.label)).toEqual(['Item', 'Daftar Item', 'Tambah']);
});

test('tanpa trail dan tanpa crumb = kosong; tanpa induk tidak ada label induk', () => {
  expect(buildCrumbs({ trail: null, matches: [{ params: {} }], queryClient })).toEqual([]);
  expect(
    buildCrumbs({
      trail: { parent: null, item: { label: 'Beranda', to: '/' } },
      matches: [],
      queryClient,
    }),
  ).toEqual([]);
});

test('Beranda tanpa crumb rute = tanpa breadcrumb; crumb rute di Beranda tetap tampil', () => {
  const home = { parent: null, item: { label: 'Beranda', to: '/' } };
  expect(buildCrumbs({ trail: home, matches: [], queryClient })).toEqual([]);
  expect(
    buildCrumbs({
      trail: home,
      matches: [{ staticData: { crumb: 'Sesuatu' }, params: {} }],
      queryClient,
    }).map((part) => part.label),
  ).toEqual(['Beranda', 'Sesuatu']);
});

test('butir menu Serah Terima mempertahankan status dan loc dari rute aktif', () => {
  const handover = { parent: null, item: { label: 'Serah Terima', to: '/handover' } };
  const parts = buildCrumbs({
    trail: handover,
    matches: [
      { staticData: { crumb: 'Ubah' }, params: {}, search: { status: 'open', loc: 'L1', x: 1 } },
    ],
    queryClient,
  });
  expect(parts[0]).toEqual({
    label: 'Serah Terima',
    to: '/handover',
    search: { status: 'open', loc: 'L1' },
  });
  expect(buildCrumbs({ trail: handover, matches: [{ params: {} }], queryClient })[0]).toEqual({
    label: 'Serah Terima',
    to: '/handover',
  });
});

test('crumb menerima search rute dan meneruskannya ke tautan', () => {
  const spec: CrumbSpec = ({ search }) => ({
    label: 'Detail',
    to: '/x',
    search: { loc: search.loc },
  });
  const parts = buildCrumbs({
    trail: null,
    matches: [{ staticData: { crumb: spec }, params: {}, search: { loc: 'L1' } }],
    queryClient,
  });
  expect(parts).toEqual([{ label: 'Detail', to: '/x', search: { loc: 'L1' } }]);
});

test('pageWidthOf mengambil match terdalam yang menyatakan lebar; bawaan default', () => {
  expect(pageWidthOf([{ staticData: { pageWidth: 'narrow' } }, { staticData: {} }])).toBe('narrow');
  expect(
    pageWidthOf([{ staticData: { pageWidth: 'narrow' } }, { staticData: { pageWidth: 'full' } }]),
  ).toBe('full');
  expect(pageWidthOf([])).toBe('default');
});
