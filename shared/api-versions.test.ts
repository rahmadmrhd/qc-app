import { describe, expect, test } from 'bun:test';
import { API_ROUTES } from './api';
import {
  API_GROUP_VERSIONS,
  announcedApis,
  apiGroup,
  apiVersionsInUse,
  MIN_CLIENT,
  parseApiId,
  parseServerApis,
  pickApiId,
  restBase,
} from './api-versions';

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
  test('memuat 28 kelompok v1 dan mengembalikan salinan', () => {
    const apis = announcedApis();
    expect(Object.keys(apis)).toHaveLength(28);
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
