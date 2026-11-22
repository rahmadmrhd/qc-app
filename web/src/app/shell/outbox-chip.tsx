import { useQueryClient } from '@tanstack/react-query';
import { Clock, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useMe } from '@/modules/auth/use-me';
import { findCachedHandover } from '@/modules/handover/lib/board-cache';
import type { OutboxEntry } from '@/modules/handover/lib/outbox';
import { describeEntry } from '@/modules/handover/lib/outbox-labels';
import { useOutboxSummary } from '@/modules/handover/lib/use-outbox-summary';
import { formatClock } from '../server-status';

/** Daftar entri. Komponen terpisah: nomor task dibaca dari cache saat popover dibuka (bukan saat chip dirender). */
export function OutboxList({ entries }: { entries: readonly OutboxEntry[] }) {
  const queryClient = useQueryClient();
  return (
    <ul className="max-h-64 space-y-2 overflow-y-auto">
      {entries.map((entry) => {
        const { kind, target } = describeEntry(entry);
        // Task baru belum bernomor; centang dan komentar menyebut nomor task dari cache (atau "Task lain").
        const number =
          'taskId' in entry
            ? (findCachedHandover(queryClient, entry.taskId)?.number ?? 'Task lain')
            : null;
        return (
          <li key={entry.id} className="text-xs">
            <div className="text-muted-foreground">
              {kind}
              {number ? ` · ${number}` : ''} · {formatClock(entry.at)}
            </div>
            <div className="line-clamp-1">{target}</div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Chip di header: jumlah perubahan (centang, komentar, task baru) yang belum terkirim ke server, dengan daftar singkat saat diklik. Tak
 * tampil bila antrean kosong. Di layar sempit hanya ikon + angka; label lengkap tetap ada untuk pembaca layar.
 */
export function OutboxChip() {
  const owner = useMe().email;
  const { entries, sending } = useOutboxSummary(owner);
  const total = entries.length;
  if (total === 0) return null;

  const label = sending > 0 ? `Mengirim ${sending} dari ${total}…` : `${total} belum terkirim`;
  const Icon = sending > 0 ? LoaderCircle : Clock;

  return (
    <div role="status" aria-live="polite">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            color="primary"
            size="sm"
            className="gap-1.5 px-2"
            aria-label={label}
          >
            <Icon aria-hidden="true" className={sending > 0 ? 'size-4 animate-spin' : 'size-4'} />
            <span className="sm:hidden">
              <span aria-hidden="true">{total}</span>
              <span className="sr-only">{label}</span>
            </span>
            <span className="hidden sm:inline">{label}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
          <p className="text-sm font-medium">{label}</p>
          <OutboxList entries={entries} />
        </PopoverContent>
      </Popover>
    </div>
  );
}
