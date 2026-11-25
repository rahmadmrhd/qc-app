import type { PartsData, SeriesData } from '@shared/dashboard';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import {
  CHART_SERIES_TOKENS,
  limitSlices,
  OTHER_SERIES_COLOR,
  seriesColor,
} from '../../lib/colors';
import { BarListChart } from './bar-list-chart';
import { ChartFrame } from './chart-frame';
import { ColumnChart } from './column-chart';
import { DonutChart } from './donut-chart';
import { LineChart } from './line-chart';
import { ScrollBarChart } from './scroll-bar-chart';

const parts = (values: number[]): PartsData => ({
  kind: 'parts',
  slices: values.map((value, index) => ({ key: `k${index}`, label: `Irisan ${index + 1}`, value })),
});

const series = (rows: Record<string, number[]>): SeriesData => ({
  kind: 'series',
  bucket: 'day',
  points: [
    { key: '2026-11-10', label: '10 Nov' },
    { key: '2026-11-11', label: '11 Nov' },
  ],
  series: Object.entries(rows).map(([key, values]) => ({ key, label: `Seri ${key}`, values })),
});

describe('warna seri', () => {
  test('delapan token berwarna berurutan; lewat token berputar kembali, tak pernah netral', () => {
    expect(CHART_SERIES_TOKENS.length).toBe(8);
    expect(seriesColor(0)).toBe(CHART_SERIES_TOKENS[0]);
    expect(seriesColor(7)).toBe(CHART_SERIES_TOKENS[7]);
    expect(seriesColor(8)).toBe(CHART_SERIES_TOKENS[0]);
    expect(seriesColor(40)).toBe(CHART_SERIES_TOKENS[0]);
    expect(OTHER_SERIES_COLOR).toBe('var(--chart-8)');
  });
});

describe('limitSlices', () => {
  test('10 irisan menjadi 8: tujuh terbesar dahulu, lalu "Lainnya" berisi jumlah sisanya', () => {
    const limited = limitSlices(parts([1, 9, 3, 8, 2, 7, 4, 6, 10, 5]).slices);
    expect(limited.length).toBe(8);
    expect(limited.map((slice) => slice.value)).toEqual([10, 9, 8, 7, 6, 5, 4, 6]);
    expect(limited[7]).toEqual({ key: 'other', label: 'Lainnya', value: 3 + 2 + 1 });
  });

  test('tidak lebih dari batas: apa adanya', () => {
    const slices = parts([1, 2, 3]).slices;
    expect(limitSlices(slices)).toBe(slices);
    expect(limitSlices(parts([1, 2, 3, 4, 5, 6, 7, 8]).slices).length).toBe(8);
  });
});

function expectAccessible(label: string, values: string[]) {
  const image = screen.getByRole('img', { name: new RegExp(label) });
  expect(image).toBeTruthy();
  const table = screen.getByRole('table', { hidden: true });
  expect(table.className).toContain('sr-only');
  for (const value of values)
    expect(within(table).getAllByText(value, { exact: true }).length).toBeGreaterThan(0);
}

