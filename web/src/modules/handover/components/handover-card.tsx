import type { HandoverDto } from '@shared/contract';
import { Ellipsis } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { ACTIONS, ActionButton } from '@/components/action-button';
import { LinkCell } from '@/components/data-table';
import { MobileCard } from '@/components/mobile/mobile-card';
import { ConfirmDeleteDialog } from '@/components/soft-delete/confirm-delete-dialog';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useNearViewport } from '@/lib/near-viewport';
import { cn } from '@/lib/utils';
import { handoverActions } from '../lib/actions';
import { HANDOVER_STATUS_ACCENT } from '../lib/status';
import { useOutboxOverlay } from '../lib/use-pending-checks';
import { CancelDialog } from './cancel-dialog';
import { HandoverStatusBadge } from './handover-status-badge';
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
  /**
   * `handover: manage` di lokasi task: Hapus (task hidup) dan Pulihkan (task terhapus). Bawaan `false`; hanya terpakai
   * bersama `onDelete`/`onRestore` (kartu contoh demo tak memilikinya).
   */
  canDelete?: boolean;
  /** Ada mutasi yang berjalan untuk task INI saja. */
  pending: boolean;
  /** Ada centang task INI yang sedang disimpan ke server (tampilan sudah berubah; penanda halus). */
  saving?: boolean;
  locationName?: string;
  /** Nama customer menaut ke View customer (`/customer/$customerId`); hanya bagi pengguna dengan `item: view`. */
  canOpenCustomer?: boolean;
  /**
   * Memasang `data-tour="handover-checklist"` (bawaan true). Kartu contoh di demo tooltip (`guide/`) mematikannya
   * agar tur tak pernah menyorot kartu contoh sebagai ganti kartu sungguhan.
   */
  tourTarget?: boolean;
  onOpen: () => void;
  onCheck: (item: { index: number; text: string }, checked: boolean) => void;
  onMarkDone: () => void;
  onReopen: () => void;
  onEdit: () => void;
  onCancel: () => void;
  /** Hapus lunak task (setelah konfirmasi di kartu; berbeda dari Batalkan). */
  onDelete?: () => void;
  /** Memulihkan task terhapus (tampilan Terhapus). */
  onRestore?: () => void;
  /**
   * Kartu berbingkai sendiri (bawaan, daftar ponsel: garis kiri sesuai warna status). Kartu kanban memasang `false`
   * karena `KanbanBoard` sudah membungkusnya dengan bingkai dan garis kiri berwarna kolomnya.
   */
  framed?: boolean;
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
 * Kartu task (anatomi `MobileCard`): SELURUH catatan tampil (tanpa dipotong) dengan centang langsung. Detail dibuka
 * lewat nomor task, opsi Ubah, atau klik badan kartu (keputusan pemilik 2026-11-22, spek B9; menggantikan "badan
 * kartu tidak bisa diklik"). Klik pada centang, komposer komentar, tombol, tautan, ⋯, atau saat teks diseleksi TIDAK
 * membuka detail (`isCardOpenClick`). Task terhapus (tampilan Terhapus) hanya-baca dengan satu aksi: Pulihkan.
 */
export function HandoverCard({
  handover: serverHandover,
  owner = '',
  canMarkDone,
  canEdit,
  canCancel,
  canDelete = false,
  pending,
  saving = false,
  locationName,
  canOpenCustomer = false,
  tourTarget = true,
  onOpen,
  onCheck,
  onMarkDone,
  onReopen,
  onEdit,
  onCancel,
  onDelete,
  onRestore,
  framed = true,
  onComment,
}: HandoverCardProps) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Centang yang menunggu terkirim tetap tampak tercentang walau refetch tiba lebih dulu dari pengiriman.
  const { dto: handover, itemStates, pendingComments } = useOutboxOverlay(serverHandover, owner);
  const cancelled = handover.status === 'cancelled';
  const deleted = handover.deleted !== undefined;
  const total = handover.checklist.length;
  const checked = handover.checklist.filter((item) => item.checked).length;
  // Aksi menurut status: Mark done (Baru/Dikerjakan), Buka kembali (hanya Dibatalkan), More (Ubah/Batalkan/Hapus)
  // hanya bila ada aksi di dalamnya. Task terhapus: hanya Pulihkan (`handover: manage`).
  const actions = handoverActions(handover.status, { canMarkDone, canEdit, canManage: canCancel });
  const canRemove = canDelete && onDelete !== undefined && !deleted;
  const canRestore = canDelete && onRestore !== undefined && deleted;
  const showMore = !deleted && (actions.more || canRemove);

  const moreMenu = showMore ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          color="primary"
          aria-label={`Aksi ${handover.number}`}
        >
          <Ellipsis aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.edit ? (
          <DropdownMenuItem onSelect={onEdit}>
            <ACTIONS.edit.icon aria-hidden="true" />
            Ubah
          </DropdownMenuItem>
        ) : null}
        {actions.cancel ? (
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmCancel(true)}>
            <ACTIONS.abort.icon aria-hidden="true" />
            Batalkan
          </DropdownMenuItem>
        ) : null}
        {canRemove ? (
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
            <ACTIONS.delete.icon aria-hidden="true" />
            Hapus
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  const customer =
    handover.customerName === '' ? (
      <span className="text-muted-foreground">Tanpa customer</span>
    ) : canOpenCustomer && handover.customerId ? (
      <LinkCell to="/customer/$customerId" params={{ customerId: handover.customerId }}>
        {handover.customerName}
      </LinkCell>
    ) : (
      handover.customerName
    );

  return (
    <>
      <MobileCard
        as="div"
        rootProps={{ role: 'article', 'aria-label': `Task ${handover.number}` }}
        onOpen={onOpen}
        className={cn(
          'space-y-3 text-card-foreground',
          framed
            ? cn('border-l-4 shadow-xs', HANDOVER_STATUS_ACCENT[handover.status])
            : 'border-0 bg-transparent p-2',
        )}
        title={
          <button
            type="button"
            className="-my-1 min-h-8 text-left text-sm font-semibold underline-offset-2 hover:underline touch:min-h-11"
            onClick={onOpen}
          >
            {handover.number}
          </button>
        }
        subtitle={customer}
        badges={[
          <HandoverStatusBadge key="status" status={handover.status} />,
          deleted ? <DeletedBadge key="deleted" /> : null,
        ]}
        {...(locationName
          ? { meta: [{ id: 'lokasi', label: 'Lokasi', value: locationName }] }
          : {})}
        actions={moreMenu}
        footer={
          <div className="space-y-3">
            <div data-tour={tourTarget ? 'handover-checklist' : undefined}>
              <LazyNote handover={handover}>
                <NoteView
                  note={handover.note}
                  checklist={handover.checklist}
                  comments={handover.comments}
                  canCheck={canMarkDone && !cancelled && !deleted && !pending}
                  canComment={!cancelled && !deleted}
                  compact
                  itemStates={itemStates}
                  pendingComments={pendingComments}
                  onCheck={onCheck}
                  onComment={onComment}
                />
              </LazyNote>
            </div>

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
                {!deleted && actions.markDone ? (
                  <ActionButton
                    action="done"
                    size="sm"
                    disabled={!actions.markDoneEnabled || pending}
                    onClick={onMarkDone}
                  />
                ) : null}
                {!deleted && actions.reopen ? (
                  <ActionButton action="reopen" size="sm" disabled={pending} onClick={onReopen} />
                ) : null}
                {canRestore ? (
                  <ActionButton action="restore" size="sm" disabled={pending} onClick={onRestore} />
                ) : null}
              </span>
            </div>
          </div>
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
          busy={pending}
          onConfirm={() => {
            setConfirmDelete(false);
            onDelete();
          }}
        />
      ) : null}
    </>
  );
}
