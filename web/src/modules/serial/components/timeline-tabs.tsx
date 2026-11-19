import type { SerialDto } from '@shared/contract';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { BusyLabel } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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

/** Nilai tab: kelompok (`all`/`checks`/`changes`) atau `case:<id>`. */
const CASE_PREFIX = 'case:';

export interface TimelineTabsProps {
  serial: SerialDto;
  /** Tab laporan yang terbuka lebih dulu; id yang bukan laporan serial ini diabaikan. */
  initialCaseId?: string;
}

/**
 * Linimasa bertab: Semua, satu tab per laporan (LP/<BU>/YYMM-iiii), Pengecekan, Perubahan data. Tiap tab memuat `serials.history`
 * berkursor (server mengirim terbaru dulu) dengan tombol "Muat yang lebih lama" di dalam kelompok riwayat sebelumnya; jumlah di tab dari `counts` server.
 */
export function TimelineTabs({ serial, initialCaseId }: TimelineTabsProps) {
  const [tab, setTab] = useState<string>(() =>
    initialCaseId && serial.cases.some((entry) => entry.id === initialCaseId)
      ? `${CASE_PREFIX}${initialCaseId}`
      : 'all',
  );
  const caseId = tab.startsWith(CASE_PREFIX) ? tab.slice(CASE_PREFIX.length) : undefined;
  const group = caseId ? 'all' : (tab as 'all' | 'checks' | 'changes');
  const history = useInfiniteQuery({
    ...serialHistoryInfiniteQueryOptions({ id: serial.id, group, ...(caseId ? { caseId } : {}) }),
    // Selama ada foto bukti yang menunggu cap, riwayat disegarkan berkala agar statusnya (selesai/gagal) terlihat.
    refetchInterval: (query) =>
      pagesHavePendingProof(query.state.data?.pages ?? []) ? PROOF_POLL_MS : false,
  });
  // Jumlah tab tetap terlihat saat berpindah tab (halaman pertama tab baru belum tiba).
  const counts = useRef<Counts | null>(null);
  const latest = history.data?.pages[0]?.counts;
  if (latest) counts.current = latest;
  const count = (value: number | undefined) => (value === undefined ? '' : ` (${value})`);
  const events = history.data?.pages.flatMap((page) => page.events) ?? [];

  // Tab aktif (mis. tab laporan yang dibuka dari tautan) digeser ke area terlihat; hanya menggeser baris tab itu sendiri,
  // bukan halaman (beda dengan scrollIntoView).
  const listRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: dijalankan ulang tiap `tab` berganti
  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>('[data-state="active"]');
    if (!list || !active) return;
    const listBox = list.getBoundingClientRect();
    const box = active.getBoundingClientRect();
    if (box.left < listBox.left) list.scrollLeft += box.left - listBox.left - 8;
    else if (box.right > listBox.right) list.scrollLeft += box.right - listBox.right + 8;
  }, [tab]);

  return (
    <Tabs value={tab} onValueChange={setTab} className="min-w-0">
      {/* Baris tab tidak dibungkus: banyak tab laporan membuatnya bisa digeser mendatar di dalam pembungkusnya. */}
      <TabsList
        ref={listRef}
        className="h-auto w-full justify-start gap-1 overflow-x-auto overflow-y-hidden"
        data-tour="serial-timeline"
      >
        <TabsTrigger value="all" className="flex-none">
          {`${HISTORY_GROUP_LABEL.all}${count(counts.current?.all)}`}
        </TabsTrigger>
        {serial.cases.map((entry) => (
          <TabsTrigger key={entry.id} value={`${CASE_PREFIX}${entry.id}`} className="flex-none">
            {`${entry.number}${count(counts.current ? (counts.current.byCase[entry.id] ?? 0) : undefined)}`}
          </TabsTrigger>
        ))}
        <TabsTrigger value="checks" className="flex-none">
          {`${HISTORY_GROUP_LABEL.checks}${count(counts.current?.checks)}`}
        </TabsTrigger>
        <TabsTrigger value="changes" className="flex-none">
          {`${HISTORY_GROUP_LABEL.changes}${count(counts.current?.changes)}`}
        </TabsTrigger>
      </TabsList>
      <TabsContent value={tab} className="space-y-3">
        {history.isPending ? (
          <p className="text-sm text-muted-foreground">Memuat…</p>
        ) : history.isError ? (
          <p role="alert" className="text-sm text-destructive-text">
            {describeError(history.error)}
          </p>
        ) : (
          <Timeline
            key={tab}
            events={events}
            markLatest={tab === 'all'}
            loadOlder={
              history.hasNextPage ? (
                <Button
                  type="button"
                  variant="outline"
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
      </TabsContent>
    </Tabs>
  );
}