describe('DonutChart', () => {
  test('role=img + label, tabel tersembunyi berisi semua nilai, legenda berlabel teks', () => {
    render(<DonutChart data={parts([5, 3])} label="Kondisi Postel" />);
    expectAccessible('Kondisi Postel', ['Irisan 1', '5', 'Irisan 2', '3']);
    const legend = screen.getByRole('list', { name: /legenda/i });
    expect(within(legend).getByText('Irisan 1')).toBeTruthy();
    expect(within(legend).getByText('Irisan 2')).toBeTruthy();
  });

  test('irisan lebih dari delapan digabung "Lainnya"; pie tetap dirender', () => {
    render(<DonutChart data={parts([1, 2, 3, 4, 5, 6, 7, 8, 9])} label="Banyak" pie />);
    const table = screen.getByRole('table', { hidden: true });
    expect(within(table).getByText('Lainnya')).toBeTruthy();
    expect(within(table).queryByText('Irisan 1')).toBeNull();
  });

  test('donat menampilkan total semua irisan di tengah; pie tidak', () => {
    const { unmount } = render(<DonutChart data={parts([20, 5, 1200])} label="Total" />);
    expect(document.querySelector('[data-slot="donut-total"]')?.textContent).toContain('1.225');
    unmount();
    render(<DonutChart data={parts([20, 5])} label="Pie" pie />);
    expect(document.querySelector('[data-slot="donut-total"]')).toBeNull();
  });

  test('tanpa data: pesan "Belum ada data", tanpa grafik', () => {
    render(<DonutChart data={parts([])} label="Kosong" />);
    expect(screen.getByText('Belum ada data')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  test('semua nilai nol dianggap kosong', () => {
    render(<DonutChart data={parts([0, 0])} label="Nol" />);
    expect(screen.getByText('Belum ada data')).toBeTruthy();
  });
});

describe('ScrollBarChart', () => {
  test('banyak batang: wilayah gulir horizontal dapat difokus, lebar menurut jumlah, urutan data dipertahankan', () => {
    render(<ScrollBarChart data={parts([5, 1, 9, 3, 7, 2, 8, 4, 6, 10, 11, 12])} label="Stok" />);
    const scroller = document.querySelector('[data-slot="chart-scroller"]') as HTMLElement;
    expect(scroller.getAttribute('tabindex')).toBe('0');
    expect(scroller.className).toContain('overflow-x-auto');
    expect(scroller.getAttribute('aria-label')).toBe('Stok (dapat digulir)');
    expectAccessible('Stok', ['Irisan 1', '5', 'Irisan 12', '12']);
  });

  test('tanpa data: pesan "Belum ada data"', () => {
    render(<ScrollBarChart data={parts([])} label="Kosong" />);
    expect(screen.getByText('Belum ada data')).toBeTruthy();
  });
});

describe('ColumnChart', () => {
  test('dua seri = berkelompok: legenda memuat kedua label, tabel memuat semua nilai', () => {
    render(<ColumnChart data={series({ in: [4, 0], out: [7, 2] })} label="Gerak stok" />);
    expectAccessible('Gerak stok', ['10 Nov', '11 Nov', '4', '7', '2']);
    const legend = screen.getByRole('list', { name: /legenda/i });
    expect(within(legend).getByText('Seri in')).toBeTruthy();
    expect(within(legend).getByText('Seri out')).toBeTruthy();
  });

  test('semua nilai nol = "Belum ada data"', () => {
    render(<ColumnChart data={series({ in: [0, 0] })} label="Kosong" />);
    expect(screen.getByText('Belum ada data')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('LineChart', () => {
  test('role=img, tabel tersembunyi, legenda', () => {
    render(<LineChart data={series({ opened: [1, 3], closed: [2, 0] })} label="Tren laporan" />);
    expectAccessible('Tren laporan', ['10 Nov', '1', '3', '2']);
    expect(
      within(screen.getByRole('list', { name: /legenda/i })).getByText('Seri opened'),
    ).toBeTruthy();
  });

  test('tanpa titik = "Belum ada data"', () => {
    render(
      <LineChart data={{ kind: 'series', bucket: 'day', points: [], series: [] }} label="Kosong" />,
    );
    expect(screen.getByText('Belum ada data')).toBeTruthy();
  });
});

describe('BarListChart', () => {
  test('role=img dan tabel tersembunyi berisi semua nilai (termasuk negatif)', () => {
    render(<BarListChart data={parts([20, -4])} label="Total stok per jenis" />);
    expectAccessible('Total stok per jenis', ['Irisan 1', '20', 'Irisan 2', '-4']);
  });

  test('tanpa irisan = "Belum ada data"', () => {
    render(<BarListChart data={parts([])} label="Kosong" />);
    expect(screen.getByText('Belum ada data')).toBeTruthy();
  });
});

describe('ChartFrame', () => {
  test('baris tabel tersembunyi kembar tidak memicu peringatan kunci React dan semuanya tampil', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <ChartFrame
          label="Customer teratas"
          head={['Customer', 'Jumlah']}
          rows={[
            ['PT Sama', 3],
            ['PT Sama', 3],
          ]}
        >
          <span />
        </ChartFrame>,
      );
      expect(screen.getAllByRole('cell', { name: 'PT Sama' })).toHaveLength(2);
      const warned = error.mock.calls.some((call) => String(call[0]).includes('same key'));
      expect(warned).toBe(false);
    } finally {
      error.mockRestore();
    }
  });
});
