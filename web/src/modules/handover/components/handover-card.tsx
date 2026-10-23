import type { HandoverDto } from '@shared/rpc';
import { MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { HANDOVER_STATUS_LABELS, handoverStatusVariant } from '../lib/status';
import { CancelDialog } from './cancel-dialog';
import { NoteView } from './note-view';

export interface HandoverCardProps {
  handover: HandoverDto;
  /** QC: `qc: edit` di lokasi task (centang dan Mark done). */
  canMarkDone: boolean;
  /** WH: `handover: edit` di lokasi task. */
  canEdit: boolean;
  /** WH: `handover: manage` di lokasi task. */
  canCancel: boolean;
  pending: boolean;
  locationName?: string;
  onOpen: () => void;
  onCheck: (item: { index: number; text: string }, checked: boolean) => void;
  onToggleDone: (done: boolean) => void;
  onEdit: () => void;
  onCancel: () => void;
}

const INTERACTIVE =
  'a,button,input,label,textarea,select,[role="menu"],[role="menuitem"],[role="dialog"]';

/**
 * Kartu task: SELURUH catatan tampil (tanpa dipotong) dengan centang langsung. Klik badan kartu membuka detail;
 * klik pada centang, tautan, atau tombol tidak ikut membuka detail.
 */
export function HandoverCard({
  handover,
  canMarkDone,
  canEdit,
  canCancel,
  pending,
  locationName,
  onOpen,
  onCheck,
  onToggleDone,
  onEdit,
  onCancel,
}: HandoverCardProps) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const cancelled = handover.status === 'cancelled';
  const done = handover.status === 'done';
  const total = handover.checklist.length;
  const checked = handover.checklist.filter((item) => item.checked).length;
  // Aksi More: Ubah (handover:edit) dan Batalkan (handover:manage); keduanya tidak berlaku untuk task Dibatalkan,
  // dan Batalkan tidak berlaku untuk task Selesai. Tanpa aksi, More tidak dirender sama sekali.
  const showEdit = canEdit && !cancelled;
  const showCancel = canCancel && !cancelled && !done;

  return (
    <>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: jalur keyboard ke detail adalah tombol nomor task */}
      <article
        aria-label={`Task ${handover.number}`}
        className="cursor-pointer space-y-3 rounded-lg border bg-card p-3 text-card-foreground shadow-xs"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
          onOpen();
        }}
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
          <Badge variant={handoverStatusVariant(handover.status)}>
            {HANDOVER_STATUS_LABELS[handover.status]}
          </Badge>
        </div>

        <NoteView
          note={handover.note}
          checklist={handover.checklist}
          comments={[]}
          canCheck={canMarkDone && !cancelled && !pending}
          canComment={false}
          onCheck={onCheck}
          onComment={() => undefined}
        />

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex gap-3">
            {total > 0 ? <span>{`${checked}/${total}`}</span> : null}
            {handover.comments.length > 0 ? (
              <span>{`${handover.comments.length} komentar`}</span>
            ) : null}
          </span>
          <span className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant={done ? 'outline' : 'default'}
              disabled={!canMarkDone || cancelled || pending}
              onClick={() => onToggleDone(!done)}
            >
              {done ? 'Buka kembali' : 'Mark done'}
            </Button>
            {showEdit || showCancel ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" size="sm" variant="ghost" aria-label="More">
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {showEdit ? <DropdownMenuItem onSelect={onEdit}>Ubah</DropdownMenuItem> : null}
                  {showCancel ? (
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
