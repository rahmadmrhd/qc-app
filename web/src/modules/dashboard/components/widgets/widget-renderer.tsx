import type { PartsData, SeriesData, WidgetData, WidgetMeta } from '@shared/dashboard';
import type { PublicWidgetData } from '@shared/dashboard-public';
import type { WidgetLinks } from '../../lib/links';
import { LazyCharts } from '../charts/chart-lazy';
import { ListWidget } from './list-widget';
import { NumberWidget } from './number-widget';

/** Irisan sebagai satu seri kolom (visual `bar` dari data irisan). */
function partsToSeries(data: PartsData, label: string): SeriesData {
  return {
    kind: 'series',
    bucket: 'day',
    points: data.slices.map((slice) => ({ key: slice.key, label: slice.label })),
    series: [{ key: 'value', label, values: data.slices.map((slice) => slice.value) }],
  };
}

function Unsupported() {
  return (
    <p className="py-6 text-center text-sm text-muted-foreground">Data tidak dapat ditampilkan</p>
  );
}

/** Memilih komponen menurut `meta.visual`; bentuk data yang tak cocok = pesan netral, bukan galat. */
export function WidgetRenderer({
  meta,
  data,
  links,
}: {
  meta: WidgetMeta;
  data: WidgetData | PublicWidgetData;
  links?: WidgetLinks;
}) {
  switch (meta.visual) {
    case 'number':
      return data.kind === 'number' ? (
        <NumberWidget data={data} delta={meta.delta} deltaGood={meta.deltaGood} />
      ) : (
        <Unsupported />
      );
    case 'list':
      return data.kind === 'list' ? (
        <ListWidget data={data} label={meta.title} {...(links ? { links } : {})} />
      ) : (
        <Unsupported />
      );
    case 'donut':
    case 'pie':
      return data.kind === 'parts' ? (
        <LazyCharts.DonutChart data={data} pie={meta.visual === 'pie'} label={meta.title} />
      ) : (
        <Unsupported />
      );
    case 'barH':
      return data.kind === 'parts' ? (
        <LazyCharts.BarListChart data={data} label={meta.title} />
      ) : (
        <Unsupported />
      );
    case 'barScroll':
      return data.kind === 'parts' ? (
        <LazyCharts.ScrollBarChart data={data} label={meta.title} />
      ) : (
        <Unsupported />
      );
    case 'bar':
      if (data.kind === 'parts') {
        return <LazyCharts.ColumnChart data={partsToSeries(data, meta.title)} label={meta.title} />;
      }
      return data.kind === 'series' ? (
        <LazyCharts.ColumnChart data={data} label={meta.title} />
      ) : (
        <Unsupported />
      );
    case 'barGroup':
      return data.kind === 'series' ? (
        <LazyCharts.ColumnChart data={data} label={meta.title} />
      ) : (
        <Unsupported />
      );
    case 'line':
      return data.kind === 'series' ? (
        <LazyCharts.LineChart data={data} label={meta.title} />
      ) : (
        <Unsupported />
      );
  }
}
