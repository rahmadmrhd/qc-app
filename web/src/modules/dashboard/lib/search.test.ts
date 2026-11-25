import { DASHBOARD_GROUPS, GROUP_FILTERS } from '@shared/dashboard';
import { expect, test } from 'vitest';
import {
  defaultRange,
  effectiveRange,
  GROUP_FILTER_PARAMS,
  groupFilterParam,
  parseDashboardSearch,
  toQueryInput,
} from './search';

test('defaultRange = 30 hari terakhir sampai hari ini', () => {
  expect(defaultRange('2026-11-23')).toEqual({ from: '2026-10-25', to: '2026-11-23' });
});

test('skema menolak (membuang) lebih dari 20 nilai bu, loc, dan filter grup', () => {
  const many = Array.from({ length: 21 }, (_, index) => `id${index}`);
  const parsed = parseDashboardSearch({
    bu: many,
    loc: many,
    handover_customer: many,
    from: '2026-11-01',
  });
  expect(parsed.bu).toBeUndefined();
  expect(parsed.loc).toBeUndefined();
  expect(parsed.handover_customer).toBeUndefined();
  expect(parsed.from).toBe('2026-11-01');
  const ok = parseDashboardSearch({ bu: many.slice(0, 20) });
  expect(ok.bu?.length).toBe(20);
});

test('tanggal bukan YYYY-MM-DD dibuang', () => {
  const parsed = parseDashboardSearch({ from: '2026/11/01', to: 'kemarin' });
  expect(parsed.from).toBeUndefined();
  expect(parsed.to).toBeUndefined();
});

test('param filter grup dibangkitkan dari GROUP_FILTERS dan tak ada <grup>_bu/location/date', () => {
  const expected = DASHBOARD_GROUPS.flatMap((group) =>
    GROUP_FILTERS[group].map((field) => groupFilterParam(group, field.key)),
  );
  expect(GROUP_FILTER_PARAMS.map((entry) => entry.param).sort()).toEqual([...expected].sort());
  const names = new Set(GROUP_FILTER_PARAMS.map((entry) => entry.param));
  for (const group of DASHBOARD_GROUPS) {
    for (const reserved of ['bu', 'location', 'date']) {
      expect(names.has(`${group}_${reserved}`)).toBe(false);
    }
  }
  expect(names.has('serial_custody')).toBe(true);
});

test('effectiveRange: rentang sah dipakai, tidak sah kembali ke bawaan', () => {
  const today = '2026-11-23';
  expect(effectiveRange({ from: '2026-11-01', to: '2026-11-10' }, today)).toEqual({
    from: '2026-11-01',
    to: '2026-11-10',
  });
  expect(effectiveRange({ from: '2026-11-10', to: '2026-11-01' }, today)).toEqual(
    defaultRange(today),
  );
  expect(effectiveRange({ from: '2024-01-01', to: '2026-11-10' }, today)).toEqual(
    defaultRange(today),
  );
  expect(effectiveRange({ from: '2026-11-10' }, today)).toEqual(defaultRange(today));
});

test('toQueryInput hanya memuat widget yang diminta dan filter grup widget itu', () => {
  const input = toQueryInput(
    {
      bu: ['b1'],
      loc: ['l1'],
      from: '2026-11-01',
      to: '2026-11-10',
      handover_status: ['done'],
      serial_status: ['good'],
    },
    '2026-11-23',
    ['hs.created', 'sn.status'],
  );
  expect(input.filter).toEqual({
    from: '2026-11-01',
    to: '2026-11-10',
    buIds: ['b1'],
    locationIds: ['l1'],
  });
  expect(input.widgets).toEqual([
    { id: 'hs.created', filters: { status: ['done'] } },
    { id: 'sn.status', filters: { status: ['good'] } },
  ]);
});

test('toQueryInput tanpa filter: tanpa buIds/locationIds/filters; rentang bawaan', () => {
  const input = toQueryInput({}, '2026-11-23', ['st.postel']);
  expect(input).toEqual({
    filter: { from: '2026-10-25', to: '2026-11-23' },
    widgets: [{ id: 'st.postel' }],
  });
});
