import type { SeriesData } from '@shared/dashboard';
import type { ChartConfig } from '@/components/ui/chart';
import { seriesColor } from '../../lib/colors';

/** Ada sesuatu untuk digambar: minimal satu titik dan satu nilai bukan nol. */
export function hasSeriesData(data: SeriesData): boolean {
  return (
    data.points.length > 0 && data.series.some((item) => item.values.some((value) => value !== 0))
  );
}

/** Baris recharts: `label` titik + `s<i>` per seri (kunci aman, bukan kunci mentah dari widget). */
export function seriesRows(data: SeriesData): Record<string, string | number>[] {
  return data.points.map((point, pointIndex) => {
    const row: Record<string, string | number> = { label: point.label };
    data.series.forEach((item, index) => {
      row[`s${index}`] = item.values[pointIndex] ?? 0;
    });
    return row;
  });
}

/** Konfigurasi `ChartContainer`: label dan warna per kunci `s<i>`. */
export function seriesConfig(data: SeriesData): ChartConfig {
  return Object.fromEntries(
    data.series.map((item, index) => [
      `s${index}`,
      { label: item.label, color: seriesColor(index) },
    ]),
  );
}

/** Baris tabel tersembunyi: periode lalu nilai tiap seri. */
export function seriesTable(data: SeriesData): (string | number)[][] {
  return data.points.map((point, pointIndex) => [
    point.label,
    ...data.series.map((item) => item.values[pointIndex] ?? 0),
  ]);
}
