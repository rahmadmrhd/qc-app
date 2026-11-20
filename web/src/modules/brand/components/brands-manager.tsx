import type { BrandDto, BusinessUnitOptionDto } from '@shared/contract';
import { type DataColumn, DataTable, LinkCell, type RowAction } from '@/components/data-table';
import type { RowSelection } from '@/components/data-table/use-row-selection';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import { ActiveStatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';

export interface BrandsManagerProps {
  brands: readonly BrandDto[];
  businessUnits: readonly BusinessUnitOptionDto[];
  /** Tampilan "Terhapus": satu-satunya aksi baris dan massal adalah Pulihkan. */
  deletedView?: boolean;
  canEdit: boolean;
  canManage: boolean;
  /** Kode BU bawaan menaut ke halaman BU hanya bila pengguna berhak (`businessUnitLinkAccess`). */
  canOpenBusinessUnit?: boolean;
  /** Ada = kolom checkbox (hanya bagi pemegang `item: manage`). */
  selection?: RowSelection;
  pendingId?: string | null;
  onEdit: (brand: BrandDto) => void;
  onToggleStatus: (brand: BrandDto) => void;
  onDelete: (brand: BrandDto) => void;
  onRestore: (brand: BrandDto) => void;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

/**
 * Tabel merk (kit CRUD): [checkbox][Aksi][Merk → View][BU bawaan → View BU][Item → daftar item][Status]. Halaman
 * (`routes/_app/item/brands/index.tsx`) memegang dialog tambah/ubah, filter, dan bar aksi massal.
 */
export function BrandsManager({
  brands,
  businessUnits,
  deletedView = false,
  canEdit,
  canManage,
  canOpenBusinessUnit = true,
  selection,
  pendingId = null,
  onEdit,
  onToggleStatus,
  onDelete,
  onRestore,
  isLoading,
  isError,
  onRetry,
}: BrandsManagerProps) {
  const buById = new Map(businessUnits.map((bu) => [bu.id, bu]));

  const columns: DataColumn<BrandDto>[] = [
    {
      id: 'name',
      header: 'Merk',
      cell: (brand) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <LinkCell to="/item/brands/$brandId" params={{ brandId: brand.id }}>
            {brand.name}
          </LinkCell>
          {brand.deleted ? <DeletedBadge /> : null}
        </span>
      ),
    },
    {
      id: 'bu',
      header: 'BU bawaan',
      cell: (brand) =>
        brand.businessUnitIds.length === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {brand.businessUnitIds.map((buId) => {
              const bu = buById.get(buId);
              if (!bu) return null;
              return canOpenBusinessUnit ? (
                <LinkCell
                  key={buId}
                  to="/access/business-units/$businessUnitId"
                  params={{ businessUnitId: buId }}
                  title={bu.name}
                >
                  {bu.code}
                </LinkCell>
              ) : (
                <Badge key={buId} variant="outline" title={bu.name}>
                  {bu.code}
                </Badge>
              );
            })}
          </div>
        ),
    },
    {
      id: 'items',
      header: 'Item',
      align: 'right',
      className: 'tabular-nums',
      // `/item` belum punya filter merk: pencarian teks `q` memuat item bermerk itu (dan kecocokan nama lain).
      cell: (brand) =>
        brand.itemCount === 0 ? (
          0
        ) : (
          <LinkCell to="/item" search={{ q: brand.name }}>
            {brand.itemCount}
          </LinkCell>
        ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (brand) => <ActiveStatusBadge status={brand.status} />,
    },
  ];

  const actions = (brand: BrandDto): RowAction[] => {
    const busy = pendingId === brand.id;
    if (brand.deleted || deletedView) {
      return [
        {
          id: 'restore',
          action: 'restore',
          label: `Pulihkan ${brand.name}`,
          hidden: !canManage,
          busy,
          onSelect: () => onRestore(brand),
        },
      ];
    }
    return [
      {
        id: 'edit',
        action: 'edit',
        label: `Ubah ${brand.name}`,
        hidden: !canEdit,
        onSelect: () => onEdit(brand),
      },
      {
        id: 'status',
        action: brand.status === 'active' ? 'deactivate' : 'activate',
        label: `${brand.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'} ${brand.name}`,
        hidden: !canManage,
        busy,
        onSelect: () => onToggleStatus(brand),
      },
      {
        id: 'delete',
        action: 'delete',
        label: `Hapus ${brand.name}`,
        // Hanya merk Nonaktif yang dapat dihapus (server: "Nonaktifkan merk dulu sebelum dihapus").
        hidden: !canManage || brand.status !== 'inactive',
        busy,
        onSelect: () => onDelete(brand),
      },
    ];
  };

  return (
    <DataTable
      rows={brands}
      rowKey={(brand) => brand.id}
      columns={columns}
      label="Daftar merk"
      selectLabel={(brand) => brand.name}
      selection={selection}
      actions={actions}
      empty="Belum ada merk."
      isLoading={isLoading}
      isError={isError}
      onRetry={onRetry}
    />
  );
}
