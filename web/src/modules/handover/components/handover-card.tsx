import type { HandoverDto } from '@shared/contract';
import { MoreHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { handoverActions } from '../lib/actions';
import { useNearViewport } from '../lib/near-viewport';
import { HANDOVER_STATUS_LABELS, HANDOVER_STATUS_STYLES } from '../lib/status';
import { useOutboxOverlay } from '../lib/use-pending-checks';
import { CancelDialog } from './cancel-dialog';
import { NoteView } from './note-view';

export interface HandoverCardProps {
  handover: HandoverDto;
  /** Pemilik antrean centang di perangkat (email akun); kosong = tanpa penempelan centang tertunda. */
  owner?: string;
  /** QC: `qc: edit` di lokasi task (centang dan Mark done). */
  canMarkDone: boolean;
  /** WH: `handover: edit` di lokasi task. */
  canEdit: boolean;
  /** WH: `handover: manage` di lokasi task (Batalkan dan Buka kembali task Dibatalkan). */
  canCancel: boolean;
  /** Ada mutasi yang berjalan untuk task INI saja. */
  pending: boolean;
  /** Ada centang task INI yang sedang disimpan ke server (tampilan sudah berubah; penanda halus). */
  saving?: boolean;
  locationName?: string;
  onOpen: () => void;
  onCheck: (item: { index: number; text: string }, checked: boolean) => void;
  onMarkDone: () => void;
  onReopen: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onComment: (input: {
    quote: string;
    before: string;
    after: string;
    body: string;
  }) => Promise<void> | void;
}

/**
 * Isi berat kartu (catatan Markdown, centang, komentar) dirender baru saat kartu mendekati viewport/kolom
 * bergulir; sebelum itu placeholder dengan tinggi perkiraan tetap agar daftar tidak melompat. Sekali
 * dirender tetap dirender.
 */
function LazyNote({ handover, children }: { handover: HandoverDto; children: ReactNode }) {
  const [ref, near] = useNearViewport();
  if (near) return <>{children}</>;
  const lines = handover.note.split(String.fromCharCode(10)).length;
  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-slot="note-placeholder"
      style={{ height: Math.min(480, Math.max(72, lines * 24)) }}
    />
  );
}

/**
 * Kartu task: SELURUH catatan tampil (tanpa dipotong) dengan centang langsung. Detail hanya dibuka lewat nomor task atau
 * opsi Ubah (badan kartu tidak bisa diklik, agar tidak salah klik saat mencentang atau memilih teks).
 */
export function HandoverCard({
  handover: serverHandover,
  owner = '',
  canMarkDone,
  canEdit,
  canCancel,
  pending,
  saving = false,
  locationName,
  onOpen,
  onCheck,
  onMarkDone,
  onReopen,
  onEdit,
  onCancel,
  onComment,
}: HandoverCardProps) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  // Centang yang menunggu terkirim tetap tampak tercentang walau refetch tiba lebih dulu dari pengiriman.
  const { dto: handover, pendingIndexes } = useOutboxOverlay(serverHandover, owner);
  const cancelled = handover.status === 'cancelled';
  const total = handover.checklist.length;
  const checked = handover.checklist.filter((item) => item.checked).length;
  // Aksi menurut status: Mark done (Baru/Dikerjakan), Buka kembali (hanya Dibatalkan), More (Ubah/Batalkan)
  // hanya bila ada aksi di dalamnya.
  const actions = handoverActions(handover.status, { canMarkDone, canEdit, canManage: canCancel });
  const styles = HANDOVER_STATUS_STYLES[handover.status];

  return (
    <>
      <article
        aria-label={`Task ${handover.number}`}
        className={cn(
          'space-y-3 rounded-lg border border-l-4 bg-card p-3 text-card-foreground shadow-xs',
          styles.accent,
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <button
              type="button"
              className="text-left text-sm font-semibold underline-offset-2 hover:underline"
              onClick={onOpen}
            >
              {handover.number}
            </button>
            <p className="break-words text-sm">
              {handover.customerName === '' ? (
                <span className="text-muted-foreground">Tanpa customer</span>
              ) : (
                handover.customerName
              )}
            </p>
            {locationName ? <p className="text-xs text-muted-foreground">{locationName}</p> : null}
          </div>
          <Badge variant="outline" className={styles.badge}>
            {HANDOVER_STATUS_LABELS[handover.status]}
          </Badge>
        </div>

        <LazyNote handover={handover}>
          <NoteView
            note={handover.note}
            checklist={handover.checklist}
            comments={handover.comments}
            canCheck={canMarkDone && !cancelled && !pending}
            canComment={!cancelled}
            compact
            pendingIndexes={pendingIndexes}
            onCheck={onCheck}
            onComment={onComment}
          />
        </LazyNote>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex gap-3">
            {total > 0 ? <span>{`${checked}/${total}`}</span> : null}
            {handover.comments.length > 0 ? (
              <span>{`${handover.comments.length} komentar`}</span>
            ) : null}
            {saving ? (
              <span role="status" className="italic">
                Menyimpan…
              </span>
            ) : null}
          </span>
          <span className="flex items-center gap-1">
            {actions.markDone ? (
              <Button
                type="button"
                size="sm"
                disabled={!actions.markDoneEnabled || pending}
                onClick={onMarkDone}
              >
                Mark done
              </Button>
            ) : null}
            {actions.reopen ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={onReopen}
              >
                Buka kembali
              </Button>
            ) : null}
            {actions.more ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" size="sm" variant="ghost" aria-label="More">
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {actions.edit ? (
                    <DropdownMenuItem onSelect={onEdit}>Ubah</DropdownMenuItem>
                  ) : null}
                  {actions.cancel ? (
                    <DropdownMenuItem variant="destructive" onSelect={() => setConfirmCancel(true)}>
                      Batalkan
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </span>
        </div>
      </article>
      <CancelDialog
        open={confirmCancel}
        number={handover.number}
        onOpenChange={setConfirmCancel}
        onConfirm={onCancel}
      />
    </>
  );
}
