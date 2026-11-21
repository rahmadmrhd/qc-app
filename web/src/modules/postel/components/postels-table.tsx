import type { PostelSummaryDto } from '@shared/contract';
import type { ReactNode } from 'react';
import { type DataColumn, DataTable, LinkCell, type RowAction } from '@/components/data-table';
import type { RowSelection } from '@/components/data-table/use-row-selection';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import { formatStamp } from '@/lib/format-stamp';
import { daysLeftLabel, formatPostelDate } from '../lib/condition';
import { PostelConditionBadge } from './postel-condition-badge';

export interface PostelsTableProps {
  postels: readonly PostelSummaryDto[];
  /** Tampilan "Terhapus": satu-satunya aksi baris dan massal adalah Pulihkan. */
  deletedView?: boolean;
  canEdit: boolean;
  /** Ada = kolom checkbox (hanya bagi pemegang `sticker: edit`). */
  selection?: RowSelection;
  /** Catatan yang sedang diproses (aksi barisnya dinonaktifkan). */
  busyId?: string | null;
  onEdit: (postel: PostelSummaryDto) => void;
  onDelete: (postel: PostelSummaryDto) => void;
  onRestore: (postel: PostelSummaryDto) => void;
  /** Ada filter/pencarian aktif: kosong berarti "tidak cocok" dan menawarkan hapus filter. */
  filtered?: boolean;
  onClearFilters?: () => void;
  /** Ajakan pada daftar kosong tanpa filter (mis. tombol Tambah Postel). */
  emptyAction?: ReactNode;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

/**
 * Tabel catatan Postel (kit CRUD): [checkbox][Aksi][Nama → View][Jumlah item][Nomor Aktif][Tanggal habis][Sisa
 * hari][Kondisi][Nomor lama][Diperbarui]. Kondisi sebuah catatan = kondisi nomor Aktif-nya. Di ponsel menjadi kartu:
 * Nama = judul, Kondisi = badge, sisanya meta berlabel. Halaman (`routes/_app/postel/index.tsx`) memegang filter
 * (cari, kondisi, status), bar aksi massal, dan dialog hapus.
 */
export function PostelsTable({
  postels,
  deletedView = false,
  canEdit,
  selection,
  busyId = null,
  onEdit,
  onDelete,
  onRestore,
  filtered,
  onClearFilters,
  emptyAction,
  isLoading,
  isError,
  onRetry,
}: PostelsTableProps) {
  const columns: DataColumn<PostelSummaryDto>[] = [
    {
      id: 'name',
      header: 'Nama',
      mobile: 'title',
      cell: (postel) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <LinkCell to="/postel/$postelId" params={{ postelId: postel.id }}>
            {postel.name}
          </LinkCell>
          {postel.deleted ? <DeletedBadge /> : null}
        </span>
      ),
    },
    {
      id: 'items',
      header: 'Jumlah item',
      align: 'right',
      cell: (postel) => postel.itemCount,
    },
    { id: 'active', header: 'Nomor Aktif', cell: (postel) => postel.activeNumber },
    {
      id: 'expires',
      header: 'Tanggal habis',
      cell: (postel) => formatPostelDate(postel.activeExpiresOn),
    },
    {
      id: 'daysLeft',
      header: 'Sisa hari',
      cell: (postel) => daysLeftLabel(postel.daysLeft),
    },
    {
      id: 'status',
      header: 'Kondisi',
      cell: (postel) => <PostelConditionBadge condition={postel.condition} />,
    },
    {
      id: 'old',
      header: 'Nomor lama',
      align: 'right',
      cell: (postel) => postel.oldNumberCount,
    },
    // Tampilan Terhapus (soft delete 4.5): "Dihapus oleh" dan "Dihapus pada" menggantikan Diperbarui.
    ...(deletedView
      ? ([
          {
            id: 'deletedBy',
            header: 'Dihapus oleh',
            cell: (postel) => postel.deleted?.deletedBy ?? '—',
          },
          {
            id: 'deletedAt',
            header: 'Dihapus pada',
            cell: (postel) => (postel.deleted ? formatStamp(postel.deleted.deletedAt) : '—'),
          },
        ] satisfies DataColumn<PostelSummaryDto>[])
      : ([
          {
            id: 'updatedAt',
            header: 'Diperbarui',
            className: 'text-sm text-muted-foreground',
            cell: (postel) => formatStamp(postel.updatedAt),
          },
        ] satisfies DataColumn<PostelSummaryDto>[])),
  ];

  const actions = (postel: PostelSummaryDto): RowAction[] => {
    const busy = busyId === postel.id;
    if (postel.deleted || deletedView) {
      return [
        {
          id: 'restore',
          action: 'restore',
          label: `Pulihkan ${postel.name}`,
          hidden: !canEdit,
          busy,
          onSelect: () => onRestore(postel),
        },
      ];
    }
    return [
      {
        id: 'edit',
        action: 'edit',
        label: `Ubah ${postel.name}`,
        hidden: !canEdit,
        disabled: busy,
        onSelect: () => onEdit(postel),
      },
      {
        id: 'delete',
        action: 'delete',
        label: `Hapus ${postel.name}`,
        hidden: !canEdit,
        busy,
        onSelect: () => onDelete(postel),
      },
    ];
  };

  return (
    <DataTable
      rows={postels}
      rowKey={(postel) => postel.id}
      columns={columns}
      label="Daftar catatan Postel"
      selectLabel={(postel) => postel.name}
      selection={selection}
      actions={actions}
      empty="Belum ada catatan Postel."
      filtered={filtered}
      onClearFilters={onClearFilters}
      emptyAction={emptyAction}
      isLoading={isLoading}
      isError={isError}
      onRetry={onRetry}
    />
  );
}
