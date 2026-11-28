import type { ClFirmwareDto } from '@shared/contract';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { type DataColumn, DataTable, type RowAction } from '@/components/data-table';
import { ListPage } from '@/components/page/list-page';
import { ConfirmDeleteDialog } from '@/components/soft-delete/confirm-delete-dialog';
import { Badge } from '@/components/ui/badge';
import { describeError } from '@/lib/api/describe-error';
import { can } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { BRAND_LABELS } from '../lib/labels';
import { firmwaresQueryOptions, useRemoveFirmware } from '../queries';
import { FirmwareFormDialog } from './firmware-form-dialog';

const SORT_STEP = 10;

/**
 * Daftar firmware Country Lock (kit CRUD): merk, kode, label, skrip, paralel, jumlah item pemakai. Ubah bagi
 * `countrylock: edit`; Hapus hanya bagi `manage` (server menolak menghapus firmware yang masih dipakai Item).
 */
export function FirmwarePage() {
  const me = useMe();
  const canManage = can(me, 'countrylock', 'manage');
  const list = useQuery(firmwaresQueryOptions());
  const remove = useRemoveFirmware();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ClFirmwareDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ClFirmwareDto | null>(null);

  const rows = list.data ?? [];
  const nextSort = rows.reduce((max, row) => Math.max(max, row.sort), 0) + SORT_STEP;

  const openForm = (firmware: ClFirmwareDto | null) => {
    setEditing(firmware);
    setFormOpen(true);
  };

  const columns: DataColumn<ClFirmwareDto>[] = [
    {
      id: 'code',
      header: 'Kode',
      mobile: 'title',
      cell: (firmware) => (
        <span className="inline-flex items-center gap-2">
          <span className="font-medium">{firmware.code}</span>
          <Badge variant="soft" color={firmware.brand === 'mikrotik' ? 'info' : 'primary'}>
            {BRAND_LABELS[firmware.brand]}
          </Badge>
        </span>
      ),
    },
    { id: 'label', header: 'Label', cell: (firmware) => firmware.label },
    {
      id: 'script',
      header: 'Skrip',
      cell: (firmware) =>
        firmware.scriptPath ?? <span className="text-muted-foreground">Belum ada skrip</span>,
    },
    {
      id: 'parallel',
      header: 'Paralel',
      cell: (firmware) => (firmware.parallel ? 'Ya' : 'Tidak'),
    },
    {
      id: 'inUse',
      header: 'Dipakai',
      align: 'right',
      cell: (firmware) => `${firmware.inUseCount} item`,
    },
  ];

  const actions = (firmware: ClFirmwareDto): RowAction[] => [
    {
      id: 'edit',
      action: 'edit',
      label: `Ubah ${firmware.code}`,
      shortLabel: 'Ubah',
      onSelect: () => openForm(firmware),
    },
    ...(canManage
      ? [
          {
            id: 'delete',
            action: 'delete' as const,
            label: `Hapus ${firmware.code}`,
            shortLabel: 'Hapus',
            busy: remove.isPending && remove.variables === firmware.id,
            disabled: remove.isPending,
            onSelect: () => setDeleteTarget(firmware),
          },
        ]
      : []),
  ];

  const confirmDelete = () => {
    const target = deleteTarget;
    if (!target) return;
    remove.mutate(target.id, {
      onSuccess: () => toast.success(`Firmware ${target.code} dihapus`),
      onError: (error) => toast.error(describeError(error)),
      onSettled: () => setDeleteTarget(null),
    });
  };

  return (
    <>
      <ListPage
        title="Firmware Country Lock"
        count={list.isSuccess && rows.length > 0 ? `${rows.length} firmware` : undefined}
        createAction={{ label: 'Tambah firmware', onClick: () => openForm(null) }}
      >
        <p className="mb-3 text-sm text-muted-foreground">
          Daftar firmware per merk. Skrip dipilih dari berkas Country Lock berperan Skrip; firmware
          tanpa skrip tidak dapat dijalankan desktop.
        </p>
        <DataTable
          rows={rows}
          rowKey={(firmware) => firmware.id}
          columns={columns}
          label="Daftar firmware Country Lock"
          selectLabel={(firmware) => `${BRAND_LABELS[firmware.brand]} ${firmware.code}`}
          actions={actions}
          empty="Belum ada firmware."
          isLoading={list.isPending}
          isError={list.isLoadingError}
          onRetry={() => void list.refetch()}
        />
      </ListPage>
      <FirmwareFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        firmware={editing}
        nextSort={nextSort}
      />
      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null);
        }}
        count={1}
        subject={deleteTarget ? `firmware ${deleteTarget.code}` : 'firmware'}
        permanent
        usage={
          deleteTarget
            ? deleteTarget.inUseCount > 0
              ? `Dipakai ${deleteTarget.inUseCount} item.`
              : 'Tidak dipakai item mana pun.'
            : undefined
        }
        blockedReason={
          deleteTarget && deleteTarget.inUseCount > 0
            ? 'Firmware yang masih dipakai item tidak dapat dihapus: pindahkan atau ubah firmware item itu dulu.'
            : undefined
        }
        onConfirm={confirmDelete}
        busy={remove.isPending}
      />
    </>
  );
}
