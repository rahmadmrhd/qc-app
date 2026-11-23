import { describe, expect, test } from 'bun:test';
import { type PartsData, type SeriesData, widgetMeta } from './dashboard';
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

  test('list: hanya kolom daftar putih, maks. 10 baris, total tetap', () => {
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
    expect(out.total).toBe(15);
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

  test('parts dan series disalin apa adanya', () => {
    const parts: PartsData = {
      kind: 'parts',
      slices: [{ key: 'a', label: 'A', value: 1 }],
    };
    const series: SeriesData = {
      kind: 'series',
      bucket: 'day',
      points: [{ key: '2026-11-01', label: '1 Nov' }],
      series: [{ key: 'total', label: 'Total', values: [4] }],
    };
    expect(toPublicDto('hs.status', parts)).toEqual(parts);
    expect(toPublicDto('hs.trend', series)).toEqual(series);
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
      scope: { buNames: ['BU A'], locationNames: ['Gudang'] },
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
