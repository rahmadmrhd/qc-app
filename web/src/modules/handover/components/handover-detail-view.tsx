import type { HandoverDto } from '@shared/contract';
import { useState } from 'react';
import { LinkCell } from '@/components/data-table';
import { DetailList, ViewMeta, ViewPage, ViewSection } from '@/components/page/view-page';
import { ConfirmDeleteDialog } from '@/components/soft-delete/confirm-delete-dialog';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import { DeletedBanner } from '@/components/soft-delete/deleted-banner';
import { formatStamp } from '@/lib/format-stamp';
import { ActivityLog } from '@/modules/activity/components/activity-log';
import { handoverActions } from '../lib/actions';
import { useOutboxOverlay } from '../lib/use-pending-checks';
import { CancelDialog } from './cancel-dialog';
import { HandoverStatusBadge } from './handover-status-badge';
import { NoteView } from './note-view';

export type HandoverTab = 'catatan' | 'riwayat';

export interface HandoverDetailViewProps {
  handover: HandoverDto;
  /** Pemilik antrean centang di perangkat (email akun); kosong = tanpa penempelan centang tertunda. */
  owner?: string;
  locationName: string;
  /** Nama customer menaut ke View customer (`/customer/$customerId`); hanya bagi pengguna dengan `item: view`. */
  canOpenCustomer?: boolean;
  /** WH: `handover: edit` di lokasi task. */
  canEdit: boolean;
  /** WH: `handover: manage` di lokasi task (Batalkan dan Buka kembali task Dibatalkan). */
  canCancel: boolean;
  /** `handover: manage` di lokasi task: Hapus dan Pulihkan (bawaan `false`). */
  canDelete?: boolean;
  /** QC: `qc: edit` di lokasi task (centang dan Mark done). */
  canProgress: boolean;
  pending: boolean;
  /** Hapus sedang berjalan (dialog konfirmasi tak dapat ditutup). */
  deleting?: boolean;
  /** Pulihkan sedang berjalan. */
  restoring?: boolean;
  /** Tab aktif terkendali (search param `tab`); tanpa ini halaman memegangnya sendiri. */
  tab?: HandoverTab | undefined;
  onTabChange?: ((tab: HandoverTab) => void) | undefined;
  onEdit: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
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

/**
 * View task Serah Terima (kit CRUD): tab Catatan (ringkasan + checklist dan komentar) dan Riwayat. Aksi: Mark done,
 * Buka kembali, Ubah, Batalkan task, Hapus, dan Pulihkan (task terhapus), sesuai izin di lokasi task. Hapus berbeda
 * dari Batalkan: task terhapus hilang dari papan dan hanya terlihat di tampilan Terhapus.
 */
export function HandoverDetailView({
  handover: serverHandover,
  owner = '',
  locationName,
  canOpenCustomer = false,
  canEdit,
  canCancel,
  canDelete = false,
  canProgress,
  pending,
  deleting = false,
  restoring = false,
  tab,
  onTabChange,
  onEdit,
  onCancel,
  onDelete,
  onRestore,
  onMarkDone,
  onReopen,
  onCheck,
  onComment,
}: HandoverDetailViewProps) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Centang yang menunggu terkirim tetap tampak tercentang walau refetch tiba lebih dulu dari pengiriman.
  const { dto: handover, itemStates, pendingComments } = useOutboxOverlay(serverHandover, owner);
  const cancelled = handover.status === 'cancelled';
  const deleted = handover.deleted !== undefined;
  const actions = handoverActions(handover.status, {
    canMarkDone: canProgress,
    canEdit,
    canManage: canCancel,
  });
  const total = handover.checklist.length;
  const checked = handover.checklist.filter((item) => item.checked).length;

  const catatanTab = (
    <div className="space-y-6">
      <ViewSection title="Ringkasan">
        <DetailList
          items={[
            { label: 'Lokasi', value: locationName },
            {
              label: 'Customer',
              value:
                canOpenCustomer && handover.customerId && handover.customerName ? (
                  <LinkCell to="/customer/$customerId" params={{ customerId: handover.customerId }}>
                    {handover.customerName}
                  </LinkCell>
                ) : (
                  handover.customerName || 'Tanpa customer'
                ),
            },
            { label: 'Progres', value: total > 0 ? `${checked}/${total}` : 'Tanpa checklist' },
          ]}
        />
      </ViewSection>
      <section data-tour="handover-checklist" className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">Catatan</h2>
        <NoteView
          note={handover.note}
          checklist={handover.checklist}
          comments={handover.comments}
          canCheck={canProgress && !cancelled && !deleted && !pending}
          canComment={!cancelled && !deleted}
          itemStates={itemStates}
          pendingComments={pendingComments}
          onCheck={onCheck}
          onComment={onComment}
        />
        {!cancelled && !deleted ? (
          <p className="text-xs text-muted-foreground">
            Pilih teks pada catatan lalu tekan Balas, atau tekan Tambah komentar untuk komentar
            umum.
          </p>
        ) : null}
      </section>
    </div>
  );

