import type { ListData, NumberData, PartsData, SeriesData, WidgetMeta } from '@shared/dashboard';
import { widgetMeta } from '@shared/dashboard';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { formatDelta, formatNumber } from '../../lib/format';
import { ListWidget } from './list-widget';
import { NumberWidget } from './number-widget';
import { WidgetCard } from './widget-card';
import { WidgetRenderer } from './widget-renderer';

const desktop = vi.hoisted(() => ({ value: true }));
vi.mock('@/hooks/use-is-desktop', () => ({ useIsDesktop: () => desktop.value }));

beforeEach(() => {
  desktop.value = true;
});

describe('format', () => {
  test('formatNumber memakai pemisah ribuan Indonesia', () => {
    expect(formatNumber(1234567)).toBe('1.234.567');
    expect(formatNumber(0)).toBe('0');
  });

  test('formatDelta: naik, turun, tetap, dan tanpa pembanding', () => {
    expect(formatDelta(128, 114)).toEqual({ text: 'naik 12% dari periode lalu', tone: 'success' });
    expect(formatDelta(90, 100)).toEqual({ text: 'turun 10% dari periode lalu', tone: 'danger' });
    expect(formatDelta(7, 7)).toEqual({ text: 'tetap dari periode lalu', tone: 'muted' });
    expect(formatDelta(5, 0)).toBeNull();
    expect(formatDelta(5, undefined)).toBeNull();
  });
});

const NUMBER: NumberData = { kind: 'number', value: 128, previous: 114 };
const LIST: ListData = {
  kind: 'list',
  columns: [
    { key: 'name', label: 'Postel' },
    { key: 'days', label: 'Sisa hari' },
  ],
  rows: [
    { name: 'M3', days: 8 },
    { name: 'M5', days: -2 },
  ],
  total: 7,
};

describe('NumberWidget', () => {
  test('angka besar dan delta bertanda kata (bukan warna saja)', () => {
    render(<NumberWidget data={NUMBER} delta />);
    expect(screen.getByText('128')).toBeTruthy();
    expect(screen.getByText('naik 12% dari periode lalu')).toBeTruthy();
  });

  test('tanpa delta atau previous 0: tanpa baris perbandingan', () => {
    const { rerender } = render(<NumberWidget data={NUMBER} delta={false} />);
    expect(screen.queryByText(/periode lalu/)).toBeNull();
    rerender(<NumberWidget data={{ kind: 'number', value: 5, previous: 0 }} delta />);
    expect(screen.queryByText(/periode lalu/)).toBeNull();
  });
});

