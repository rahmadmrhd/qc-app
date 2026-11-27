import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { API_ROUTES } from './api';
import {
  API_GROUP_VERSIONS,
  announcedApis,
  apiGroup,
  apiVersionsInUse,
  deprecatedGroupsInUse,
  isBelowMinClient,
  MIN_CLIENT,
  matchRetiredRoute,
  parseApiId,
  parseMinClient,
  parseServerApis,
  pickApiId,
  type RetiredRoute,
  restBase,
} from './api-versions';
import { ERROR_CODES } from './contract';
import { compareVersions } from './desktop-release';

describe('restBase', () => {
  test('menyusun awalan jalur per versi', () => {
    expect(restBase(1)).toBe('/api/v1');
    expect(restBase(3)).toBe('/api/v3');
  });
});

describe('parseApiId', () => {
  test('id biasa = versi 1', () => {
    expect(parseApiId('qrcodes.save')).toEqual({ base: 'qrcodes.save', version: 1 });
  });
  test('akhiran @n (n >= 2) = versi n', () => {
    expect(parseApiId('qrcodes.save@2')).toEqual({ base: 'qrcodes.save', version: 2 });
    expect(parseApiId('x@12')).toEqual({ base: 'x', version: 12 });
  });
  test('akhiran tak valid dianggap id biasa', () => {
    for (const id of ['x@1', 'x@02', 'x@a', 'x@', 'x@0']) {
      expect(parseApiId(id)).toEqual({ base: id, version: 1 });
    }
  });
});

describe('apiGroup', () => {
  test('awalan sebelum titik pertama, akhiran versi diabaikan', () => {
    expect(apiGroup('qrcodes.save@2')).toBe('qrcodes');
    expect(apiGroup('access.users.list')).toBe('access');
    expect(apiGroup('auth.me')).toBe('auth');
  });
});

describe('invarian tabel', () => {
  const ids = Object.keys(API_ROUTES);
  test('kelompok di API_ROUTES = kelompok di API_GROUP_VERSIONS', () => {
    const fromRoutes = [...new Set(ids.map(apiGroup))].sort();
    expect(Object.keys(API_GROUP_VERSIONS).sort()).toEqual(fromRoutes);
  });
  test('setiap id ber-@n punya id dasar', () => {
    for (const id of ids) {
      const { base } = parseApiId(id);
      expect(ids).toContain(base);
    }
  });
  test('latest >= versi tertinggi dan deprecated < latest', () => {
    for (const [group, info] of Object.entries(API_GROUP_VERSIONS)) {
      const highest = Math.max(
        1,
        ...ids.filter((id) => apiGroup(id) === group).map((id) => parseApiId(id).version),
      );
      expect(info.latest).toBeGreaterThanOrEqual(highest);
      for (const v of info.deprecated) expect(v).toBeLessThan(info.latest);
    }
  });
});

describe('pickApiId', () => {
  const ids = ['a.b', 'a.b@2', 'a.b@3', 'c.d'];
  const apis = (latest: number, deprecated: number[] = []) => ({ a: { latest, deprecated } });
  test('tanpa peta = v1', () => {
    expect(pickApiId('a.b', ids, null)).toBe('a.b');
  });
  test('mengikuti latest server', () => {
    expect(pickApiId('a.b', ids, apis(1))).toBe('a.b');
    expect(pickApiId('a.b', ids, apis(2))).toBe('a.b@2');
    expect(pickApiId('a.b', ids, apis(3))).toBe('a.b@3');
  });
  test('server lebih baru dari klien: tertinggi yang klien kenal', () => {
    expect(pickApiId('a.b', ids, apis(5))).toBe('a.b@3');
  });
  test('menghindari versi deprecated bila ada alternatif', () => {
    expect(pickApiId('a.b', ids, apis(3, [3]))).toBe('a.b@2');
  });
  test('semua deprecated: tertinggi yang diizinkan, tidak melempar', () => {
    expect(pickApiId('a.b', ids, apis(3, [1, 2, 3]))).toBe('a.b@3');
  });
  test('kelompok tak ada di peta = v1', () => {
    expect(pickApiId('c.d', ids, apis(3))).toBe('c.d');
    expect(pickApiId('a.b', ids, { z: { latest: 3, deprecated: [] } })).toBe('a.b');
  });
  test('id dasar tak ada di daftar melempar', () => {
    expect(() => pickApiId('x.y', ids, null)).toThrow('x.y');
  });
});

describe('parseServerApis', () => {
  test('nilai bukan objek atau kosong = null', () => {
    for (const value of [null, 'x', [], {}, 3, undefined]) {
      expect(parseServerApis(value)).toBeNull();
    }
  });
  test('peta valid kembali apa adanya', () => {
    const value = { a: { latest: 2, deprecated: [1] } };
    expect(parseServerApis(value)).toEqual(value);
  });
  test('entri latest tak valid dibuang, yang lain tetap', () => {
    const parsed = parseServerApis({
      a: { latest: 0, deprecated: [] },
      b: { latest: 1.5, deprecated: [] },
      c: { latest: '2', deprecated: [] },
      d: { latest: 2, deprecated: [] },
    });
    expect(parsed).toEqual({ d: { latest: 2, deprecated: [] } });
  });
  test('deprecated tak valid diganti []', () => {
    expect(parseServerApis({ a: { latest: 2, deprecated: 'x' } })).toEqual({
      a: { latest: 2, deprecated: [] },
    });
    expect(parseServerApis({ a: { latest: 2, deprecated: [1, 'y'] } })).toEqual({
      a: { latest: 2, deprecated: [] },
    });
    expect(parseServerApis({ a: { latest: 2 } })).toEqual({ a: { latest: 2, deprecated: [] } });
  });
  test('semua entri tak valid = null', () => {
    expect(parseServerApis({ a: { latest: 0 }, b: 'x', c: null })).toBeNull();
  });
});

