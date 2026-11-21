import type { BusinessUnitOptionDto, QrPresetDto } from '@shared/contract';
import type { ReactNode } from 'react';
import { type DataColumn, DataTable, LinkCell, type RowAction } from '@/components/data-table';
import type { RowSelection } from '@/components/data-table/use-row-selection';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import { formatStamp } from '@/lib/format-stamp';

export interface QrPresetsPageProps {
  presets: readonly QrPresetDto[];
  businessUnits: readonly BusinessUnitOptionDto[];
  /** Tampilan "Terhapus": satu-satunya aksi baris dan massal adalah Pulihkan. */
  deletedView?: boolean;
  /** Nama BU menaut ke halaman BU hanya bila pengguna berhak (`businessUnitLinkAccess`). */
  canOpenBusinessUnit?: boolean;
  /** Kolom checkbox untuk aksi massal (halaman ini hanya untuk `qrcode: manage`). */
  selection?: RowSelection;
  /** Preset yang sedang diproses (aksi barisnya dinonaktifkan/sibuk). */
  busyId?: string | null;
  onEdit: (preset: QrPresetDto) => void;
  onClone: (preset: QrPresetDto) => void;
  onDelete: (preset: QrPresetDto) => void;
  onRestore: (preset: QrPresetDto) => void;
  filtered?: boolean;
  onClearFilters?: () => void;
  emptyAction?: ReactNode;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

/**
 * Tabel konfigurasi default QR (kit CRUD): [checkbox][Aksi][Nama → View][Business Unit → View BU][Nama Manual Book
 * di][Diperbarui]. Di ponsel menjadi kartu (nama = judul). Halaman (`routes/_app/qrcode/default/index.tsx`) memegang
 * filter, bar aksi massal, dialog kloning/hapus, dan pustaka logo.
 */
export function QrPresetsPage({
  presets,
  businessUnits,
  deletedView = false,
  canOpenBusinessUnit = true,
  selection,
  busyId = null,
  onEdit,
  onClone,
  onDelete,
  onRestore,
  filtered,
  onClearFilters,
  emptyAction,
  isLoading,
  isError,
  onRetry,
}: QrPresetsPageProps) {
  const buById = new Map(businessUnits.map((unit) => [unit.id, unit]));

  const columns: DataColumn<QrPresetDto>[] = [
    {
      id: 'name',
      header: 'Nama',
      mobile: 'title',
      cell: (preset) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <LinkCell to="/qrcode/default/$presetId" params={{ presetId: preset.id }}>
            {preset.name}
          </LinkCell>
          {preset.deleted ? <DeletedBadge /> : null}
        </span>
      ),
    },
    {
      id: 'bu',
      header: 'Business Unit',
      cell: (preset) => {
        if (preset.buId === '') return <span className="text-muted-foreground">Belum diatur</span>;
        const unit = buById.get(preset.buId);
        if (!unit) return '—';
        return canOpenBusinessUnit ? (
          <LinkCell
            to="/access/business-units/$businessUnitId"
            params={{ businessUnitId: unit.id }}
            title={unit.name}
          >
            {unit.name}
          </LinkCell>
        ) : (
          unit.name
        );
      },
    },
    {
      id: 'placement',
      header: 'Nama Manual Book di',
      className: 'capitalize',
      cell: (preset) => (preset.namePlacement === '' ? '—' : preset.namePlacement),
    },
    ...(deletedView
      ? ([
          {
            id: 'deletedBy',
            header: 'Dihapus oleh',
            cell: (preset) => preset.deleted?.deletedBy ?? '—',
          },
          {
            id: 'deletedAt',
            header: 'Dihapus pada',
            cell: (preset) => (preset.deleted ? formatStamp(preset.deleted.deletedAt) : '—'),
          },
        ] satisfies DataColumn<QrPresetDto>[])
      : ([
          {
            id: 'updatedAt',
            header: 'Diperbarui',
            className: 'text-sm',
            cell: (preset) => formatStamp(preset.updatedAt),
          },
        ] satisfies DataColumn<QrPresetDto>[])),
  ];

  const actions = (preset: QrPresetDto): RowAction[] => {
    const busy = busyId === preset.id;
    if (deletedView || preset.deleted) {
      return [
        {
          id: 'restore',
          action: 'restore',
          label: `Pulihkan ${preset.name}`,
          busy,
          onSelect: () => onRestore(preset),
        },
      ];
    }
    return [
      {
        id: 'edit',
        action: 'edit',
        label: `Ubah ${preset.name}`,
        disabled: busy,
        onSelect: () => onEdit(preset),
      },
      {
        id: 'clone',
        action: 'copy',
        label: `Kloning ${preset.name}`,
        disabled: busy,
        onSelect: () => onClone(preset),
      },
      {
        id: 'delete',
        action: 'delete',
        label: `Hapus ${preset.name}`,
        busy,
        onSelect: () => onDelete(preset),
      },
    ];
  };

  return (
    <DataTable
      rows={presets}
      rowKey={(preset) => preset.id}
      columns={columns}
      label="Daftar konfigurasi default QR"
      selectLabel={(preset) => preset.name}
      selection={selection}
      actions={actions}
      empty="Belum ada konfigurasi default."
      filtered={filtered}
      onClearFilters={onClearFilters}
      emptyAction={emptyAction}
      isLoading={isLoading}
      isError={isError}
      onRetry={onRetry}
    />
  );
}
