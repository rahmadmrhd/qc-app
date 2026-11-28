import type { ClFileDto } from '@shared/contract';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { ActionButton } from '@/components/action-button';
import { type DataColumn, DataTable, LinkCell, type RowAction } from '@/components/data-table';
import { formatBytes } from '@/components/file-dialog/accept';
import { FilterBar } from '@/components/page/filter-bar';
import { ListPage } from '@/components/page/list-page';
import { ConfirmDeleteDialog } from '@/components/soft-delete/confirm-delete-dialog';
import { Badge } from '@/components/ui/badge';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { describeError } from '@/lib/api/describe-error';
import { formatStamp } from '@/lib/format-stamp';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import { ROLE_LABELS } from '../lib/labels';
import { filesQueryOptions, useAfterUpload, useRemoveFile } from '../queries';
import { BinaryUploadDialog } from './binary-upload';
import { NewFileDialog } from './new-file-dialog';
import { UsedBy } from './used-by';

const ROLE_COLOR = { settings: 'info', script: 'primary', router: 'secondary' } as const;

export interface FilesPageProps {
  q: string;
  onSearchChange: (patch: { q?: string | undefined }) => void;
}

/**
 * Daftar berkas draf bundel Country Lock (kit CRUD): nama (tautan ke editor), peran, versi, ukuran, diubah.
 * Cari di klien (maks. 400 berkas, `CL_FILES_MAX`). Tambah berkas teks atau unggah biner; hapus berkas (riwayat revisi
 * tetap tersimpan di server). Halaman dijaga rute minimal `countrylock: edit`.
 */
export function FilesPage({ q, onSearchChange }: FilesPageProps) {
  const stack = useStackNavigation();
  const list = useQuery(filesQueryOptions());
  const remove = useRemoveFile();
  const afterUpload = useAfterUpload();
  const [text, setText] = useUrlSyncedText(q, (value) => onSearchChange({ q: value || undefined }));
  const [newOpen, setNewOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ClFileDto | null>(null);

  const live = (list.data ?? []).filter((file) => !file.removed);
  const needle = text.trim().toLowerCase();
  const visible = live.filter((file) => needle === '' || file.path.toLowerCase().includes(needle));
  const filtered = needle !== '';
  const open = (id: string) =>
    stack.push({ to: '/countrylock/files/$fileId', params: { fileId: id } });

  const columns: DataColumn<ClFileDto>[] = [
    {
      id: 'path',
      header: 'Nama berkas',
      mobile: 'title',
      cell: (file) => (
        <span className="flex flex-col">
          <LinkCell to="/countrylock/files/$fileId" params={{ fileId: file.id }}>
            {file.path}
          </LinkCell>
          {file.role === 'settings' ? (
            <span className="text-xs text-muted-foreground">
              Wajib ada; diubah lewat Pengaturan Router, tidak dapat dihapus.
            </span>
          ) : null}
          <UsedBy file={file} />
        </span>
      ),
    },
    {
      id: 'role',
      header: 'Peran',
      mobile: 'badge',
      cell: (file) => (
        <Badge variant="soft" color={ROLE_COLOR[file.role]}>
          {ROLE_LABELS[file.role]}
        </Badge>
      ),
    },
    { id: 'rev', header: 'Versi', align: 'right', cell: (file) => `Revisi ${file.headRev}` },
    { id: 'size', header: 'Ukuran', align: 'right', cell: (file) => formatBytes(file.size) },
    {
      id: 'updated',
      header: 'Diubah',
      className: 'text-sm text-muted-foreground',
      cell: (file) => `${formatStamp(file.updatedAt)} oleh ${file.updatedBy}`,
    },
  ];
  const actions = (file: ClFileDto): RowAction[] => [
    {
      id: 'delete',
      action: 'delete',
      label: `Hapus ${file.path}`,
      shortLabel: 'Hapus',
      // settings.json wajib ada (bundel tidak dapat terbit tanpanya); editor berkas juga menyembunyikannya.
      hidden: file.role === 'settings',
      busy: remove.isPending && remove.variables === file.id,
      disabled: remove.isPending,
      onSelect: () => setDeleteTarget(file),
    },
  ];

  const confirmDelete = () => {
    const target = deleteTarget;
    if (!target) return;
    remove.mutate(target.id, {
      onSuccess: () => toast.success(`${target.path} dihapus`),
      onError: (error) => toast.error(describeError(error)),
      onSettled: () => setDeleteTarget(null),
    });
  };

  return (
    <>
      <ListPage
        title="Berkas Country Lock"
        count={
          list.isSuccess && (visible.length > 0 || filtered)
            ? `${visible.length} berkas`
            : undefined
        }
        createAction={{ label: 'Tambah berkas teks', onClick: () => setNewOpen(true) }}
        actions={
          <ActionButton
            action="upload"
            label="Unggah berkas biner"
            onClick={() => setUploadOpen(true)}
          />
        }
        filters={
          <FilterBar
            search={{
              value: text,
              onChange: setText,
              placeholder: 'Cari nama berkas',
              label: 'Cari berkas',
            }}
          />
        }
      >
        <p className="mb-3 text-sm text-muted-foreground">
          Draf bundel: setiap Simpan menambah satu revisi. Bundel baru dibuat lewat Terbitkan di
          halaman Bundel Country Lock.
        </p>
        <DataTable
          rows={visible}
          rowKey={(file) => file.id}
          columns={columns}
          label="Daftar berkas Country Lock"
          rowTo={(file) => ({ to: '/countrylock/files/$fileId', params: { fileId: file.id } })}
          selectLabel={(file) => file.path}
          actions={actions}
          empty="Belum ada berkas."
          filtered={filtered}
          onClearFilters={() => {
            setText('');
            onSearchChange({ q: undefined });
          }}
          isLoading={list.isPending}
          isError={list.isLoadingError}
          onRetry={() => void list.refetch()}
        />
      </ListPage>
      <NewFileDialog open={newOpen} onOpenChange={setNewOpen} onCreated={(file) => open(file.id)} />
      <BinaryUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={(file) => {
          afterUpload(file);
          open(file.id);
        }}
      />
      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null);
        }}
        count={1}
        subject={deleteTarget ? `berkas ${deleteTarget.path}` : 'berkas'}
        permanent
        usage="Riwayat revisinya tetap tersimpan di server; berkas dapat dibuat lagi dengan nama yang sama. Bundel yang sudah terbit tidak terpengaruh."
        onConfirm={confirmDelete}
        busy={remove.isPending}
      />
    </>
  );
}
