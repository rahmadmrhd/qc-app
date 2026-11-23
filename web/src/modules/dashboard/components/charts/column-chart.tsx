import type { SeriesData } from '@shared/dashboard';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { seriesColor } from '../../lib/colors';
import { AXIS_TICK, ChartFrame, EmptyChart } from './chart-frame';
import { hasSeriesData, seriesConfig, seriesRows, seriesTable } from './series-data';

/** Grafik kolom per bucket; dua seri atau lebih = kolom berkelompok. */
export function ColumnChart({ data, label }: { data: SeriesData; label: string }) {
  if (!hasSeriesData(data)) return <EmptyChart />;
  return (
    <ChartFrame
      label={label}
      head={['Periode', ...data.series.map((item) => item.label)]}
      rows={seriesTable(data)}
      legend={data.series.map((item, index) => ({
        key: item.key,
        label: item.label,
        color: seriesColor(index),
      }))}
    >
      <ChartContainer config={seriesConfig(data)} className="aspect-auto h-[240px] w-full">
        <BarChart data={seriesRows(data)} margin={{ left: 0, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={AXIS_TICK}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            width={36}
            tick={AXIS_TICK}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          {data.series.map((item, index) => (
            <Bar
              key={item.key}
              dataKey={`s${index}`}
              fill={seriesColor(index)}
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ChartContainer>
    </ChartFrame>
  );
}
