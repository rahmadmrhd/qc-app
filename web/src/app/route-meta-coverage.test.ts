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

/** Lebar khusus; rute lain memakai bawaan (`default`) dan harus tercantum di `DEFAULT_WIDTH`. */
const NARROW_WIDTH = [
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
const FULL_WIDTH = ['/handover', '/serial/new'];
/** Rute yang memakai bawaan `default` secara sengaja (semua View, daftar, QR/Preset, dan halaman lain). */
const DEFAULT_WIDTH = [
  '/',
  '/access/audit',
  '/access/business-units',
  '/access/business-units/$businessUnitId',
  '/access/locations',
  '/access/locations/$locationId',
  '/access/push',
  '/access/roles',
  '/access/roles/$roleId',
  '/access/users',
  '/access/users/$userId',
  '/customer',
  '/customer/$customerId',
  '/desktop',
  '/forbidden',
  '/handover/$handoverId',
  '/item',
  '/item/$itemId',
  '/item/brands',
  '/item/brands/$brandId',
  '/postel',
  '/postel/$postelId',
  '/qrcode',
  '/qrcode/$designId',
  '/qrcode/$designId/edit',
  '/qrcode/default',
  '/qrcode/default/$presetId',
  '/qrcode/default/$presetId/edit',
  '/qrcode/default/new',
  '/qrcode/new',
  '/serial',
  '/serial/$serialId',
  '/serial/reports',
  '/serial/reports/$caseId',
  '/sticker',
  '/sticker/library',
  '/sticker/$stickerId',
  '/sticker/stock',
  '/sticker/types',
  '/sticker/types/$typeId',
];

const navTargets = new Set(flattenNavItems(NAV_GROUPS).map((item) => norm(item.to as string)));

test('setiap rute daun di /_app tercantum di salah satu himpunan lebar', () => {
  const paths = appLeaves().map((leaf) => pathOf(leaf));
  expect(new Set(paths).size).toBe(paths.length);
  expect([...paths].sort()).toEqual([...NARROW_WIDTH, ...FULL_WIDTH, ...DEFAULT_WIDTH].sort());
});

test('pageWidth sesuai himpunan (narrow/full eksplisit, bawaan tanpa pageWidth)', () => {
  for (const leaf of appLeaves()) {
    const path = pathOf(leaf);
    const width = leaf.options.staticData?.pageWidth;
    if (NARROW_WIDTH.includes(path)) expect(width, path).toBe('narrow');
    else if (FULL_WIDTH.includes(path)) expect(width, path).toBe('full');
    else expect(width, path).toBeUndefined();
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
