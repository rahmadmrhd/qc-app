import type { SerialDto } from '@shared/contract';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { BusyLabel } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { describeError } from '@/lib/api/describe-error';
import { HISTORY_GROUP_LABEL } from '../lib/labels';
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
}

/**
 * Linimasa bertab: Semua, satu tab per kasus (LP-…), Pengecekan, Perubahan data. Tiap tab memuat `serials.history`
 * berkursor (terbaru di atas) dengan tombol "Muat yang lebih lama"; jumlah di tab dari `counts` server.
 */
export function TimelineTabs({ serial }: TimelineTabsProps) {
  const [tab, setTab] = useState<string>('all');
  const caseId = tab.startsWith(CASE_PREFIX) ? tab.slice(CASE_PREFIX.length) : undefined;
  const group = caseId ? 'all' : (tab as 'all' | 'checks' | 'changes');
  const history = useInfiniteQuery(
    serialHistoryInfiniteQueryOptions({ id: serial.id, group, ...(caseId ? { caseId } : {}) }),
  );
  // Jumlah tab tetap terlihat saat berpindah tab (halaman pertama tab baru belum tiba).
  const counts = useRef<Counts | null>(null);
  const latest = history.data?.pages[0]?.counts;
  if (latest) counts.current = latest;
  const count = (value: number | undefined) => (value === undefined ? '' : ` (${value})`);
  const events = history.data?.pages.flatMap((page) => page.events) ?? [];

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="h-auto w-full flex-wrap justify-start gap-1">
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
          <p role="alert" className="text-sm text-destructive">
            {describeError(history.error)}
          </p>
        ) : (
          <>
            <Timeline events={events} />
            {history.hasNextPage ? (
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
            ) : null}
          </>
        )}
      </TabsContent>
    </Tabs>
  );
}
