import type { QrDesignDto, QrFileKind } from '@shared/contract';
import type { ReactNode } from 'react';
import { type DataColumn, DataTable, LinkCell, type RowAction } from '@/components/data-table';
import type { RowSelection } from '@/components/data-table/use-row-selection';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import { Badge } from '@/components/ui/badge';
import { formatStamp } from '@/lib/format-stamp';
import { isWebUrl } from '@/lib/web-url';
import { STICKER_STATUS_LABEL } from '@/modules/sticker/lib/status';

export interface QrDesignsTableProps {
  designs: readonly QrDesignDto[];
  /** Tampilan "Terhapus": satu-satunya aksi baris dan massal adalah Pulihkan. */
  deletedView?: boolean;
  canEdit: boolean;
  canManage: boolean;
  /** Nama item menaut ke View item hanya bila pengguna berhak (`itemLinkAccess(...).openItemHref`). */
  canOpenItem?: boolean;
  /** Item terhapus hanya menaut ke View bagi pemegang izin Pulihkan item (`itemLinkAccess(...).canOpenDeleted`). */
  canOpenDeletedItem?: boolean;
  /** Ada = kolom checkbox (hanya bagi pemegang `qrcode: manage`). */
  selection?: RowSelection;
  /** Konfigurasi yang sedang diproses (aksi barisnya dinonaktifkan). */
  busyId?: string | null;
  onEdit: (design: QrDesignDto) => void;
  onExport: (design: QrDesignDto) => void;
  onDownload: (design: QrDesignDto, kind: QrFileKind) => void;
  onDelete: (design: QrDesignDto) => void;
  onRestore: (design: QrDesignDto) => void;
  /** Ada filter/pencarian aktif: kosong berarti "tidak cocok" dan menawarkan hapus filter. */
  filtered?: boolean;
  onClearFilters?: () => void;
  /** Ajakan pada daftar kosong tanpa filter (mis. tombol Buat konfigurasi). */
  emptyAction?: ReactNode;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

/** Nama yang dibaca pengguna: nama Manual Book, atau judul label untuk konfigurasi lama tanpa nama. */
const nameOf = (design: QrDesignDto) => (design.name !== '' ? design.name : design.title);

/** Berapa item yang ditulis namanya di sel Item sebelum diringkas menjadi "+N lagi". */
const ITEMS_SHOWN = 3;

function ItemsCell({
  design,
  canOpenItem,
  canOpenDeletedItem,
}: {
  design: QrDesignDto;
  canOpenItem: boolean;
  canOpenDeletedItem: boolean;
}) {
  const total = design.items.length + design.hiddenItemCount;
  if (total === 0) return <span className="text-sm text-muted-foreground">Belum ada item</span>;
  const shown = design.items.slice(0, ITEMS_SHOWN);
  const rest = design.items.length - shown.length;
  return (
    <div className="space-y-0.5 text-sm">
      <div>{total} item</div>
      <ul className="space-y-0.5 text-xs">
        {shown.map((item) => {
          const label = `${item.brand} ${item.model}`;
          const linked = canOpenItem && (!item.deleted || canOpenDeletedItem);
          return (
            <li key={item.id} className="flex flex-wrap items-center gap-1">
              {linked ? (
                <LinkCell to="/item/$itemId" params={{ itemId: item.id }}>
                  {label}
                </LinkCell>
              ) : (
                <span className="text-muted-foreground">{label}</span>
              )}
              {item.deleted ? <DeletedBadge /> : null}
            </li>
          );
        })}
        {rest > 0 ? <li className="text-muted-foreground">{`+${rest} lagi`}</li> : null}
      </ul>
    </div>
  );
}

function VersionCell({ design }: { design: QrDesignDto }) {
  if (design.stickerVersion === 0 || design.stickerStatus === '') {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  return (
    <div className="flex items-center gap-1">
      <span className="text-sm font-medium">v{design.stickerVersion}</span>
      {design.stickerStatus === 'active' ? null : (
        <Badge variant="outline">{STICKER_STATUS_LABEL[design.stickerStatus]}</Badge>
      )}
    </div>
  );
}

function ExportStatusCell({ design }: { design: QrDesignDto }) {
  return (
    <div className="space-y-1">
      {design.exportStatus === 'none' ? (
        <Badge variant="secondary">Belum diekspor</Badge>
      ) : (
        <div className="space-y-0.5">
          <Badge variant={design.exportStatus === 'stale' ? 'outline' : 'default'}>
            {design.exportStatus === 'stale' ? 'Berubah sejak ekspor' : 'Sudah diekspor'}
          </Badge>
          <p className="text-xs text-muted-foreground">
            {formatStamp(design.exportedAt)} · {design.exportedBy}
          </p>
        </div>
      )}
      {design.overflow ? (
        <Badge color="destructive" variant="soft">
          Tidak muat
        </Badge>
      ) : null}
    </div>
  );
}

/**
 * Tabel konfigurasi QR (kit CRUD): [checkbox][Aksi][Nama → View][Item][Versi stiker][Link][Diperbarui][Status
 * ekspor]. Di ponsel menjadi kartu: Nama = judul, status ekspor = badge, Link disembunyikan (URL panjang), sisanya
 * meta berlabel. Halaman (`routes/_app/qrcode/index.tsx`) memegang filter, bar aksi massal, dialog, dan ekspor.
 */
export function QrDesignsTable({
  designs,
  deletedView = false,
  canEdit,
  canManage,
  canOpenItem = true,
  canOpenDeletedItem = true,
  selection,
  busyId = null,
  onEdit,
  onExport,
  onDownload,
  onDelete,
  onRestore,
  filtered,
  onClearFilters,
  emptyAction,
  isLoading,
  isError,
  onRetry,
}: QrDesignsTableProps) {
  const columns: DataColumn<QrDesignDto>[] = [
    {
      id: 'name',
      header: 'Nama',
      mobile: 'title',
      cell: (design) => (
        <>
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <LinkCell to="/qrcode/$designId" params={{ designId: design.id }}>
              {nameOf(design)}
            </LinkCell>
            {design.deleted ? <DeletedBadge /> : null}
          </span>
          {design.subtitle !== '' ? (
            <div
              data-testid="design-subtitle"
              className="text-sm font-normal text-muted-foreground"
            >
              {design.subtitle}
            </div>
          ) : null}
        </>
      ),
    },
    {
      id: 'items',
      header: 'Item',
      cell: (design) => (
        <ItemsCell
          design={design}
          canOpenItem={canOpenItem}
          canOpenDeletedItem={canOpenDeletedItem}
        />
      ),
    },
    { id: 'version', header: 'Versi stiker', cell: (design) => <VersionCell design={design} /> },
    // Tampilan Terhapus (soft delete 4.5): "Dihapus oleh" dan "Dihapus pada" menggantikan Link, Diperbarui, dan
    // status ekspor agar jumlah kolom tetap.
    ...(deletedView
      ? ([
          {
            id: 'deletedBy',
            header: 'Dihapus oleh',
            cell: (design) => design.deleted?.deletedBy ?? '—',
          },
          {
            id: 'deletedAt',
            header: 'Dihapus pada',
            cell: (design) => (design.deleted ? formatStamp(design.deleted.deletedAt) : '—'),
          },
        ] satisfies DataColumn<QrDesignDto>[])
      : ([
          {
            id: 'link',
            header: 'Link',
            mobile: 'hide',
            className: 'max-w-[16rem] truncate',
            cell: (design) =>
              !isWebUrl(design.link) ? (
                <span className="text-sm">{design.link}</span>
              ) : (
                <a
                  href={design.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={design.link}
                  aria-label={`Buka link ${nameOf(design)}`}
                  className="text-sm underline-offset-2 hover:underline"
                >
                  {design.link}
                </a>
              ),
          },
          {
            id: 'updatedAt',
            header: 'Diperbarui',
            className: 'text-sm',
            cell: (design) => formatStamp(design.updatedAt),
          },
          {
            id: 'status',
            header: 'Status',
            cell: (design) => <ExportStatusCell design={design} />,
          },
        ] satisfies DataColumn<QrDesignDto>[])),
  ];

  const actions = (design: QrDesignDto): RowAction[] => {
    const label = nameOf(design);
    const busy = busyId === design.id;
    if (design.deleted || deletedView) {
      return [
        {
          id: 'restore',
          action: 'restore',
          label: `Pulihkan ${label}`,
          hidden: !canManage,
          busy,
          onSelect: () => onRestore(design),
        },
      ];
    }
    const exported = design.exportedAt !== '';
    return [
      {
        id: 'edit',
        action: 'edit',
        label: `Ubah ${label}`,
        hidden: !canEdit,
        disabled: busy,
        onSelect: () => onEdit(design),
      },
      {
        id: 'export',
        action: 'export',
        label: `${exported ? 'Ekspor ulang' : 'Ekspor'} ${label}`,
        hidden: !canEdit,
        // Isi label yang tidak muat di kanvas 3 × 3 cm tak dapat diekspor sampai konfigurasinya diperbaiki.
        disabled: busy || design.overflow,
        onSelect: () => onExport(design),
      },
      {
        id: 'download-pdf',
        action: 'download',
        label: `Unduh PDF ${label}`,
        hidden: !exported,
        disabled: busy,
        onSelect: () => onDownload(design, 'pdf'),
      },
      {
        id: 'download-png',
        action: 'download',
        label: `Unduh PNG ${label}`,
        hidden: !exported,
        disabled: busy,
        onSelect: () => onDownload(design, 'png'),
      },
      {
        id: 'delete',
        action: 'delete',
        label: `Hapus ${label}`,
        hidden: !canManage,
        busy,
        onSelect: () => onDelete(design),
      },
    ];
  };

  return (
    <DataTable
      rows={designs}
      rowKey={(design) => design.id}
      columns={columns}
      label="Daftar konfigurasi QR"
      selectLabel={nameOf}
      selection={selection}
      actions={actions}
      empty="Belum ada konfigurasi."
      filtered={filtered}
      onClearFilters={onClearFilters}
      emptyAction={emptyAction}
      isLoading={isLoading}
      isError={isError}
      onRetry={onRetry}
    />
  );
}
