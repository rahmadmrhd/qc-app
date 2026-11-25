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

const ROW_HEIGHT = 32;
const LABEL_MAX = 18;

const truncate = (text: string): string =>
  text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1)}…` : text;

/** Batang horizontal per kategori (satu seri, satu warna); nilai negatif tetap digambar ke kiri. */
export function BarListChart({ data, label }: { data: PartsData; label: string }) {
  if (data.slices.length === 0) return <EmptyChart />;
  const config: ChartConfig = { value: { label, color: seriesColor(0) } };
  return (
    <ChartFrame
      label={label}
      head={['Kategori', 'Jumlah']}
      rows={data.slices.map((slice) => [slice.label, slice.value])}
    >
      <ChartContainer
        config={config}
        className="aspect-auto w-full"
        style={{ height: Math.max(120, data.slices.length * ROW_HEIGHT + 32) }}
      >
        <BarChart data={data.slices} layout="vertical" margin={{ left: 0, right: 16, top: 4 }}>
          <CartesianGrid horizontal={false} stroke="var(--border)" />
          <XAxis
            type="number"
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tick={AXIS_TICK}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={120}
            tickLine={false}
            axisLine={false}
            tick={AXIS_TICK}
            tickFormatter={truncate}
          />
          <ChartTooltip content={<ChartTooltipContent hideLabel />} />
          <Bar dataKey="value" fill="var(--color-value)" radius={4} isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
    </ChartFrame>
  );
}
