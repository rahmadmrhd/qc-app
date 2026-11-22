import type { SerialDto } from '@shared/contract';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { useRef, useState } from 'react';
import { BusyLabel } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { describeError } from '@/lib/api/describe-error';
import { HISTORY_GROUP_LABEL } from '../lib/labels';
import { PROOF_POLL_MS, pagesHavePendingProof } from '../lib/proof-state';
import { serialHistoryInfiniteQueryOptions } from '../queries';
import { Timeline } from './timeline';

interface Counts {
  all: number;
  checks: number;
  changes: number;
  byCase: Record<string, number>;
}

export interface TimelineSectionProps {
  serial: SerialDto;
}

/** Kelompok kejadian pada linimasa (`serials.history` `group`). */
type HistoryGroup = keyof typeof HISTORY_GROUP_LABEL;

const GROUPS = Object.keys(HISTORY_GROUP_LABEL) as HistoryGroup[];

/**
 * Linimasa Riwayat dengan satu tombol filter (ghost + chevron) yang membuka menu pilihan: Semua Riwayat, Riwayat
 * Pengecekan, Riwayat Perubahan Data. Label tombol mengikuti pilihan aktif dan jumlah per pilihan (`counts` server, selalu
 * utuh) ada di butir menu. Pilihan bersifat lokal (bukan search param). Tiap pilihan memuat `serials.history` berkursor
 * (server mengirim terbaru dulu) dengan tombol "Muat yang lebih lama". Hanya di pilihan Semua, kejadian milik satu
 * laporan diringkas menjadi SATU kartu laporan yang membuka halaman detail laporan (`/serial/reports/$caseId`);
 * Pengecekan dan Perubahan Data menampilkan tiap kejadian apa adanya (penyaring jenis kejadian, bukan ringkasan).
 */
export function TimelineSection({ serial }: TimelineSectionProps) {
  const [group, setGroup] = useState<HistoryGroup>('all');
  const history = useInfiniteQuery({
    ...serialHistoryInfiniteQueryOptions({ id: serial.id, group }),
    // Selama ada foto bukti yang menunggu cap, riwayat disegarkan berkala agar statusnya (selesai/gagal) terlihat.
    refetchInterval: (query) =>
      pagesHavePendingProof(query.state.data?.pages ?? []) ? PROOF_POLL_MS : false,
  });
  // Jumlah di menu tetap terlihat saat berpindah pilihan (halaman pertama pilihan baru belum tiba).
  const counts = useRef<Counts | null>(null);
  const latest = history.data?.pages[0]?.counts;
  if (latest) counts.current = latest;
  const count = (key: HistoryGroup) => counts.current?.[key];
  const events = history.data?.pages.flatMap((page) => page.events) ?? [];

  return (
    <div className="min-w-0 space-y-3">
      <div data-tour="serial-timeline" className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              color="primary"
              className="text-base font-semibold"
              aria-label={`Filter riwayat: ${HISTORY_GROUP_LABEL[group]}`}
            >
              {HISTORY_GROUP_LABEL[group]}
              <ChevronDown aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={group}
              onValueChange={(next) => setGroup(next as HistoryGroup)}
            >
              {GROUPS.map((key) => (
                <DropdownMenuRadioItem key={key} value={key}>
                  {HISTORY_GROUP_LABEL[key]}
                  {count(key) === undefined ? null : (
                    <span className="ml-auto pl-4 text-xs tabular-nums text-muted-foreground">
                      {count(key)}
                    </span>
                  )}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="space-y-3">
        {history.isPending ? (
          <p className="text-sm text-muted-foreground">Memuat…</p>
        ) : history.isError ? (
          <p role="alert" className="text-sm text-destructive-text">
            {describeError(history.error)}
          </p>
        ) : (
          <Timeline
            key={group}
            events={events}
            markLatest={group === 'all'}
            {...(group === 'all'
              ? {
                  caseGroups: {
                    cases: serial.cases,
                    serialStatus: serial.status,
                    counts: counts.current?.byCase,
                  },
                }
              : {})}
            loadOlder={
              history.hasNextPage ? (
                <Button
                  type="button"
                  variant="outline"
                  color="primary"
                  disabled={history.isFetchingNextPage}
                  onClick={() => void history.fetchNextPage()}
                >
                  {history.isFetchingNextPage ? (
                    <BusyLabel>Memuat…</BusyLabel>
                  ) : (
                    'Muat yang lebih lama'
                  )}
                </Button>
              ) : undefined
            }
          />
        )}
      </div>
    </div>
  );
}
