import { type ComponentType, type JSX, lazy, Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

type Bundle = typeof import('./chart-bundle');

function ChartFallback() {
  return <Skeleton aria-hidden="true" className="h-[220px] w-full" />;
}

/** Bungkus komponen grafik yang dimuat malas dari satu potongan bersama, dengan kerangka sementara. */
function lazyChart<P extends object>(pick: (bundle: Bundle) => ComponentType<P>): ComponentType<P> {
  const Inner = lazy(async () => ({ default: pick(await import('./chart-bundle')) }));
  function LazyChart(props: P) {
    return (
      <Suspense fallback={<ChartFallback />}>
        <Inner {...(props as P & JSX.IntrinsicAttributes)} />
      </Suspense>
    );
  }
  return LazyChart;
}

/** Komponen grafik yang dimuat malas (recharts tidak masuk potongan utama). */
export const LazyCharts = {
  DonutChart: lazyChart((bundle) => bundle.DonutChart),
  ColumnChart: lazyChart((bundle) => bundle.ColumnChart),
  LineChart: lazyChart((bundle) => bundle.LineChart),
  BarListChart: lazyChart((bundle) => bundle.BarListChart),
  ScrollBarChart: lazyChart((bundle) => bundle.ScrollBarChart),
};
