import type { WidgetId, WidgetMeta, WidgetResult } from '@shared/dashboard';
import type { PublicWidgetData } from '@shared/dashboard-public';
import { LinkCell } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { WidgetLinks } from '../../lib/links';
import { WidgetRenderer } from './widget-renderer';

/** Hasil widget di halaman publik (data tanpa `total` dan tanpa delta). */
export type PublicWidgetResult =
  | { id: WidgetId; status: 'ok'; data: PublicWidgetData }
  | { id: WidgetId; status: 'error'; message: string };

export interface WidgetFilterState {
  /** Filter BU global sedang dipakai. */
  bu: boolean;
  /** Filter Lokasi global sedang dipakai. */
  location: boolean;
  date: boolean;
}

/** Penanda keterlibatan filter global pada widget ini (teks, bukan warna saja). */
function filterNotes(meta: WidgetMeta, state: WidgetFilterState): string[] {
  const notes: string[] = [];
  if (!meta.bu && state.bu) notes.push('BU tidak berlaku');
  // Serial dan Laporan memakai BU SAAT INI (bukan riwayat BU seperti daftar Serial); angkanya dapat lebih kecil.
  if (meta.bu && state.bu) notes.push('BU saat ini');
  if (meta.location === 'none' && state.location) notes.push('Lokasi tidak berlaku');
  if (meta.location === 'stock') notes.push('per lokasi');
  if (meta.date.kind === 'none') notes.push('Kondisi saat ini');
  return notes;
}

/** Kartu satu widget: judul, penanda filter, lalu skeleton, galat + "Coba lagi", atau isi. */
export function WidgetCard({
  meta,
  result,
  loading,
  filterState,
  links,
  onRetry,
}: {
  meta: WidgetMeta;
  result: WidgetResult | PublicWidgetResult | undefined;
  loading: boolean;
  filterState: WidgetFilterState;
  /** Tautan widget daftar (hanya di aplikasi, bagi yang berhak): judul ke halaman indeks, baris ke detailnya. */
  links?: WidgetLinks;
  onRetry: () => void;
}) {
  const notes = filterNotes(meta, filterState);
  return (
    <Card data-widget={meta.id} className="h-full min-w-0">
      <div className="flex flex-col gap-1.5 px-(--card-spacing)">
        <h3 className="text-sm font-medium">
          {links?.index ? (
            <LinkCell to={links.index.to} params={links.index.params} search={links.index.search}>
              {meta.title}
            </LinkCell>
          ) : (
            meta.title
          )}
        </h3>
        {notes.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {notes.map((note) => (
              <Badge key={note} variant="soft" color="secondary">
                {note}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
      <div className="min-w-0 px-(--card-spacing)">
        {loading || result === undefined ? (
          <Skeleton aria-hidden="true" className="h-20 w-full" />
        ) : result.status === 'error' ? (
          <div role="alert" className="flex flex-col items-start gap-2 text-sm">
            <p className="text-destructive-text">{result.message}</p>
            <Button type="button" variant="outline" color="primary" size="sm" onClick={onRetry}>
              Coba lagi
            </Button>
          </div>
        ) : (
          <WidgetRenderer meta={meta} data={result.data} {...(links ? { links } : {})} />
        )}
      </div>
    </Card>
  );
}
