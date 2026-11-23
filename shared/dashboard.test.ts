import { describe, expect, test } from 'bun:test';
import {
  bucketFor,
  DASHBOARD_GROUPS,
  DASHBOARD_RANGE_MAX_DAYS,
  GLOBAL_FILTER_KEYS,
  GROUP_FILTERS,
  GROUP_LABELS,
  previousRange,
  rangePreset,
  validateDashboardRange,
  WIDGET_IDS,
  WIDGETS,
  wibRangeToUtc,
  widgetMeta,
} from './dashboard';

describe('registry widget', () => {
  test('id unik, 27 widget, tiap grup punya minimal satu', () => {
    expect(new Set(WIDGET_IDS).size).toBe(WIDGET_IDS.length);
    expect(WIDGET_IDS.length).toBe(27);
    expect(WIDGETS.length).toBe(WIDGET_IDS.length);
    for (const group of DASHBOARD_GROUPS) {
      expect(WIDGETS.some((widget) => widget.group === group)).toBe(true);
      expect(GROUP_LABELS[group]).toBeTruthy();
    }
  });

  test('widgetMeta(id).id sama dengan id untuk semua widget', () => {
    for (const id of WIDGET_IDS) expect(widgetMeta(id).id).toBe(id);
  });

  test('field filter grup tidak pernah memakai kunci filter global', () => {
    for (const group of DASHBOARD_GROUPS) {
      for (const field of GROUP_FILTERS[group]) {
        expect((GLOBAL_FILTER_KEYS as readonly string[]).includes(field.key)).toBe(false);
      }
    }
  });

  test('widget list punya listColumns tanpa kolom sensitif', () => {
    const banned = ['note', 'comment', 'email', 'file', 'actor'];
    const lists = WIDGETS.filter((widget) => widget.visual === 'list');
    expect(lists.length).toBeGreaterThan(0);
    for (const widget of lists) {
      expect(widget.listColumns?.length).toBeGreaterThan(0);
      for (const column of widget.listColumns ?? []) expect(banned).not.toContain(column.key);
    }
    for (const widget of WIDGETS.filter((item) => item.visual !== 'list')) {
      expect(widget.listColumns).toBeUndefined();
    }
  });

  test('metadata cakupan sesuai spek (BU, lokasi, tanggal, akses)', () => {
    expect(widgetMeta('hs.created')).toMatchObject({
      bu: false,
      location: 'handover',
      delta: true,
    });
    expect(widgetMeta('hs.active').date).toEqual({ kind: 'none' });
    expect(widgetMeta('sn.recorded')).toMatchObject({ bu: true, location: 'serial', delta: true });
    expect(widgetMeta('st.low')).toMatchObject({ bu: false, location: 'stock' });
    expect(widgetMeta('pt.condition')).toMatchObject({ bu: false, location: 'none' });
    expect(widgetMeta('pt.condition').access).toEqual([
      { module: 'sticker', level: 'view', scope: 'global' },
    ]);
    expect(widgetMeta('hs.oldest').access).toEqual([
      { module: 'handover', level: 'view', scope: 'location' },
      { module: 'qc', level: 'edit', scope: 'location' },
    ]);
    expect(widgetMeta('rp.open').access).toEqual([
      { module: 'serial', level: 'view', scope: 'bu' },
      { module: 'serialservice', level: 'view', scope: 'bu' },
    ]);
    expect(widgetMeta('st.movement').date).toEqual({ kind: 'column', label: 'Tanggal entri stok' });
  });
});

describe('rentang tanggal', () => {
  const span = (from: string, days: number) => {
    const start = Date.UTC(
      Number(from.slice(0, 4)),
      Number(from.slice(5, 7)) - 1,
      Number(from.slice(8, 10)),
    );
    return { from, to: new Date(start + (days - 1) * 86400000).toISOString().slice(0, 10) };
  };

  test('bucketFor: harian <= 31, mingguan <= 180, selain itu bulanan', () => {
    expect(bucketFor(span('2026-01-01', 31))).toBe('day');
    expect(bucketFor(span('2026-01-01', 32))).toBe('week');
    expect(bucketFor(span('2026-01-01', 180))).toBe('week');
    expect(bucketFor(span('2026-01-01', 181))).toBe('month');
  });

  test('validateDashboardRange', () => {
    expect(typeof validateDashboardRange({ from: '2026-11-10', to: '2026-11-09' })).toBe('string');
    expect(typeof validateDashboardRange(span('2026-01-01', 367))).toBe('string');
    expect(typeof validateDashboardRange({ from: '2026-13-01', to: '2026-13-02' })).toBe('string');
    expect(typeof validateDashboardRange({ from: '2026-02-30', to: '2026-03-02' })).toBe('string');
    expect(typeof validateDashboardRange({ from: 'kemarin', to: '2026-03-02' })).toBe('string');
    expect(validateDashboardRange(span('2026-01-01', DASHBOARD_RANGE_MAX_DAYS))).toBeNull();
    expect(validateDashboardRange({ from: '2026-11-17', to: '2026-11-17' })).toBeNull();
  });

  test('wibRangeToUtc: hari WIB penuh, batas akhir eksklusif', () => {
    expect(wibRangeToUtc({ from: '2026-11-17', to: '2026-11-17' })).toEqual({
      fromIso: '2026-11-16T17:00:00.000Z',
      toIso: '2026-11-17T17:00:00.000Z',
    });
    expect(wibRangeToUtc({ from: '2026-12-30', to: '2026-12-31' })).toEqual({
      fromIso: '2026-12-29T17:00:00.000Z',
      toIso: '2026-12-31T17:00:00.000Z',
    });
  });

  test('previousRange: periode sebelumnya sama panjang', () => {
    expect(previousRange({ from: '2026-11-17', to: '2026-11-23' })).toEqual({
      from: '2026-11-10',
      to: '2026-11-16',
    });
    expect(previousRange({ from: '2026-03-01', to: '2026-03-01' })).toEqual({
      from: '2026-02-28',
      to: '2026-02-28',
    });
  });

  test('rangePreset', () => {
    expect(rangePreset('last7', '2026-11-23')).toEqual({ from: '2026-11-17', to: '2026-11-23' });
    expect(rangePreset('last30', '2026-11-23')).toEqual({ from: '2026-10-25', to: '2026-11-23' });
    expect(rangePreset('thisMonth', '2026-11-23')).toEqual({
      from: '2026-11-01',
      to: '2026-11-23',
    });
    expect(rangePreset('lastMonth', '2026-01-15')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(rangePreset('lastMonth', '2026-03-10')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });
});
