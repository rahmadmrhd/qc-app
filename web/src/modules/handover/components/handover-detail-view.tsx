import type { HandoverDto } from '@shared/contract';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatAuditTime } from '@/modules/access/lib/audit-actions';
import { handoverActions } from '../lib/actions';
import { HANDOVER_STATUS_LABELS, HANDOVER_STATUS_STYLES } from '../lib/status';
import { useOutboxOverlay } from '../lib/use-pending-checks';
import { CancelDialog } from './cancel-dialog';
import { NoteView } from './note-view';

export interface HandoverDetailViewProps {
  handover: HandoverDto;
  /** Pemilik antrean centang di perangkat (email akun); kosong = tanpa penempelan centang tertunda. */
  owner?: string;
  locationName: string;
  /** WH: `handover: edit` di lokasi task. */
  canEdit: boolean;
  /** WH: `handover: manage` di lokasi task (Batalkan dan Buka kembali task Dibatalkan). */
  canCancel: boolean;
  /** QC: `qc: edit` di lokasi task (centang dan Mark done). */
  canProgress: boolean;
  pending: boolean;
  onBack: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onMarkDone: () => void;
  onReopen: () => void;
  onCheck: (item: { index: number; text: string }, checked: boolean) => void;
  onComment: (input: {
    quote: string;
    before: string;
    after: string;
    body: string;
  }) => Promise<void> | void;
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

export function HandoverDetailView({
  handover: serverHandover,
  owner = '',
  locationName,
  canEdit,
  canCancel,
  canProgress,
  pending,
  onBack,
  onEdit,
  onCancel,
  onMarkDone,
  onReopen,
  onCheck,
  onComment,
}: HandoverDetailViewProps) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  // Centang yang menunggu terkirim tetap tampak tercentang walau refetch tiba lebih dulu dari pengiriman.
  const { dto: handover, pendingIndexes } = useOutboxOverlay(serverHandover, owner);
  const cancelled = handover.status === 'cancelled';
  const actions = handoverActions(handover.status, {
    canMarkDone: canProgress,
    canEdit,
    canManage: canCancel,
  });
  const styles = HANDOVER_STATUS_STYLES[handover.status];
  const total = handover.checklist.length;
  const checked = handover.checklist.filter((item) => item.checked).length;

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            Kembali
          </Button>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
            {handover.number}
            <Badge variant="outline" className={styles.badge}>
              {HANDOVER_STATUS_LABELS[handover.status]}
            </Badge>
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.markDone ? (
            <Button
              type="button"
              disabled={!actions.markDoneEnabled || pending}
              onClick={onMarkDone}
            >
              Mark done
            </Button>
          ) : null}
          {actions.reopen ? (
            <Button type="button" variant="outline" disabled={pending} onClick={onReopen}>
              Buka kembali
            </Button>
          ) : null}
          {actions.edit ? (
            <Button type="button" variant="outline" onClick={onEdit}>
              Ubah
            </Button>
          ) : null}
          {actions.cancel ? (
            <Button type="button" variant="destructive" onClick={() => setConfirmCancel(true)}>
              Batalkan task
            </Button>
          ) : null}
        </div>
      </div>

      <dl className="grid gap-3 rounded-lg border p-4 sm:grid-cols-3">
        <Meta label="Lokasi" value={locationName} />
        <Meta label="Customer" value={handover.customerName || 'Tanpa customer'} />
        <Meta label="Progres" value={total > 0 ? `${checked}/${total}` : 'Tanpa checklist'} />
      </dl>

      <section data-tour="handover-checklist" className="space-y-2 rounded-lg border p-4">
        <h2 className="text-base font-semibold">Catatan</h2>
        <NoteView
          note={handover.note}
          checklist={handover.checklist}
          comments={handover.comments}
          canCheck={canProgress && !cancelled && !pending}
          canComment={!cancelled}
          pendingIndexes={pendingIndexes}
          onCheck={onCheck}
          onComment={onComment}
        />
        {!cancelled ? (
          <p className="text-xs text-muted-foreground">
            Pilih teks pada catatan lalu tekan Balas, atau tekan Tambah komentar untuk komentar
            umum.
          </p>
        ) : null}
      </section>

      <section className="space-y-1 rounded-lg border p-4">
        <h2 className="text-base font-semibold">Riwayat</h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Meta
            label="Dibuat"
            value={`${handover.createdBy} · ${formatAuditTime(handover.createdAt)}`}
          />
          <Meta
            label="Terakhir diubah"
            value={`${handover.updatedBy} · ${formatAuditTime(handover.updatedAt)}`}
          />
          {handover.completedAt !== '' ? (
            <Meta
              label="Ditandai selesai"
              value={`${handover.completedBy} · ${formatAuditTime(handover.completedAt)}`}
            />
          ) : null}
        </dl>
      </section>

      <CancelDialog
        open={confirmCancel}
        number={handover.number}
        onOpenChange={setConfirmCancel}
        onConfirm={onCancel}
      />
    </div>
  );
}
