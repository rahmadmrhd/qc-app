import type { ActivityEntryDto } from '@shared/contract';
import { useInfiniteQuery } from '@tanstack/react-query';
import { BusyLabel } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import { describeError } from '@/lib/api/describe-error';
import { formatStamp } from '@/lib/format-stamp';
import { auditActionLabel, auditFieldLabel } from '@/modules/access/lib/audit-actions';
import { type ActivityTarget, activityQueryOptions } from '../queries';

/** Tanggal penulisan audit per record dimulai (migrasi 0028); sebelum itu entri tak punya penunjuk record. */
export const ACTIVITY_TRACKED_SINCE = '2026-11-20';

/**
 * Catatan "riwayat lama tidak lengkap" tampil di ujung daftar kecuali record dibuat SETELAH penulisan audit per record
 * dimulai (`createdAt` >= 20 Nov 2026 WIB: seluruh riwayatnya pasti tercatat). Tanpa `createdAt` (banyak DTO tak
 * memuatnya), catatan selalu tampil.
 */
export function showsIncompleteNote(createdAt: string | null | undefined): boolean {
  if (!createdAt) return true;
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return true;
  return created.getTime() < new Date(`${ACTIVITY_TRACKED_SINCE}T00:00:00+07:00`).getTime();
}

function ActivityItem({ entry }: { entry: ActivityEntryDto }) {
  const fields = entry.changedFields ?? [];
  return (
    <li className="space-y-0.5">
      <p className="font-medium break-words">{auditActionLabel(entry.action)}</p>
      <p className="text-xs break-words text-muted-foreground">
        {entry.actor ? `${entry.actor} · ` : ''}
        {formatStamp(entry.ts)}
      </p>
      {fields.length > 0 ? (
        <p className="text-xs break-words text-muted-foreground">
          Yang berubah: {fields.map(auditFieldLabel).join(', ')}
        </p>
      ) : null}
    </li>
  );
}

export interface ActivityLogProps extends ActivityTarget {
  /** Waktu record dibuat bila DTO-nya memuatnya; menentukan catatan riwayat lama (lihat `showsIncompleteNote`). */
  createdAt?: string | null | undefined;
}

/**
 * Log aktivitas satu record di panel kanan View (di bawah "Dibuat/Diubah oleh"): aksi berlabel, pelaku, waktu, dan NAMA
 * field yang berubah (nilai tak pernah ditampilkan). 10 entri per halaman lewat `activity.list`. Dipasang hanya di View
 * (halaman), bukan di dialog atau mode pustaka; log record terhapus tetap tampil.
 */
export function ActivityLog({ kind, id, createdAt }: ActivityLogProps) {
  const log = useInfiniteQuery(activityQueryOptions({ kind, id }));
  const entries = log.data?.pages.flatMap((page) => page.entries) ?? [];
  return (
    <section aria-label="Aktivitas" className="space-y-2 border-t pt-4">
      <h2 className="text-sm font-semibold text-muted-foreground">Aktivitas</h2>
      {log.isPending ? (
        <p className="text-xs text-muted-foreground">Memuat aktivitas…</p>
      ) : log.isError && entries.length === 0 ? (
        <div className="space-y-2">
          <p role="alert" className="text-xs text-destructive-text">
            {describeError(log.error)}
          </p>
          <Button
            type="button"
            variant="outline"
            color="primary"
            size="sm"
            onClick={() => void log.refetch()}
          >
            Coba lagi
          </Button>
        </div>
      ) : (
        <>
          {entries.length === 0 ? (
            <p className="text-xs text-muted-foreground">Belum ada aktivitas tercatat.</p>
          ) : (
            <ol className="space-y-3">
              {entries.map((entry) => (
                <ActivityItem key={entry.id} entry={entry} />
              ))}
            </ol>
          )}
          {log.hasNextPage ? (
            <div className="space-y-1">
              {log.isFetchNextPageError ? (
                <p role="alert" className="text-xs text-destructive-text">
                  {describeError(log.error)}
                </p>
              ) : null}
              <Button
                type="button"
                variant="outline"
                color="primary"
                size="sm"
                disabled={log.isFetchingNextPage}
                onClick={() => void log.fetchNextPage()}
              >
                {log.isFetchingNextPage ? (
                  <BusyLabel>Memuat…</BusyLabel>
                ) : log.isFetchNextPageError ? (
                  'Coba lagi'
                ) : (
                  'Muat lebih banyak'
                )}
              </Button>
            </div>
          ) : showsIncompleteNote(createdAt) ? (
            <p className="text-xs text-muted-foreground">
              Riwayat sebelum 20 Nov 2026 tidak lengkap.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
