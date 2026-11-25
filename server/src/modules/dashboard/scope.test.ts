import { describe, expect, test } from 'bun:test';
import type { UserContext } from '@server/modules/access/context';
import { captureAppError } from '@server-test/errors';
import type { LocationPermissionMap } from '@shared/assignments';
import type { BuPermissionMap } from '@shared/business-units';
import { WIDGETS, widgetMeta } from '@shared/dashboard';
import type { PartialPermissionMap } from '@shared/permissions';
import { emptyPermissions } from '@shared/permissions';
import { allowedWidgetIds, resolveScope, widgetAllowed } from './scope';

const noBu = { item: 'none', serial: 'none', serialservice: 'none', countrylock: 'none' } as const;
const noLoc: LocationPermissionMap = {
  handover: 'none',
  qc: 'none',
  stock: 'none',
  stickerstock: 'none',
};

function user(options: {
  locations?: Record<string, Partial<LocationPermissionMap>>;
  businessUnits?: Record<string, Partial<BuPermissionMap>>;
  permissions?: PartialPermissionMap;
}): UserContext {
  const locations: Record<string, LocationPermissionMap> = {};
  for (const [id, perm] of Object.entries(options.locations ?? {})) {
    locations[id] = { ...noLoc, ...perm };
  }
  const businessUnits: Record<string, BuPermissionMap> = {};
  for (const [id, perm] of Object.entries(options.businessUnits ?? {})) {
    businessUnits[id] = { ...noBu, ...perm };
  }
  return {
    email: 'u@gmail.com',
    name: 'U',
    userId: 'u1',
    isSuperAdmin: false,
    permissions: { ...emptyPermissions(), ...options.permissions },
    locations,
    businessUnits,
    sharedAccount: false,
    deletedBuIds: [],
  };
}

const NOW = Date.UTC(2026, 10, 23, 5, 0, 0); // 23 Nov 2026 12:00 WIB
const RANGE = { from: '2026-11-01', to: '2026-11-23' };

function groupsOf(ids: readonly string[]): string[] {
  const groups = new Set(ids.map((id) => widgetMeta(id as never).group));
  return [...groups].sort();
}

describe('izin widget', () => {
  test('handover: view di satu lokasi membuka hanya grup serah terima', () => {
    const ctx = user({ locations: { A: { handover: 'view' } } });
    const ids = allowedWidgetIds(ctx);
    expect(ids.length).toBeGreaterThan(0);
    expect(groupsOf(ids)).toEqual(['handover']);
  });

  test('qc: edit saja juga membuka grup serah terima', () => {
    const ctx = user({ locations: { A: { qc: 'edit' } } });
    expect(groupsOf(allowedWidgetIds(ctx))).toEqual(['handover']);
  });

  test('serialservice: view pada satu BU membuka grup serial dan laporan', () => {
    const ctx = user({ businessUnits: { X: { serialservice: 'view' } } });
    expect(groupsOf(allowedWidgetIds(ctx))).toEqual(['report', 'serial']);
  });

  test('stok stiker: stickerstock view di lokasi membuka grup stok stiker', () => {
    const ctx = user({ locations: { A: { stickerstock: 'view' } } });
    expect(groupsOf(allowedWidgetIds(ctx))).toEqual(['sticker']);
  });

  test('sticker: view global saja tidak membuka widget apa pun (Postel dihapus dari dashboard)', () => {
    const ctx = user({ permissions: { sticker: 'view' } });
    expect(groupsOf(allowedWidgetIds(ctx))).toEqual([]);
    expect(widgetAllowed(ctx, widgetMeta('st.postel'))).toBe(false);
    expect(widgetAllowed(ctx, widgetMeta('st.out'))).toBe(false);
  });

  test('tanpa penugasan apa pun tidak ada widget', () => {
    expect(allowedWidgetIds(user({}))).toEqual([]);
  });

  test('pengguna dengan semua izin melihat seluruh registry', () => {
    const ctx = user({
      locations: { A: { handover: 'manage', stickerstock: 'manage' } },
      businessUnits: { X: { serial: 'manage' } },
      permissions: { sticker: 'manage' },
    });
    expect(allowedWidgetIds(ctx).length).toBe(WIDGETS.length);
  });
});

