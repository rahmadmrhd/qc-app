import { MAX_IMAGE_BYTES } from '@shared/files';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { ActionButton } from '@/components/action-button';
import {
  FileDialog,
  FileDropZone,
  type LibraryItem,
  type LibraryQuery,
  type LibrarySort,
  LibraryTab,
  PreviewDialog,
} from '@/components/file-dialog';
import { FilterBar, FilterChip } from '@/components/page/filter-bar';
import { ListPage } from '@/components/page/list-page';
import { Select } from '@/components/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { stickerGuideSource } from '../lib/guide-source';

interface UploadDialogState {
  open: boolean;
  files: File[];
  rejected: { name: string; reason: string }[];
}

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
 * `item: edit` halaman hanya dapat dibaca.
 */
export function GuideLibraryPage({ canUpload }: { canUpload: boolean }) {
  const queryClient = useQueryClient();
  const source = stickerGuideSource;
  const [upload, setUpload] = useState<UploadDialogState>(CLOSED);
  const [preview, setPreview] = useState<LibraryItem | null>(null);
  const [query, setQuery] = useState<LibraryQuery>({
    search: '',
    sort: 'newest',
    mine: false,
    unused: false,
  });

  function refresh() {
    return queryClient.invalidateQueries({ queryKey: [source.key] });
  }

  function handleFiles(files: File[], rejected: { name: string; reason: string }[]) {
    if (!canUpload) {
      toast.error('Anda tidak memiliki izin untuk mengunggah gambar');
      return;
    }
    if (files.length > 0 || rejected.length > 0) setUpload({ open: true, files, rejected });
  }

  const sortLabel = SORT_OPTIONS.find((option) => option.value === query.sort)?.label;

  return (
    <>
      {/* Zona seret-lepas mencakup seluruh halaman; dialog di luarnya agar drop di dalam dialog tidak menggelembung ke sini. */}
      <FileDropZone accept={source.mimeTypes} onFiles={handleFiles}>
        <ListPage
          title="Pustaka Gambar"
          actions={
            canUpload ? (
              <ActionButton
                action="upload"
                label="Unggah gambar"
                onClick={() => setUpload({ open: true, files: [], rejected: [] })}
              />
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
          <LibraryTab
            source={source}
            selection={new Map()}
            mode="multiple"
            selectable={false}
            accept={source.mimeTypes}
            query={query}
            onToggle={() => undefined}
            onPreview={setPreview}
            dropZone={false}
            onFiles={handleFiles}
          />
        </ListPage>
      </FileDropZone>
      {canUpload ? (
        <FileDialog
          open={upload.open}
          onOpenChange={(open) => {
            if (open) return;
            setUpload(CLOSED);
            // Sebagian berkas mungkin sudah terunggah walau dialog ditutup sebelum selesai.
            void refresh();
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
          onSelect={(items) => {
            void refresh();
            toast.success(`${items.length} gambar ditambahkan`);
          }}
        />
      ) : null}
      <PreviewDialog item={preview} onClose={() => setPreview(null)} />
    </>
  );
}

function ToggleFilter({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      <Label htmlFor={id} className="text-sm font-normal">
        {label}
      </Label>
    </div>
  );
}
