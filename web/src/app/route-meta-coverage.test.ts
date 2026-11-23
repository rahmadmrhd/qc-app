import { expect, test } from 'vitest';
import { flattenNavItems, NAV_GROUPS } from '@/app/navigation';
import type { PageWidth } from '@/app/route-meta';
import { routeTree } from '@/routeTree.gen';

interface RouteNode {
  options: {
    id: string;
    staticData?: { crumb?: unknown; pageWidth?: PageWidth; locationAware?: boolean };
  };
  children?: unknown;
}

/** Rute daun di bawah layout `/_app` (layout itu sendiri tidak dihitung). `children` berupa array atau objek. */
function appLeaves(): RouteNode[] {
  const leaves: RouteNode[] = [];
  const visit = (node: RouteNode, underApp: boolean) => {
    const kids = node.children;
    const list: RouteNode[] = Array.isArray(kids)
      ? (kids as RouteNode[])
      : kids && typeof kids === 'object'
        ? (Object.values(kids) as RouteNode[])
        : [];
    if (list.length === 0) {
      if (underApp) leaves.push(node);
      return;
    }
    for (const child of list) visit(child, underApp || node.options.id === '/_app');
  };
  visit(routeTree as unknown as RouteNode, false);
  return leaves;
}

/** Path tanpa garis miring akhir (rute index punya id berakhiran `/`). */
const norm = (path: string) => (path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path);

/** Path rute (tanpa awalan layout `/_app`), tanpa garis miring akhir. */
const pathOf = (leaf: RouteNode) => norm(leaf.options.id.replace(/^\/_app/, ''));

/** Rute yang wajib punya `crumb`: form baru/ubah dan rute detail `$param`. */
const needsCrumb = (path: string) => {
  const last = path.split('/').filter(Boolean).at(-1) ?? '';
  return last === 'new' || last === 'edit' || last.startsWith('$');
};

/**
 * Rute daun dikelompokkan menurut JENIS halaman. `pageWidth` hanya batas lebar konten View dan form yang dipusatkan
 * (`PageContent`): halaman index (daftar, grid, kanban) selalu selebar `<main>` dan TIDAK menyatakan `pageWidth`.
 */
/** Halaman index: `ListPage` (+ `KanbanBoard` di /handover; `/dashboard` = kisi widget), selalu selebar `<main>`. */
const INDEX = [
  '/access/audit',
  '/access/business-units',
  '/access/locations',
  '/access/push',
  '/access/roles',
  '/access/users',
  '/customer',
  '/dashboard',
  '/handover',
  '/item',
  '/item/brands',
  '/postel',
  '/qrcode',
  '/qrcode/default',
  '/serial',
  '/serial/reports',
  '/sticker',
  '/sticker/library',
  '/sticker/types',
];
/** Halaman View (`ViewPage`): konten terpusat selebar bawaan, panel samping di tepi kanan. */
const VIEW = [
  '/access/business-units/$businessUnitId',
  '/access/locations/$locationId',
  '/access/roles/$roleId',
  '/access/users/$userId',
  '/customer/$customerId',
  '/handover/$handoverId',
  '/item/$itemId',
  '/item/brands/$brandId',
  '/postel/$postelId',
  '/qrcode/$designId',
  '/qrcode/default/$presetId',
  '/serial/$serialId',
  '/serial/reports/$caseId',
  '/sticker/$stickerId',
  '/sticker/types/$typeId',
];
/** Form sempit (`FormPage`): konten terpusat `narrow`. */
const FORM_NARROW = [
  '/handover/new',
  '/handover/$handoverId/edit',
  '/item/new',
  '/item/$itemId/edit',
  '/postel/new',
  '/postel/$postelId/edit',
  '/sticker/settings',
  '/serial/settings',
  '/serial/report',
  '/sticker/entry',
  '/sticker/opname',
];
/** Form lebar bawaan (form QR dan preset QR). */
const FORM_DEFAULT = [
  '/qrcode/new',
  '/qrcode/$designId/edit',
  '/qrcode/default/new',
  '/qrcode/default/$presetId/edit',
];
/** Form dengan tabel draft: konten selebar `<main>` (`full`). */
const FORM_FULL = ['/serial/new'];
/** Halaman lain (Beranda, informasi, pesan status, alihan): konten terpusat selebar bawaan. */
const OTHER = ['/', '/desktop', '/forbidden', '/sticker/stock'];

const navTargets = new Set(flattenNavItems(NAV_GROUPS).map((item) => norm(item.to as string)));

test('setiap rute daun di /_app tercantum di tepat satu himpunan jenis halaman', () => {
  const paths = appLeaves().map((leaf) => pathOf(leaf));
  expect(new Set(paths).size).toBe(paths.length);
  const listed = [...INDEX, ...VIEW, ...FORM_NARROW, ...FORM_DEFAULT, ...FORM_FULL, ...OTHER];
  expect(new Set(listed).size).toBe(listed.length);
  expect([...paths].sort()).toEqual([...listed].sort());
});

test('pageWidth: hanya form yang menyatakannya (narrow/full); index, View, dan lainnya memakai bawaan', () => {
  for (const leaf of appLeaves()) {
    const path = pathOf(leaf);
    const width = leaf.options.staticData?.pageWidth;
    if (FORM_NARROW.includes(path)) expect(width, path).toBe('narrow');
    else if (FORM_FULL.includes(path)) expect(width, path).toBe('full');
    else expect(width, path).toBeUndefined();
  }
});

test('halaman index tidak menyatakan pageWidth (selalu selebar <main>)', () => {
  const leaves = new Map(appLeaves().map((leaf) => [pathOf(leaf), leaf]));
  for (const path of INDEX) {
    expect(leaves.get(path)?.options.staticData?.pageWidth, path).toBeUndefined();
  }
});

test('form new/edit dan rute detail $param punya crumb', () => {
  for (const leaf of appLeaves()) {
    const path = pathOf(leaf);
    if (needsCrumb(path)) expect(leaf.options.staticData?.crumb, path).toBeDefined();
  }
});

test('rute daun yang bukan tujuan butir nav punya crumb; tujuan nav tidak', () => {
  for (const leaf of appLeaves()) {
    const path = pathOf(leaf);
    const crumb = leaf.options.staticData?.crumb;
    if (navTargets.has(path)) expect(crumb, path).toBeUndefined();
    else expect(crumb, path).toBeDefined();
  }
});

/** Halaman bergantung lokasi aktif (baris lokasi di header ponsel, butir 42c); rute baru wajib memutuskan. */
const LOCATION_AWARE = [
  '/handover',
  '/handover/$handoverId',
  '/handover/$handoverId/edit',
  '/handover/new',
  '/serial/new',
  '/sticker',
  '/sticker/$stickerId',
  '/sticker/entry',
  '/sticker/opname',
];

test('locationAware sesuai himpunan (hanya halaman yang membaca lokasi aktif)', () => {
  for (const leaf of appLeaves()) {
    const path = pathOf(leaf);
    const flag = leaf.options.staticData?.locationAware;
    if (LOCATION_AWARE.includes(path)) expect(flag, path).toBe(true);
    else expect(flag, path).toBeUndefined();
  }
});