describe('resolveScope: hak dan irisan filter', () => {
  const full = user({
    locations: {
      A: { handover: 'view', stickerstock: 'view' },
      B: { qc: 'edit' },
      C: { stickerstock: 'view' },
      D: { stock: 'view' },
    },
    businessUnits: { X: { serial: 'view' }, Y: { serialservice: 'view' } },
  });

  test('tanpa filter: semua yang boleh dibaca', () => {
    const scope = resolveScope(full, { ...RANGE }, NOW);
    expect(scope.buIds.sort()).toEqual(['X', 'Y']);
    expect(scope.handoverLocationIds.sort()).toEqual(['A', 'B']);
    expect(scope.stockLocationIds.sort()).toEqual(['A', 'C']);
    expect(scope.serialLocationIds).toBeNull();
  });

  test('pengguna tanpa penugasan mendapat nol, bukan semua', () => {
    const scope = resolveScope(user({}), { ...RANGE }, NOW);
    expect(scope.buIds).toEqual([]);
    expect(scope.handoverLocationIds).toEqual([]);
    expect(scope.stockLocationIds).toEqual([]);
  });

  test('filter [] berarti tidak ada, bukan semua', () => {
    const scope = resolveScope(full, { ...RANGE, buIds: [], locationIds: [] }, NOW);
    expect(scope.buIds).toEqual([]);
    expect(scope.handoverLocationIds).toEqual([]);
    expect(scope.stockLocationIds).toEqual([]);
    expect(scope.serialLocationIds).toEqual([]);
  });

  test('lokasi di luar hak tidak pernah masuk', () => {
    const scope = resolveScope(full, { ...RANGE, locationIds: ['lokasi-di-luar-hak'] }, NOW);
    expect(scope.handoverLocationIds).toEqual([]);
    expect(scope.stockLocationIds).toEqual([]);
  });

  test('irisan: berhak BU X dan Y, filter [Y, Z] menghasilkan [Y]', () => {
    const scope = resolveScope(full, { ...RANGE, buIds: ['Y', 'Z'] }, NOW);
    expect(scope.buIds).toEqual(['Y']);
  });

  test('filter lokasi menyempitkan lokasi serah terima dan stok', () => {
    const scope = resolveScope(full, { ...RANGE, locationIds: ['A', 'C', 'D'] }, NOW);
    expect(scope.handoverLocationIds).toEqual(['A']);
    expect(scope.stockLocationIds.sort()).toEqual(['A', 'C']);
    expect(scope.serialLocationIds).toEqual(['A', 'C', 'D']);
  });

  test('lokasi Serial bukan batas hak: filter dipakai apa adanya', () => {
    const scope = resolveScope(full, { ...RANGE, locationIds: ['lokasi-lain'] }, NOW);
    expect(scope.serialLocationIds).toEqual(['lokasi-lain']);
  });
});

describe('resolveScope: rentang dan batas', () => {
  const ctx = user({ businessUnits: { X: { serial: 'view' } } });

  test('from > to ditolak VALIDATION', () => {
    const error = captureAppError(() =>
      resolveScope(ctx, { from: '2026-11-10', to: '2026-11-09' }, NOW),
    );
    expect(error.code).toBe('VALIDATION');
  });

  test('367 hari ditolak, 366 hari diterima', () => {
    expect(
      captureAppError(() => resolveScope(ctx, { from: '2025-11-01', to: '2026-11-02' }, NOW)).code,
    ).toBe('VALIDATION');
    expect(() => resolveScope(ctx, { from: '2025-11-02', to: '2026-11-02' }, NOW)).not.toThrow();
  });

  test('lebih dari 20 nilai filter ditolak', () => {
    const many = Array.from({ length: 21 }, (_, index) => `b${index}`);
    expect(captureAppError(() => resolveScope(ctx, { ...RANGE, buIds: many }, NOW)).code).toBe(
      'VALIDATION',
    );
    expect(
      captureAppError(() => resolveScope(ctx, { ...RANGE, locationIds: many }, NOW)).code,
    ).toBe('VALIDATION');
    expect(() => resolveScope(ctx, { ...RANGE, buIds: many.slice(0, 20) }, NOW)).not.toThrow();
  });

  test('today, bucket, dan batas UTC (periode ini dan sebelumnya) diturunkan dari rentang', () => {
    const scope = resolveScope(ctx, { from: '2026-11-17', to: '2026-11-23' }, NOW);
    expect(scope.today).toBe('2026-11-23');
    expect(scope.bucket).toBe('day');
    expect(scope.range).toEqual({ from: '2026-11-17', to: '2026-11-23' });
    expect(scope.fromIso).toBe('2026-11-16T17:00:00.000Z');
    expect(scope.toIso).toBe('2026-11-23T17:00:00.000Z');
    expect(scope.prevFromIso).toBe('2026-11-09T17:00:00.000Z');
    expect(scope.prevToIso).toBe('2026-11-16T17:00:00.000Z');
  });

  test('today memakai tanggal WIB: 23:30 UTC sudah hari berikutnya', () => {
    const late = Date.UTC(2026, 10, 23, 23, 30, 0);
    expect(resolveScope(ctx, { ...RANGE }, late).today).toBe('2026-11-24');
  });
});
