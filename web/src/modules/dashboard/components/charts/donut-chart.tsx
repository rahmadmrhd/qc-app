import type { PartsData } from '@shared/dashboard';
import { Cell, Pie, PieChart } from 'recharts';
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { limitSlices, sliceColor } from '../../lib/colors';
import { formatNumber } from '../../lib/format';
import { ChartFrame, EmptyChart } from './chart-frame';

/** Lubang donat terhadap jari-jari luar; angka total di tengah mengikuti lubang itu. */
const INNER_RATIO = '62%';
const OUTER_RATIO = '96%';

/**
 * Ukuran huruf angka total memakai satuan kontainer (`cqw`, 1% lebar kontainer donat) sehingga menyesuaikan lebar kolom
 * tanpa pengukuran JS: tinggi <= ~30% lebar (lubang donat ~60% lebar) dan lebar teks (perkiraan 0,6 x ukuran per
 * karakter) <= ~50% lebar, dijepit 14-48 px. Angka lebih panjang otomatis lebih kecil.
 */
export function centerFontSize(characters: number): string {
  const byWidth = (50 / (Math.max(1, characters) * 0.6)).toFixed(1);
  return `clamp(14px, min(30cqw, ${byWidth}cqw), 48px)`;
}

/** Angka total dan keterangan "Total" di pusat donat (hiasan: nilainya sudah ada di tabel `sr-only` dan legenda). */
function CenterTotal({ total }: { total: number }) {
  const text = formatNumber(total);
  return (
    <div
      data-slot="donut-total"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center leading-none"
    >
      <span
        className="font-semibold tabular-nums"
        style={{ fontSize: centerFontSize(text.length) }}
      >
        {text}
      </span>
      <span className="mt-1 text-xs text-muted-foreground">Total</span>
    </div>
  );
}

/**
 * Donat (atau pai bila `pie`) dari irisan; lebih banyak dari delapan irisan digabung "Lainnya". Nilai <= 0 tak
 * digambar. Donat menampilkan TOTAL seluruh irisan di tengah (keputusan pemilik 2026-11-25) dan menyesuaikan ukuran
 * dengan lebar kolom.
 */
export function DonutChart({
  data,
  pie = false,
  label,
}: {
  data: PartsData;
  pie?: boolean;
  label: string;
}) {
  const positive = data.slices.filter((slice) => slice.value > 0);
  const slices = limitSlices(positive);
  if (slices.length === 0) return <EmptyChart />;
  const total = positive.reduce((sum, slice) => sum + slice.value, 0);
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
      rows={[...slices.map((slice) => [slice.label, slice.value]), ['Total', total]]}
      legend={slices.map((slice, index) => ({
        key: slice.key,
        label: slice.label,
        value: slice.value,
        color: sliceColor(slice.key, index),
      }))}
    >
      <div className="@container relative mx-auto w-full max-w-[280px]">
        <ChartContainer config={config} className="aspect-square w-full">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent hideLabel nameKey="key" />} />
            <Pie
              data={slices}
              dataKey="value"
              nameKey="key"
              innerRadius={pie ? 0 : INNER_RATIO}
              outerRadius={OUTER_RATIO}
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
        {pie ? null : <CenterTotal total={total} />}
      </div>
    </ChartFrame>
  );
}
