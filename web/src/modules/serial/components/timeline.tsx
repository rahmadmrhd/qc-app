import type { SerialEventDto } from '@shared/contract';
import { Badge } from '@/components/ui/badge';
import { MarkdownView } from '@/modules/markdown/markdown-view';
import { EVENT_LABEL, FIELD_LABEL, formatDay, formatStamp, TEAM_LABEL } from '../lib/labels';

/** Ringkasan stiker pada kejadian `recorded`: nama dan jumlah dari `data.stickers` (tanpa angka stok). */
function recordedStickers(event: SerialEventDto): string[] {
  if (event.type !== 'recorded') return [];
  const list = event.data.stickers;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry): string[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { name, qty } = entry as { name?: unknown; qty?: unknown };
    return typeof name === 'string' && typeof qty === 'number' ? [`${name} ×${qty}`] : [];
  });
}

function recordedLocation(event: SerialEventDto): string {
  if (event.type !== 'recorded') return '';
  const name = event.data.locationName;
  return typeof name === 'string' ? name : '';
}

const show = (value: string | null) => (value === null || value === '' ? '—' : value);

function EventCard({ event }: { event: SerialEventDto }) {
  const stickers = recordedStickers(event);
  const location = recordedLocation(event);
  return (
    <li className="relative rounded-lg border bg-card p-4" data-seq={event.seq}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5">
          <p className="text-sm font-semibold">
            {EVENT_LABEL[event.type]}
            {location ? (
              <span className="font-normal text-muted-foreground"> di {location}</span>
            ) : null}
          </p>
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{event.actorName}</span>
            <Badge variant="outline">{TEAM_LABEL[event.actorTeam]}</Badge>
          </p>
        </div>
        <div className="text-right">
          <p className="text-base font-semibold tabular-nums">{formatDay(event.occurredOn)}</p>
          <p className="text-xs text-muted-foreground">dicatat {formatStamp(event.createdAt)}</p>
        </div>
      </div>
      {event.message.trim() !== '' ? (
        <MarkdownView source={event.message} className="mt-3 text-sm" />
      ) : null}
      {event.changes.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Perubahan">
          {event.changes.map((change) => (
            <li key={`${change.field}|${change.from}|${change.to}`}>
              <Badge variant="secondary" className="h-auto whitespace-normal py-0.5">
                {`${FIELD_LABEL[change.field] ?? change.field}: ${show(change.from)} → ${show(change.to)}`}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
      {stickers.length > 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Stiker ditempel dan stok dipotong: {stickers.join(', ')}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Linimasa kejadian serial: urutan dari server (TERBARU DI ATAS, seq menurun) dipakai apa adanya, tidak diurutkan ulang.
 * `truncated` = server hanya memuat 500 kejadian terbaru.
 */
export function Timeline({
  events,
  truncated = false,
}: {
  events: readonly SerialEventDto[];
  truncated?: boolean;
}) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">Belum ada kejadian.</p>;
  }
  return (
    <div className="space-y-3">
      {truncated ? (
        <p role="note" className="text-xs text-muted-foreground">
          Hanya 500 kejadian terbaru yang dimuat; kejadian yang lebih lama tidak ditampilkan.
        </p>
      ) : null}
      <ol aria-label="Linimasa" className="space-y-3">
        {events.map((event) => (
          <EventCard key={event.id} event={event} />
        ))}
      </ol>
    </div>
  );
}