  const riwayatTab = (
    <ViewSection title="Riwayat">
      <DetailList
        items={[
          { label: 'Dibuat', value: `${handover.createdBy} · ${formatStamp(handover.createdAt)}` },
          {
            label: 'Terakhir diubah',
            value: `${handover.updatedBy} · ${formatStamp(handover.updatedAt)}`,
          },
          {
            label: 'Ditandai selesai',
            value: `${handover.completedBy} · ${formatStamp(handover.completedAt)}`,
            hidden: handover.completedAt === '',
          },
          {
            label: 'Dihapus',
            value: handover.deleted
              ? `${handover.deleted.deletedBy} · ${formatStamp(handover.deleted.deletedAt)}`
              : null,
            hidden: !handover.deleted,
          },
        ]}
      />
    </ViewSection>
  );

  return (
    <>
      <ViewPage
        title={handover.number}
        badge={
          <span className="flex flex-wrap items-center gap-2">
            <HandoverStatusBadge status={handover.status} />
            {deleted ? <DeletedBadge /> : null}
          </span>
        }
        actionItems={[
          {
            id: 'done',
            action: 'done',
            primary: true,
            hidden: !actions.markDone || deleted,
            disabled: !actions.markDoneEnabled,
            disabledReason: 'Hanya QC yang dapat menandai task selesai',
            busy: pending,
            onSelect: onMarkDone,
          },
          {
            id: 'reopen',
            action: 'reopen',
            hidden: !actions.reopen || deleted,
            busy: pending,
            onSelect: onReopen,
          },
          {
            id: 'edit',
            action: 'edit',
            label: 'Ubah',
            hidden: !actions.edit || deleted,
            onSelect: onEdit,
          },
          {
            id: 'abort',
            action: 'abort',
            hidden: !actions.cancel || deleted,
            onSelect: () => setConfirmCancel(true),
          },
          {
            id: 'delete',
            action: 'delete',
            busy: deleting,
            hidden: !canDelete || deleted || onDelete === undefined,
            onSelect: () => setConfirmDelete(true),
          },
          {
            id: 'restore',
            action: 'restore',
            busy: restoring,
            hidden: !canDelete || !deleted || onRestore === undefined,
            onSelect: () => onRestore?.(),
          },
        ]}
        banner={
          handover.deleted ? (
            <DeletedBanner
              info={handover.deleted}
              canRestore={canDelete && onRestore !== undefined}
              {...(onRestore ? { onRestore } : {})}
              restoring={restoring}
            />
          ) : null
        }
        tabs={[
          { id: 'catatan', label: 'Catatan', content: catatanTab },
          { id: 'riwayat', label: 'Riwayat', content: riwayatTab },
        ]}
        {...(tab ? { tab } : {})}
        onTabChange={(id) => onTabChange?.(id as HandoverTab)}
        aside={
          <>
            <ViewMeta
              createdBy={handover.createdBy}
              createdAt={handover.createdAt}
              updatedBy={handover.updatedBy}
              updatedAt={handover.updatedAt}
            />
            <ActivityLog kind="handover" id={handover.id} createdAt={handover.createdAt} />
          </>
        }
      />
      <CancelDialog
        open={confirmCancel}
        number={handover.number}
        onOpenChange={setConfirmCancel}
        onConfirm={onCancel}
      />
      {onDelete ? (
        <ConfirmDeleteDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          count={1}
          subject={`task ${handover.number}`}
          usage="Berbeda dari Batalkan: task yang dihapus hilang dari papan dan hanya terlihat di tampilan Terhapus."
          busy={deleting}
          onConfirm={() => {
            setConfirmDelete(false);
            onDelete();
          }}
        />
      ) : null}
    </>
  );
}
