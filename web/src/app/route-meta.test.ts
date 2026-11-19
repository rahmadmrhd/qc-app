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
  ).toEqual([{ label: 'Beranda', to: '/' }]);
});

test('pageWidthOf mengambil match terdalam yang menyatakan lebar; bawaan default', () => {
  expect(pageWidthOf([{ staticData: { pageWidth: 'narrow' } }, { staticData: {} }])).toBe('narrow');
  expect(
    pageWidthOf([{ staticData: { pageWidth: 'narrow' } }, { staticData: { pageWidth: 'full' } }]),
  ).toBe('full');
  expect(pageWidthOf([])).toBe('default');
});
