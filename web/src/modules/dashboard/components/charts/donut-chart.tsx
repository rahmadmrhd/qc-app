import type { PartsData } from '@shared/dashboard';
import { Cell, Pie, PieChart } from 'recharts';
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { limitSlices, sliceColor } from '../../lib/colors';
import { ChartFrame, EmptyChart } from './chart-frame';

/** Donat (atau pai bila `pie`) dari irisan; lebih dari enam irisan digabung "Lainnya". Nilai <= 0 tak digambar. */
export function DonutChart({
  data,
  pie = false,
  label,
}: {
  data: PartsData;
  pie?: boolean;
  label: string;
}) {
  const slices = limitSlices(data.slices.filter((slice) => slice.value > 0));
  if (slices.length === 0) return <EmptyChart />;
  const config: ChartConfig = Object.fromEntries(
    slices.map((slice, index) => [
      slice.key,
      { label: slice.label, color: sliceColor(slice.key, index) },
    ]),
  );
  return (
    <ChartFrame
      label={label}
      head={['Kategori', 'Jumlah']}
      rows={slices.map((slice) => [slice.label, slice.value])}
      legend={slices.map((slice, index) => ({
        key: slice.key,
        label: slice.label,
        value: slice.value,
        color: sliceColor(slice.key, index),
      }))}
    >
      <ChartContainer config={config} className="aspect-auto h-[220px] w-full">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent hideLabel nameKey="key" />} />
          <Pie
            data={slices}
            dataKey="value"
            nameKey="key"
            innerRadius={pie ? 0 : 55}
            outerRadius={90}
            stroke="var(--card)"
            strokeWidth={2}
            isAnimationActive={false}
          >
            {slices.map((slice, index) => (
              <Cell key={slice.key} fill={sliceColor(slice.key, index)} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
    </ChartFrame>
  );
}
