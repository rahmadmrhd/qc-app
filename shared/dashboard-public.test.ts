import { describe, expect, test } from 'bun:test';
import {
  type PartsData,
  type SeriesData,
  WIDGET_IDS,
  type WidgetData,
  widgetMeta,
} from './dashboard';
import { PUBLIC_LIST_ROW_MAX, type PublicDashboardDto, toPublicDto } from './dashboard-public';

describe('toPublicDto', () => {
  test('number: previous dibuang, value dipertahankan', () => {
    const out = toPublicDto('hs.created', { kind: 'number', value: 3, previous: 2 });
    expect(out).toEqual({ kind: 'number', value: 3 });
    expect('previous' in out).toBe(false);
  });

  test('number tanpa previous tetap sah', () => {
    expect(toPublicDto('sn.recorded', { kind: 'number', value: 0 })).toEqual({
      kind: 'number',
      value: 0,
    });
  });

  test('list: hanya kolom daftar putih, maks. 10 baris, tanpa total', () => {
    const columns = widgetMeta('hs.oldest').listColumns ?? [];
    expect(columns.length).toBeGreaterThan(0);
    const rows = Array.from({ length: 15 }, (_, index) => {
      const row: Record<string, string | number> = { note: 'rahasia', email: 'x@gmail.com' };
      for (const column of columns) row[column.key] = `${column.key}-${index}`;
      return row;
    });
    const out = toPublicDto('hs.oldest', {
      kind: 'list',
      columns: [...columns, { key: 'note', label: 'Catatan' }, { key: 'email', label: 'Surel' }],
      rows,
      total: 15,
    });
    expect(PUBLIC_LIST_ROW_MAX).toBe(10);
    if (out.kind !== 'list') throw new Error('harus list');
    expect('total' in out).toBe(false);
    expect(out.rows).toHaveLength(10);
    expect(out.columns).toEqual([...columns]);
    for (const row of out.rows) {
      expect(Object.keys(row).sort()).toEqual(columns.map((column) => column.key).sort());
    }
    expect(JSON.stringify(out)).not.toContain('rahasia');
    expect(JSON.stringify(out)).not.toContain('x@gmail.com');
  });

  test('list: kolom putih yang tak ada di data tetap ada dengan nilai kosong, bukan galat', () => {
    const columns = widgetMeta('hs.oldest').listColumns ?? [];
    const first = columns[0];
    if (!first) throw new Error('kolom putih kosong');
    const out = toPublicDto('hs.oldest', {
      kind: 'list',
      columns: [{ key: first.key, label: first.label }],
      rows: [{ [first.key]: 'ST-1' }],
      total: 1,
    });
    if (out.kind !== 'list') throw new Error('harus list');
    expect(out.columns).toEqual([...columns]);
    const row = out.rows[0] ?? {};
    expect(row[first.key]).toBe('ST-1');
    for (const column of columns.slice(1)) expect(row[column.key]).toBe('');
  });

  test('list pada widget tanpa daftar kolom putih: tanpa kolom dan tanpa isi baris', () => {
    const out = toPublicDto('hs.created', {
      kind: 'list',
      columns: [{ key: 'x', label: 'X' }],
      rows: [{ x: 'bocor' }],
      total: 1,
    });
    if (out.kind !== 'list') throw new Error('harus list');
    expect(out.columns).toEqual([]);
    expect(JSON.stringify(out)).not.toContain('bocor');
  });

  test('parts dan series: label dan nilai disalin, key irisan/seri diganti indeks, key titik waktu tetap', () => {
    const parts: PartsData = {
      kind: 'parts',
      slices: [
        { key: 'a', label: 'A', value: 1 },
        { key: 'b', label: 'B', value: 2 },
      ],
    };
    const series: SeriesData = {
      kind: 'series',
      bucket: 'day',
      points: [{ key: '2026-11-01', label: '1 Nov' }],
      series: [
        { key: 'total', label: 'Total', values: [4] },
        { key: 'lain', label: 'Lain', values: [5] },
      ],
    };
    expect(toPublicDto('hs.status', parts)).toEqual({
      kind: 'parts',
      slices: [
        { key: '0', label: 'A', value: 1 },
        { key: '1', label: 'B', value: 2 },
      ],
    });
    expect(toPublicDto('hs.trend', series)).toEqual({
      kind: 'series',
      bucket: 'day',
      points: [{ key: '2026-11-01', label: '1 Nov' }],
      series: [
        { key: '0', label: 'Total', values: [4] },
        { key: '1', label: 'Lain', values: [5] },
      ],
    });
  });

  test('id internal (ULID) pada key irisan dan seri tidak keluar ke publik', () => {
    const ulid = '01hzx3k9m2n4p5q6r7s8t9v0wa';
    const parts: PartsData = {
      kind: 'parts',
      slices: [{ key: ulid, label: 'Gudang', value: 3 }],
    };
    const series: SeriesData = {
      kind: 'series',
      bucket: 'day',
      points: [{ key: '2026-11-01', label: '1 Nov' }],
      series: [{ key: ulid, label: 'PT Maju', values: [1] }],
    };
    expect(JSON.stringify(toPublicDto('hs.status', parts))).not.toContain(ulid);
    expect(JSON.stringify(toPublicDto('hs.trend', series))).not.toContain(ulid);
  });

  test('widget daftar publik tidak memuat total', () => {
    const columns = widgetMeta('hs.oldest').listColumns ?? [];
    const out = toPublicDto('hs.oldest', {
      kind: 'list',
      columns: [...columns],
      rows: [{ [columns[0]?.key ?? 'x']: 'ST-1' }],
      total: 999,
    });
    expect('total' in out).toBe(false);
    expect(JSON.stringify(out)).not.toContain('999');
  });

  test('semua widget bergrup per lokasi/customer/item/BU: keluaran publik tanpa id internal dan tanpa total', () => {
    const internal = '01hzx3k9m2n4p5q6r7s8t9v0wa';
    for (const id of WIDGET_IDS) {
      const meta = widgetMeta(id);
      if (meta.visual === 'number') continue;
      let data: WidgetData;
      if (meta.visual === 'list') {
        const columns = meta.listColumns ?? [];
        data = {
          kind: 'list',
          columns: [...columns],
          rows: [Object.fromEntries(columns.map((column) => [column.key, 'x']))],
          total: 42,
        };
      } else if (meta.visual === 'line' || meta.visual === 'barGroup') {
        data = {
          kind: 'series',
          bucket: 'day',
          points: [{ key: '2026-11-01', label: '1 Nov' }],
          series: [{ key: internal, label: 'S', values: [1] }],
        };
      } else {
        data = { kind: 'parts', slices: [{ key: internal, label: 'P', value: 1 }] };
      }
      const out = toPublicDto(id, data);
      expect([id, JSON.stringify(out).includes(internal)]).toEqual([id, false]);
      expect([id, 'total' in out]).toEqual([id, false]);
    }
  });

  test('hasil tidak berbagi referensi dengan masukan (nilai seri disalin)', () => {
    const series: SeriesData = {
      kind: 'series',
      bucket: 'day',
      points: [{ key: 'p', label: 'P' }],
      series: [{ key: 's', label: 'S', values: [1] }],
    };
    const out = toPublicDto('hs.trend', series);
    if (out.kind !== 'series') throw new Error('harus series');
    expect(out.series[0]?.values).not.toBe(series.series[0]?.values);
  });

  test('parts dan series: properti tak dikenal yang ditambahkan widget TIDAK ikut (daftar putih eksplisit)', () => {
    const parts = {
      kind: 'parts',
      slices: [{ key: 'a', label: 'A', value: 1, internalId: 'rahasia', extra: { x: 1 } }],
    } as unknown as PartsData;
    const series = {
      kind: 'series',
      bucket: 'day',
      points: [{ key: 'p', label: 'P', email: 'x@gmail.com' }],
      series: [{ key: 's', label: 'S', values: [1], note: 'rahasia' }],
    } as unknown as SeriesData;
    const outParts = toPublicDto('hs.status', parts);
    const outSeries = toPublicDto('hs.trend', series);
    if (outParts.kind !== 'parts' || outSeries.kind !== 'series') throw new Error('bentuk salah');
    expect(Object.keys(outParts.slices[0] ?? {}).sort()).toEqual(['key', 'label', 'value']);
    expect(Object.keys(outSeries.points[0] ?? {}).sort()).toEqual(['key', 'label']);
    expect(Object.keys(outSeries.series[0] ?? {}).sort()).toEqual(['key', 'label', 'values']);
    expect(JSON.stringify([outParts, outSeries])).not.toContain('rahasia');
    expect(JSON.stringify([outParts, outSeries])).not.toContain('x@gmail.com');
  });

  test('hasil tidak berbagi referensi dengan masukan (parts/series disalin)', () => {
    const parts: PartsData = { kind: 'parts', slices: [{ key: 'a', label: 'A', value: 1 }] };
    const out = toPublicDto('hs.status', parts);
    if (out.kind !== 'parts') throw new Error('harus parts');
    expect(out.slices).not.toBe(parts.slices);
  });
});

describe('PublicDashboardDto', () => {
  test('kunci setiap entri widget tepat id, group, result', () => {
    const dto: PublicDashboardDto = {
      title: 'Ringkasan',
      sharedBy: 'andi',
      generatedAt: '2026-11-23T05:00:00.000Z',
      expiresAt: '2026-12-23T05:00:00.000Z',
      range: { from: '2026-11-01', to: '2026-11-23' },
      bounds: { from: '2026-11-01', to: '2026-11-23' },
      bucket: 'day',
      scope: {
        buNames: ['BU A'],
        buDeleted: [false],
        locationNames: ['Gudang'],
        locationDeleted: [false],
      },
      options: { bu: [], location: [], groups: {} },
      widgets: [
        {
          id: 'hs.created',
          group: 'handover',
          result: { status: 'ok', data: toPublicDto('hs.created', { kind: 'number', value: 1 }) },
        },
        {
          id: 'hs.active',
          group: 'handover',
          result: { status: 'error', message: 'Widget tidak dapat dimuat' },
        },
      ],
    };
    for (const entry of dto.widgets) {
      expect(Object.keys(entry).sort()).toEqual(['group', 'id', 'result']);
    }
  });
});
