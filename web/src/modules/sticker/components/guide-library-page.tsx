import { MAX_IMAGE_BYTES } from '@shared/files';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ActionButton } from '@/components/action-button';
import { BulkBar, useBulkAction, useRowSelection } from '@/components/data-table';
import {
  AttachmentView,
  FileDialog,
  FileDropZone,
  type LibraryItem,
  type LibraryQuery,
  type LibrarySort,
  LibraryTab,
  libraryItemToAttachment,
  PreviewDialog,
} from '@/components/file-dialog';
import { useBackgroundUploads } from '@/components/file-dialog/use-background-uploads';
import { FilterBar, FilterChip } from '@/components/page/filter-bar';
import { useChipDraft } from '@/components/page/filter-draft';
import { ListPage } from '@/components/page/list-page';
import { Select } from '@/components/select';
import { ConfirmDeleteDialog } from '@/components/soft-delete/confirm-delete-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { stickerGuideSource } from '../lib/guide-source';

interface UploadDialogState {
  open: boolean;
  files: File[];
  rejected: { name: string; reason: string }[];
}

const OWNER = 'guides';
const CLOSED: UploadDialogState = { open: false, files: [], rejected: [] };

const SORT_OPTIONS: ReadonlyArray<{ value: LibrarySort; label: string }> = [
  { value: 'newest', label: 'Terbaru' },
  { value: 'oldest', label: 'Terlama' },
  { value: 'nameAsc', label: 'Nama A-Z' },
  { value: 'nameDesc', label: 'Nama Z-A' },
  { value: 'sizeDesc', label: 'Ukuran terbesar' },
  { value: 'usageDesc', label: 'Paling sering dipakai' },
];

/**
 * Halaman Pustaka Gambar (gambar acuan penempelan stiker pada item): kisi pustaka di kerangka `ListPage` dengan
 * cari/urut/filter di `FilterBar`, ganti nama dan hapus lewat kartu, serta unggah lewat tombol atau seret-lepas.
 * Tanpa halaman View: pratinjau dan daftar pemakai tetap di dialog (keputusan pemilik 23). Tanpa izin
 * `item: edit` halaman hanya dapat dibaca. Hapus massal (permanen, Pustaka tanpa soft delete) hanya bila rute
 * memberi `onRemoveBatch`; hanya gambar yang boleh dihapus pemakai dan belum dipakai item yang dapat dipilih.
 */
export const DEFAULT_LIBRARY_QUERY: LibraryQuery = {
  search: '',
  sort: 'newest',
  mine: false,
  unused: false,
};

/**
 * `query`/`onQueryChange` opsional: rute memberi search params Router supaya cari/urut/filter bertahan saat Back atau
 * muat ulang dan dapat dibagikan lewat URL (spek §6.5); tanpa keduanya halaman memakai state lokal.
 */
