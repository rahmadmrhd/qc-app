import type { PartsData } from '@shared/dashboard';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { seriesColor } from '../../lib/colors';
import { AXIS_TICK, ChartFrame, EmptyChart } from './chart-frame';

/** Lebar minimal tiap batang; bila total melebihi lebar kartu, grafik digulir ke samping (keputusan pemilik 2026-11-25). */
const COLUMN_WIDTH = 56;
const LABEL_MAX = 12;
const CHART_HEIGHT = 280;

const truncate = (text: string): string =>
  text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1)}…` : text;

/** Kolom per kategori dengan gulir horizontal di dalam grafik; urutan data dari server dipertahankan. */
export function ScrollBarChart({ data, label }: { data: PartsData; label: string }) {
  if (data.slices.length === 0) return <EmptyChart />;
  const config: ChartConfig = { value: { label, color: seriesColor(0) } };
  return (
    <ChartFrame
      label={label}
      head={['Kategori', 'Jumlah']}
      rows={data.slices.map((slice) => [slice.label, slice.value])}
    >
      <section
        data-slot="chart-scroller"
        aria-label={`${label} (dapat digulir)`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: wilayah gulir harus dapat difokus keyboard (axe: scrollable-region-focusable)
        tabIndex={0}
        className="w-full overflow-x-auto"
      >
        <ChartContainer
          config={config}
          className="aspect-auto"
          style={{
            height: CHART_HEIGHT,
            minWidth: '100%',
            width: data.slices.length * COLUMN_WIDTH,
          }}
        >
          <BarChart data={data.slices} margin={{ left: 0, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="label"
              interval={0}
              height={56}
              angle={-35}
              textAnchor="end"
              tickLine={false}
              axisLine={false}
              tick={AXIS_TICK}
              tickFormatter={truncate}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              width={40}
              tick={AXIS_TICK}
            />
            <ChartTooltip content={<ChartTooltipContent hideLabel={false} />} />
            <Bar
              dataKey="value"
              fill="var(--color-value)"
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ChartContainer>
      </section>
    </ChartFrame>
  );
}