describe('ListWidget', () => {
  test('desktop: tabel dengan ringkasan "Menampilkan N dari M"', () => {
    render(<ListWidget data={LIST} />);
    const table = screen.getByRole('table');
    expect(within(table).getByText('M3')).toBeTruthy();
    expect(within(table).getByText('Sisa hari')).toBeTruthy();
    expect(screen.getByText('Menampilkan 2 dari 7')).toBeTruthy();
  });

  test('ponsel: kartu MobileCard, bukan tabel', () => {
    desktop.value = false;
    const { container } = render(<ListWidget data={LIST} />);
    expect(screen.queryByRole('table')).toBeNull();
    expect(container.querySelectorAll('[data-slot="mobile-card"]').length).toBe(2);
    expect(screen.getByText('M3')).toBeTruthy();
    expect(screen.getAllByText('Sisa hari').length).toBe(2);
  });

  test('tanpa baris: pesan netral', () => {
    render(<ListWidget data={{ ...LIST, rows: [], total: 0 }} />);
    expect(screen.getByText('Belum ada data')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

const filters = { bu: false, location: false, date: true };

describe('WidgetCard', () => {
  const meta = widgetMeta('hs.active');

  test('loading: skeleton, tanpa isi', () => {
    const { container } = render(
      <WidgetCard
        meta={meta}
        result={undefined}
        loading
        filterState={filters}
        onRetry={() => {}}
      />,
    );
    expect(container.querySelector('[data-slot="skeleton"]')).toBeTruthy();
    expect(screen.getByText(meta.title)).toBeTruthy();
  });

  test('galat: pesan dan tombol "Coba lagi" memanggil onRetry', async () => {
    const onRetry = vi.fn();
    render(
      <WidgetCard
        meta={meta}
        result={{ id: meta.id, status: 'error', message: 'Widget tidak dapat dimuat' }}
        loading={false}
        filterState={filters}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('Widget tidak dapat dimuat')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test('"BU tidak berlaku" hanya bila filter BU aktif DAN widget tak mengikuti BU', () => {
    const noBu = widgetMeta('hs.active');
    expect(noBu.bu).toBe(false);
    const render1 = render(
      <WidgetCard
        meta={noBu}
        result={{ id: noBu.id, status: 'ok', data: { kind: 'number', value: 1 } }}
        loading={false}
        filterState={{ bu: true, location: false, date: true }}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText('BU tidak berlaku')).toBeTruthy();
    render1.unmount();
    render(
      <WidgetCard
        meta={noBu}
        result={{ id: noBu.id, status: 'ok', data: { kind: 'number', value: 1 } }}
        loading={false}
        filterState={{ bu: false, location: false, date: true }}
        onRetry={() => {}}
      />,
    );
    expect(screen.queryByText('BU tidak berlaku')).toBeNull();
  });

  test('widget yang mengikuti BU tak pernah memberi penanda BU tidak berlaku', () => {
    const withBu = widgetMeta('sn.status');
    expect(withBu.bu).toBe(true);
    render(
      <WidgetCard
        meta={withBu}
        result={{ id: withBu.id, status: 'ok', data: { kind: 'parts', slices: [] } }}
        loading={false}
        filterState={{ bu: true, location: true, date: true }}
        onRetry={() => {}}
      />,
    );
    expect(screen.queryByText('BU tidak berlaku')).toBeNull();
  });

  test('"Kondisi saat ini" untuk widget tanpa tanggal dan "per lokasi" untuk stok', () => {
    const stock = widgetMeta('st.out');
    render(
      <WidgetCard
        meta={stock}
        result={{ id: stock.id, status: 'ok', data: { kind: 'number', value: 3 } }}
        loading={false}
        filterState={filters}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText('Kondisi saat ini')).toBeTruthy();
    expect(screen.getByText('per lokasi')).toBeTruthy();
  });

  test('"Lokasi tidak berlaku" hanya bila filter lokasi aktif dan widget tak mengikuti lokasi', () => {
    const noLocation = widgetMeta('pt.condition');
    expect(noLocation.location).toBe('none');
    render(
      <WidgetCard
        meta={noLocation}
        result={{ id: noLocation.id, status: 'ok', data: { kind: 'parts', slices: [] } }}
        loading={false}
        filterState={{ bu: false, location: true, date: true }}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText('Lokasi tidak berlaku')).toBeTruthy();
  });
});

const PARTS: PartsData = { kind: 'parts', slices: [{ key: 'a', label: 'Satu', value: 3 }] };
const SERIES: SeriesData = {
  kind: 'series',
  bucket: 'day',
  points: [{ key: 'd1', label: '1 Nov' }],
  series: [{ key: 'x', label: 'Seri X', values: [4] }],
};

function metaOf(visual: WidgetMeta['visual']): WidgetMeta {
  return { ...widgetMeta('hs.active'), visual, title: `Judul ${visual}` };
}

describe('WidgetRenderer', () => {
  test('number memilih NumberWidget', () => {
    render(<WidgetRenderer meta={metaOf('number')} data={{ kind: 'number', value: 42 }} />);
    expect(screen.getByText('42')).toBeTruthy();
  });

  test('list memilih ListWidget', () => {
    render(<WidgetRenderer meta={metaOf('list')} data={LIST} />);
    expect(screen.getByRole('table')).toBeTruthy();
  });

  test.each(['donut', 'pie', 'bar', 'barH'] as const)(
    '%s dari irisan merender grafik',
    async (visual) => {
      render(<WidgetRenderer meta={metaOf(visual)} data={PARTS} />);
      expect(
        await screen.findByRole('img', { name: `Judul ${visual}` }, { timeout: 5000 }),
      ).toBeTruthy();
    },
  );

  test.each(['line', 'barGroup'] as const)('%s dari seri merender grafik', async (visual) => {
    render(<WidgetRenderer meta={metaOf(visual)} data={SERIES} />);
    expect(
      await screen.findByRole('img', { name: `Judul ${visual}` }, { timeout: 5000 }),
    ).toBeTruthy();
  });

  test('bentuk data tak cocok dengan visual: pesan, bukan crash', () => {
    render(<WidgetRenderer meta={metaOf('donut')} data={{ kind: 'number', value: 1 }} />);
    expect(screen.getByText('Data tidak dapat ditampilkan')).toBeTruthy();
  });
});
