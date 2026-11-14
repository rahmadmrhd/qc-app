import { Clock, LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PendingCreateView {
  key: string;
  customerName: string;
  note: string;
  status: 'waiting' | 'sending';
}

/**
 * Kartu sementara untuk task baru yang masih di antrean perangkat: nomor belum ada ("—"), tidak dapat dibuka (belum ada
 * di server), berlabel status. Diganti kartu asli begitu server menjawab.
 */
export function PendingCreateCard({ task }: { task: PendingCreateView }) {
  const sending = task.status === 'sending';
  return (
    <div
      aria-disabled="true"
      data-pending-create=""
      className={cn('space-y-1 rounded-lg border border-dashed bg-card p-3 text-sm opacity-90')}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">—</span>
        <span className="flex items-center gap-1 text-xs italic text-muted-foreground">
          {sending ? (
            <>
              <LoaderCircle aria-hidden="true" className="size-3 animate-spin" />
              Mengirim…
            </>
          ) : (
            <>
              <Clock aria-hidden="true" className="size-3" />
              Belum terkirim
            </>
          )}
        </span>
      </div>
      <p className="break-words font-medium">{task.customerName}</p>
      <p className="line-clamp-3 whitespace-pre-wrap break-words text-xs text-muted-foreground">
        {task.note}
      </p>
    </div>
  );
}