describe('announcedApis', () => {
  test('memuat 35 kelompok v1 dan mengembalikan salinan', () => {
    const apis = announcedApis();
    expect(Object.keys(apis)).toHaveLength(35);
    for (const info of Object.values(apis)) expect(info).toEqual({ latest: 1, deprecated: [] });
    apis.qrcodes?.deprecated.push(9);
    if (apis.qrcodes) apis.qrcodes.latest = 7;
    expect(API_GROUP_VERSIONS.qrcodes).toEqual({ latest: 1, deprecated: [] });
  });
});

describe('apiVersionsInUse', () => {
  test('versi unik terurut dan selalu memuat 1', () => {
    expect(apiVersionsInUse(['a', 'a@2', 'b@4'])).toEqual([1, 2, 4]);
    expect(apiVersionsInUse([])).toEqual([1]);
    expect(apiVersionsInUse(['b@4', 'b@2', 'b@4'])).toEqual([1, 2, 4]);
  });
});

describe('MIN_CLIENT', () => {
  test('desktop berupa semver X.Y.Z sah', () => {
    expect(MIN_CLIENT.desktop).toMatch(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  });
});

describe('CLIENT_OUTDATED', () => {
  test('kode galat dikenal kontrak', () => {
    expect(ERROR_CODES).toContain('CLIENT_OUTDATED');
  });
});

describe('matchRetiredRoute', () => {
  const retired: RetiredRoute[] = [
    { id: 'brands.rename', verb: 'PUT', path: '/brands/{id}', removedIn: 'server-v1.4.0' },
    { id: 'a.b@2', verb: 'GET', path: '/x', removedIn: 'server-v1.4.0' },
  ];
  test('verba, versi, dan templat segmen cocok', () => {
    expect(matchRetiredRoute(retired, 'PUT', 1, '/brands/abc')?.id).toBe('brands.rename');
    expect(matchRetiredRoute(retired, 'GET', 2, '/x')?.id).toBe('a.b@2');
  });
  test('verba, versi, atau bentuk jalur yang berbeda tidak cocok', () => {
    expect(matchRetiredRoute(retired, 'GET', 1, '/brands/abc')).toBeNull();
    expect(matchRetiredRoute(retired, 'PUT', 1, '/brands/abc/extra')).toBeNull();
    expect(matchRetiredRoute(retired, 'PUT', 1, '/brands/')).toBeNull();
    expect(matchRetiredRoute(retired, 'PUT', 1, '/brands//')).toBeNull();
    expect(matchRetiredRoute(retired, 'PUT', 2, '/brands/abc')).toBeNull();
  });
  test('daftar kosong = tidak ada yang cocok', () => {
    expect(matchRetiredRoute([], 'PUT', 1, '/brands/abc')).toBeNull();
  });
});

describe('deprecatedGroupsInUse', () => {
  const ids = ['a.b', 'a.b@2', 'c.d'];
  test('peta server null = tidak ada', () => {
    expect(deprecatedGroupsInUse(ids, null)).toEqual([]);
  });
  test('klien mengenal v2 yang masih sehat = tidak ada', () => {
    const apis = { a: { latest: 2, deprecated: [1] }, c: { latest: 1, deprecated: [] } };
    expect(deprecatedGroupsInUse(ids, apis)).toEqual([]);
  });
  test('versi pilihan klien ikut deprecated = kelompoknya terdaftar', () => {
    expect(deprecatedGroupsInUse(ids, { a: { latest: 2, deprecated: [1, 2] } })).toEqual(['a']);
  });
  test('klien hanya mengenal v1 yang sudah deprecated = terdaftar', () => {
    expect(deprecatedGroupsInUse(['a.b', 'c.d'], { a: { latest: 2, deprecated: [1] } })).toEqual([
      'a',
    ]);
  });
  test('kelompok yang tak ada di peta server tidak dihitung', () => {
    expect(deprecatedGroupsInUse(ids, { z: { latest: 1, deprecated: [1] } })).toEqual([]);
  });
});

describe('parseMinClient dan isBelowMinClient', () => {
  test('hanya objek dengan desktop semver X.Y.Z yang sah', () => {
    expect(parseMinClient({ desktop: '1.2.3' })).toEqual({ desktop: '1.2.3' });
    for (const bad of [
      null,
      'x',
      [],
      {},
      { desktop: 3 },
      { desktop: '1.2' },
      { desktop: '01.2.3' },
    ]) {
      expect(parseMinClient(bad)).toBeNull();
    }
  });
  test('versi terpasang di bawah minimum = true; selebihnya false', () => {
    expect(isBelowMinClient('1.2.0', { desktop: '1.10.0' })).toBe(true);
    expect(isBelowMinClient('1.10.0', { desktop: '1.2.0' })).toBe(false);
    expect(isBelowMinClient('1.2.0', { desktop: '1.2.0' })).toBe(false);
    expect(isBelowMinClient('x', { desktop: '1.2.0' })).toBe(false);
    expect(isBelowMinClient('1.2.0', null)).toBe(false);
  });
  test('MIN_CLIENT tak memaksa installer terpasang (<= versi desktop/package.json) dan sah', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../desktop/package.json', import.meta.url), 'utf-8'),
    ) as { version: string };
    expect(compareVersions(MIN_CLIENT.desktop, pkg.version)).toBeLessThanOrEqual(0);
    expect(parseMinClient({ desktop: MIN_CLIENT.desktop })).not.toBeNull();
  });
});
