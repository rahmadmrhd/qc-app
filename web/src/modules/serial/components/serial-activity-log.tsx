import type { SerialEventDto } from '@shared/contract';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { describeError } from '@/lib/api/describe-error';
import { requestFormTab } from '@/lib/form-tab-request';
import { EVENT_LABEL, formatStamp, legEventLabel, TEAM_LABEL } from '../lib/labels';
import { serialHistoryInfiniteQueryOptions } from '../queries';

/** Jumlah kejadian terbaru pada log ringkas panel kanan. */
export const SERIAL_ACTIVITY_LIMIT = 10;

function eventTitle(event: SerialEventDto): string {
  return event.type === 'send' || event.type === 'receive'
    ? legEventLabel(event.type, event.data.leg)
    : EVENT_LABEL[event.type];
}

/**
 * Log ringkas panel kanan View Serial: kejadian terbaru dari `serials.history` (sumber yang sama dengan tab Riwayat,
 * sehingga hak baca per BU sudah dijaga server dan data dipakai bersama lewat kunci query yang sama). Memotong halaman
 * pertama menjadi 10 kejadian; "Lihat riwayat lengkap" membuka tab Riwayat.
 */
export function SerialActivityLog({ serialId }: { serialId: string }) {
  const history = useInfiniteQuery(
    serialHistoryInfiniteQueryOptions({ id: serialId, group: 'all' }),
  );
  const events = (history.data?.pages[0]?.events ?? []).slice(0, SERIAL_ACTIVITY_LIMIT);
  return (
    <section aria-label="Aktivitas" className="space-y-2 border-t pt-4">
      <h2 className="text-sm font-semibold text-muted-foreground">Aktivitas</h2>
      {history.isPending ? (
        <p className="text-xs text-muted-foreground">Memuat aktivitas…</p>
      ) : history.isError && events.length === 0 ? (
        <div className="space-y-2">
          <p role="alert" className="text-xs text-destructive-text">
            {describeError(history.error)}
          </p>
          <Button
            type="button"
            variant="outline"
            color="primary"
            size="sm"
            onClick={() => void history.refetch()}
          >
            Coba lagi
          </Button>
        </div>
      ) : events.length === 0 ? (
        <p className="text-xs text-muted-foreground">Belum ada aktivitas tercatat.</p>
      ) : (
        <>
          <ol className="space-y-3">
            {events.map((event) => (
              <li key={event.id} className="space-y-0.5">
                <p className="font-medium break-words">{eventTitle(event)}</p>
                <p className="text-xs break-words text-muted-foreground">
                  {event.actorName} ({TEAM_LABEL[event.actorTeam]}) ·{' '}
                  {formatStamp(event.createdAt || event.occurredOn)}
                </p>
              </li>
            ))}
          </ol>
          <Button
            type="button"
            variant="outline"
            color="primary"
            size="sm"
            onClick={() => requestFormTab('riwayat')}
          >
            Lihat riwayat lengkap
          </Button>
        </>
      )}
    </section>
  );
}