export function GuideLibraryPage({
  canUpload,
  query: controlled,
  onQueryChange,
  onRemoveBatch,
}: {
  canUpload: boolean;
  query?: LibraryQuery;
  onQueryChange?: (query: LibraryQuery) => void;
  /** Menghapus permanen satu tahap gambar (maks. 100 id) dan mengembalikan hasil server per id. */
  onRemoveBatch?: (ids: string[]) => Promise<readonly unknown[]>;
}) {
  const queryClient = useQueryClient();
  const source = stickerGuideSource;
  const [upload, setUpload] = useState<UploadDialogState>(CLOSED);
  const [preview, setPreview] = useState<LibraryItem | null>(null);
  // Unggahan berjalan di latar (progres tampil di halaman); tiap yang selesai langsung memuat ulang kisi.
  const done = useRef(0);
  const uploads = useBackgroundUploads({
    source,
    onUploaded: () => {
      done.current += 1;
      void refresh();
    },
  });
  const own = uploads.forOwner(OWNER);
  const [local, setLocal] = useState<LibraryQuery>(DEFAULT_LIBRARY_QUERY);
  const query = controlled ?? local;
  const setQuery = (update: (current: LibraryQuery) => LibraryQuery) => {
    const next = update(query);
    setLocal(next);
    onQueryChange?.(next);
  };

  function refresh() {
    return queryClient.invalidateQueries({ queryKey: [source.key] });
  }

  // Pilihan dikosongkan tiap cari/urut/filter berubah agar aksi massal tak mengenai gambar yang tak terlihat.
  const selection = useRowSelection(JSON.stringify(query));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = useBulkAction({
    selection,
    subject: 'gambar',
    verb: 'dihapus',
    send: (ids) => onRemoveBatch?.(ids) ?? Promise.resolve([]),
    reload: () => void refresh(),
  });

  // Antrean habis (yang gagal tak dihitung): satu toast untuk semua yang berhasil.
  const busy = own.busy;
  useEffect(() => {
    if (busy || done.current === 0) return;
    toast.success(`${done.current} gambar ditambahkan`);
    done.current = 0;
  }, [busy]);

  function handleFiles(files: File[], rejected: { name: string; reason: string }[]) {
    if (!canUpload) {
      toast.error('Anda tidak memiliki izin untuk mengunggah gambar');
      return;
    }
    if (files.length > 0 || rejected.length > 0) setUpload({ open: true, files, rejected });
  }

  const [loaded, setLoaded] = useState<{ count: number | null; more: boolean }>({
    count: null,
    more: false,
  });
  const handleCount = useCallback(
    (count: number | null, more: boolean) => setLoaded({ count, more }),
    [],
  );
  const filtered = query.search !== '' || query.mine || query.unused;
  const countLabel =
    loaded.count !== null && (loaded.count > 0 || filtered)
      ? `${loaded.count}${loaded.more ? '+' : ''} gambar`
      : undefined;

  const sortLabel = SORT_OPTIONS.find((option) => option.value === query.sort)?.label;

  return (
    <>
      {/* Zona seret-lepas mencakup seluruh halaman; dialog di luarnya agar drop di dalam dialog tidak menggelembung ke sini. */}
      <FileDropZone accept={source.mimeTypes} onFiles={handleFiles}>
        <ListPage
          title="Pustaka Gambar"
          count={countLabel}
          createAction={
            canUpload
              ? {
                  kind: 'upload',
                  label: 'Unggah gambar',
                  onClick: () => setUpload({ open: true, files: [], rejected: [] }),
                }
              : undefined
          }
          bulkBar={
            onRemoveBatch ? (
              <BulkBar count={selection.count} onClear={selection.clear} busy={remove.busy}>
                <ActionButton action="delete" onClick={() => setConfirmDelete(true)} />
              </BulkBar>
            ) : null
          }
          filters={
            <FilterBar
              search={{
                value: query.search,
                onChange: (search) => setQuery((current) => ({ ...current, search })),
                placeholder: 'Cari nama gambar',
                label: 'Cari gambar',
              }}
            >
              <FilterChip
                label="Urut"
                display={query.sort === 'newest' ? null : sortLabel}
                onClear={() => setQuery((current) => ({ ...current, sort: 'newest' }))}
              >
                <Select
                  id="library-page-sort"
                  label="Urutkan"
                  hideLabel
                  options={SORT_OPTIONS}
                  value={query.sort}
                  onValueChange={(next) =>
                    setQuery((current) => ({ ...current, sort: next as LibrarySort }))
                  }
                />
              </FilterChip>
              <FilterChip
                label="Diunggah oleh saya"
                display={query.mine ? 'Ya' : null}
                onClear={() => setQuery((current) => ({ ...current, mine: false }))}
              >
                <ToggleFilter
                  label="Hanya yang saya unggah"
                  checked={query.mine}
                  onChange={(mine) => setQuery((current) => ({ ...current, mine }))}
                />
              </FilterChip>
              <FilterChip
                label="Belum dipakai"
                display={query.unused ? 'Ya' : null}
                onClear={() => setQuery((current) => ({ ...current, unused: false }))}
              >
                <ToggleFilter
                  label="Hanya yang belum dipakai"
                  checked={query.unused}
                  onChange={(unused) => setQuery((current) => ({ ...current, unused }))}
                />
              </FilterChip>
            </FilterBar>
          }
        >
          <p className="mb-3 text-sm text-muted-foreground">
            Gambar acuan penempelan stiker pada item. Seret berkas ke halaman ini untuk mengunggah.
          </p>
          <AttachmentView
            items={[]}
            pending={own.entries}
            layout="list"
            label="unggahan gambar"
            onRetry={own.retry}
            onCancel={own.remove}
          />
          <LibraryTab
            source={source}
            selection={new Map()}
            mode="multiple"
            selectable={false}
            accept={source.mimeTypes}
            query={query}
            onToggle={() => undefined}
            onPreview={setPreview}
            onCountChange={handleCount}
            onClearFilters={() =>
              setQuery((current) => ({ ...current, search: '', mine: false, unused: false }))
            }
            dropZone={false}
            onFiles={handleFiles}
            {...(onRemoveBatch ? { bulk: selection } : {})}
          />
        </ListPage>
      </FileDropZone>
      {canUpload && upload.open ? (
        <FileDialog
          open
          onOpenChange={(open) => {
            if (!open) setUpload(CLOSED);
          }}
          source={source}
          mode="multiple"
          accept={['image']}
          maxBytes={MAX_IMAGE_BYTES}
          initialFiles={upload.files.length > 0 ? upload.files : undefined}
          initialRejected={upload.rejected.length > 0 ? upload.rejected : undefined}
          showLibrary={false}
          confirmLabel="Unggah"
          title="Unggah gambar"
          onConfirm={(result) => own.add(result.files)}
        />
      ) : null}
      <ConfirmDeleteDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        count={selection.count}
        subject="gambar"
        permanent
        busy={remove.busy}
        onConfirm={() => {
          // Daftar dimuat ulang eksplisit setelah selesai: tidak bergantung pada invalidasi mutasi rute.
          void remove.run().then(() => {
            void refresh();
            setConfirmDelete(false);
          });
        }}
      />
      <PreviewDialog
        item={preview ? libraryItemToAttachment(preview) : null}
        onClose={() => setPreview(null)}
      />
    </>
  );
}

function ToggleFilter({
  label,
  checked: applied,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  // Di dalam chip centang ditahan sebagai draf dan diterapkan saat chip menutup (R8).
  const [checked, setChecked] = useChipDraft<boolean>(applied, onChange);
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => setChecked(value === true)} />
      <Label htmlFor={id} className="text-sm font-normal">
        {label}
      </Label>
    </div>
  );
}
