import type { ItemStickerMarkDto, StickerDto, StickerTypeDto } from '@shared/contract';
import { MAX_IMAGE_BYTES } from '@shared/files';
import { normalizeKey } from '@shared/items';
import { INSTRUCTION_LIMITS } from '@shared/stickers';
import { ArrowDown, ArrowUp, ImagePlus, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  AttachmentView,
  FileDialog,
  FileDropZone,
  type LibraryItem,
} from '@/components/file-dialog';
import { useBackgroundUploads } from '@/components/file-dialog/use-background-uploads';
import { LinkField, type LinkOption } from '@/components/link-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { guidePreviewUrl, stickerGuideSource } from '@/modules/sticker/lib/guide-source';
import { groupInstructionErrors, moveEntry } from '../lib/sticker-instructions';
import type { ItemFormInput } from '../schemas';
import { CopyMarksDialog } from './copy-marks-dialog';
import { MarkRow } from './mark-row';
import { MarkerCanvas } from './marker-canvas';

type Photo = ItemFormInput['stickerPhotos'][number];

/** Gambar pustaka yang dikenal bagian ini: nama dan dimensi (rasio kanvas). */
export interface GuideInfo {
  id: string;
  name: string;
  width: number;
  height: number;
}

export interface StickerInstructionsFieldProps {
  value: ItemFormInput['stickerPhotos'];
  onChange: (photos: ItemFormInput['stickerPhotos']) => void;
  /** BU item yang sedang dipilih di form: pilihan label BU foto. Label yang BU-nya dilepas dikosongkan otomatis. */
  businessUnits: readonly { id: string; label: string }[];
  /** Katalog stiker dan jenis (sumber pilihan sasaran penanda dan label tersimpan). */
  stickers: readonly StickerDto[];
  types: readonly StickerTypeDto[];
  /** Gambar yang sudah diketahui (mis. dari item yang diubah); yang dipilih dari dialog dicatat sendiri. */
  knownGuides?: readonly GuideInfo[];
  /** Item yang sedang diubah: tidak ditawarkan sebagai sumber salin penanda. */
  currentItemId?: string | undefined;
  /**
   * Membuka pembuatan stiker/jenis baru (hanya bila user berhak). `onCreated` dipanggil dengan hasilnya agar langsung
   * terpilih pada penanda yang memintanya. Dialognya milik pemanggil (di luar `<form>`).
   */
  onCreateSticker?: (onCreated: (sticker: StickerDto) => void) => void;
  onCreateType?: (onCreated: (type: StickerTypeDto) => void) => void;
  /** Pesan galat bagian ini (skema form dan server); yang bernomor ("Foto N: …") tampil pada foto/penandanya. */
  errors?: readonly string[];
  /** Dipanggil saat ada foto yang menunggu/sedang diunggah (form menahan Simpan selama itu). */
  onBusyChange?: ((busy: boolean) => void) | undefined;
}

interface DialogState {
  open: boolean;
  files: File[];
  rejected: { name: string; reason: string }[];
}

const CLOSED: DialogState = { open: false, files: [], rejected: [] };
/** Penanda baru dari tombol (papan ketik): posisi tengah foto. */
const CENTER = { x: 500, y: 500 } as const;
const BU_OPTION_LIMIT = 30;
const UPLOAD_OWNER = 'guides';

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const emptyMark = (point: { x: number; y: number }): ItemStickerMarkDto => ({
  x: point.x,
  y: point.y,
  target: { kind: 'sticker', stickerId: '' },
  note: '',
});

/**
 * Bagian "Instruksi stiker" form item: foto dari pustaka gambar stiker, tiap foto dengan catatan, label BU, urutan,
 * dan penanda posisi (kanvas + baris penanda). Foto baru dari dialog berkas (Tambah foto atau seret-lepas); gambar yang
 * sudah dipakai item lain menawarkan salin penanda.
 */
export function StickerInstructionsField({
  value,
  onChange,
  businessUnits,
  stickers,
  types,
  knownGuides = [],
  currentItemId,
  onCreateSticker,
  onCreateType,
  errors = [],
  onBusyChange,
}: StickerInstructionsFieldProps) {
  // Nilai terbaru (tahan balapan dengan dialog/permintaan async): dibaca ulang saat callback async berjalan.
  const valueRef = useRef(value);
  valueRef.current = value;
  const commit = (next: Photo[]) => {
    valueRef.current = next;
    onChange(next);
  };
  const [addedGuides, setAddedGuides] = useState<Readonly<Record<string, GuideInfo>>>({});
  const [dialog, setDialog] = useState<DialogState>(CLOSED);
  const [copyQueue, setCopyQueue] = useState<{ id: string; name: string }[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const grouped = groupInstructionErrors(errors);
  // Unggahan latar milik field ini (pemegang nilainya): dibatalkan otomatis saat field dilepas. Hasil sukses langsung
  // menjadi foto (lewat `addSelected`); yang ditolak (kembar/penuh) tetap berada di pustaka karena sumbernya tanpa `onDiscard`.
  const uploads = useBackgroundUploads({
    source: stickerGuideSource,
    onUploaded: (_owner, item) => addSelected([item]) > 0,
  });
  const own = uploads.forOwner(UPLOAD_OWNER);
  // Unggahan yang menunggu/berjalan sudah mengisi kuota; yang gagal tidak.
  const reserved = own.entries.filter((entry) => entry.phase !== 'failed').length;
  const full = value.length + reserved >= INSTRUCTION_LIMITS.photos;
  const busy = own.blocking;
  const onBusyChangeRef = useRef(onBusyChange);
  onBusyChangeRef.current = onBusyChange;
  useEffect(() => {
    onBusyChangeRef.current?.(busy);
    return () => onBusyChangeRef.current?.(false);
  }, [busy]);

  const guideOf = (id: string): GuideInfo =>
    addedGuides[id] ??
    knownGuides.find((guide) => guide.id === id) ?? { id, name: 'Gambar', width: 0, height: 0 };

  // Label BU foto yang BU-nya dilepas dari item dikosongkan (label harus salah satu BU item).
  const buKey = businessUnits.map((bu) => bu.id).join('|');
  // biome-ignore lint/correctness/useExhaustiveDependencies: `commit` memakai ref dan `onChange` terbaru; efek hanya bila BU atau foto berubah
  useEffect(() => {
    const ids = new Set(businessUnits.map((bu) => bu.id));
    const current = valueRef.current;
    if (current.some((photo) => photo.buId !== null && !ids.has(photo.buId))) {
      commit(
        current.map((photo) =>
          photo.buId !== null && !ids.has(photo.buId) ? { ...photo, buId: null } : photo,
        ),
      );
    }
  }, [buKey, value]);

  function openDialog(files: File[], rejected: { name: string; reason: string }[]) {
    if (full) {
      setNotice(`Batas ${INSTRUCTION_LIMITS.photos} foto instruksi tercapai.`);
      return;
    }
    setNotice(null);
    setDialog({ open: true, files, rejected });
  }

  /** Menambah foto dari gambar pustaka; mengembalikan jumlah yang benar-benar ditambahkan. */
  function addSelected(items: LibraryItem[]): number {
    const current = valueRef.current;
    const have = new Set(current.map((photo) => photo.guideId));
    const room = INSTRUCTION_LIMITS.photos - current.length;
    const added: LibraryItem[] = [];
    for (const item of items) {
      if (have.has(item.id) || added.length >= room) continue;
      have.add(item.id);
      added.push(item);
    }
    const skipped = items.length - added.length;
    setNotice(
      skipped > 0
        ? `${skipped} gambar tidak ditambahkan (sudah dipakai pada item ini atau melebihi batas ${INSTRUCTION_LIMITS.photos} foto).`
        : null,
    );
    if (added.length === 0) return 0;
    setAddedGuides((previous) => ({
      ...previous,
      ...Object.fromEntries(
        added.map((item) => [
          item.id,
          { id: item.id, name: item.name, width: item.width, height: item.height },
        ]),
      ),
    }));
    commit([
      ...current,
      ...added.map((item): Photo => ({ guideId: item.id, caption: '', buId: null, marks: [] })),
    ]);
    // Gambar yang sudah dipakai item lain menawarkan salin penanda (satu per satu).
    const reused = added.filter((item) => item.usageCount > 0);
    if (reused.length > 0) {
      setCopyQueue((queue) => [
        ...queue,
        ...reused.map((item) => ({ id: item.id, name: item.name })),
      ]);
    }
    return added.length;
  }

  function updatePhoto(guideId: string, update: (photo: Photo) => Photo) {
    commit(valueRef.current.map((photo) => (photo.guideId === guideId ? update(photo) : photo)));
  }

  function movePhoto(index: number, delta: -1 | 1) {
    commit(moveEntry(valueRef.current, index, index + delta));
  }

  const remaining = Math.max(1, INSTRUCTION_LIMITS.photos - value.length - reserved);
  const copying = copyQueue[0];

  return (
    <>
      <FileDropZone
        accept={stickerGuideSource.mimeTypes}
        onFiles={openDialog}
        className="space-y-3"
      >
        {value.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada foto instruksi.</p>
        ) : null}
        {value.map((photo, index) => (
          <PhotoCard
            key={photo.guideId}
            photo={photo}
            index={index}
            count={value.length}
            guide={guideOf(photo.guideId)}
            businessUnits={businessUnits}
            stickers={stickers}
            types={types}
            photoErrors={grouped.photos.get(index) ?? []}
            markErrors={(markIndex) => grouped.marks.get(`${index}:${markIndex}`) ?? []}
            onUpdate={(update) => updatePhoto(photo.guideId, update)}
            onMove={(delta) => movePhoto(index, delta)}
            onRemove={() => commit(valueRef.current.filter((p) => p.guideId !== photo.guideId))}
            {...(onCreateSticker ? { onCreateSticker } : {})}
            {...(onCreateType ? { onCreateType } : {})}
          />
        ))}
        <AttachmentView
          items={[]}
          pending={own.entries}
          layout="grid"
          label="foto instruksi"
          onRetry={own.retry}
          onCancel={own.remove}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            color="primary"
            size="sm"
            disabled={full}
            onClick={() => openDialog([], [])}
          >
            <ImagePlus />
            Tambah foto
          </Button>
          <span className="text-xs text-muted-foreground">
            {value.length + reserved}/{INSTRUCTION_LIMITS.photos} foto. Seret gambar ke bagian ini
            untuk mengunggah.
          </span>
        </div>
        {notice ? (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        ) : null}
        {grouped.general.map((message) => (
          <p key={message} role="alert" className="text-sm text-destructive-text">
            {message}
          </p>
        ))}
      </FileDropZone>
      {dialog.open ? (
        <FileDialog
          open
          onOpenChange={(open) => {
            if (!open) setDialog(CLOSED);
          }}
          source={stickerGuideSource}
          mode="multiple"
          accept={['image']}
          maxBytes={MAX_IMAGE_BYTES}
          maxFiles={remaining}
          initialFiles={dialog.files.length > 0 ? dialog.files : undefined}
          initialRejected={dialog.rejected.length > 0 ? dialog.rejected : undefined}
          confirmLabel="Tambahkan"
          title="Pilih foto instruksi"
          onConfirm={(result) => {
            addSelected(result.library);
            own.add(result.files);
          }}
        />
      ) : null}
      {copying ? (
        <CopyMarksDialog
          key={copying.id}
          guideId={copying.id}
          guideName={copying.name}
          currentItemId={currentItemId}
          stickers={stickers}
          types={types}
          onCopy={(marks) => {
            updatePhoto(copying.id, (photo) => ({ ...photo, marks }));
            setCopyQueue((queue) => queue.slice(1));
          }}
          onClose={() => setCopyQueue((queue) => queue.slice(1))}
        />
      ) : null}
    </>
  );
}

interface PhotoCardProps {
  photo: Photo;
  /** Urutan foto (mulai 0); nomor tampil = `index + 1`. */
  index: number;
  count: number;
  guide: GuideInfo;
  businessUnits: readonly { id: string; label: string }[];
  stickers: readonly StickerDto[];
  types: readonly StickerTypeDto[];
  photoErrors: readonly string[];
  markErrors: (markIndex: number) => readonly string[];
  onUpdate: (update: (photo: Photo) => Photo) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  onCreateSticker?: (onCreated: (sticker: StickerDto) => void) => void;
  onCreateType?: (onCreated: (type: StickerTypeDto) => void) => void;
}

function PhotoCard({
  photo,
  index,
  count,
  guide,
  businessUnits,
  stickers,
  types,
  photoErrors,
  markErrors,
  onUpdate,
  onMove,
  onRemove,
  onCreateSticker,
  onCreateType,
}: PhotoCardProps) {
  const number = index + 1;
  const [selected, setSelected] = useState<number | null>(null);
  const [buTerm, setBuTerm] = useState('');
  const cardRef = useRef<HTMLFieldSetElement>(null);
  const focusMark = useRef<number | null>(null);
  const markCount = photo.marks.length;

  // Setelah "Tambah penanda": fokus ke pilihan sasaran baris barunya (jalur papan ketik).
  // biome-ignore lint/correctness/useExhaustiveDependencies: hanya bereaksi pada pertambahan jumlah penanda
  useEffect(() => {
    const target = focusMark.current;
    if (target === null) return;
    focusMark.current = null;
    cardRef.current
      ?.querySelector<HTMLElement>(`[data-mark-row="${target}"] input[role="combobox"]`)
      ?.focus();
  }, [markCount]);

  const setMarks = (update: (marks: ItemStickerMarkDto[]) => ItemStickerMarkDto[]) =>
    onUpdate((current) => ({ ...current, marks: update(current.marks) }));

  function addMark(point: { x: number; y: number }, focus: boolean) {
    if (markCount >= INSTRUCTION_LIMITS.marks) return;
    if (focus) focusMark.current = markCount;
    setMarks((marks) =>
      marks.length >= INSTRUCTION_LIMITS.marks ? marks : [...marks, emptyMark(point)],
    );
    setSelected(markCount);
  }

  /**
   * Memasang sasaran baru pada penanda yang meminta pembuatan stiker/jenis. Penanda dikenali lewat identitas objeknya
   * (bukan nomor): objek penanda tak berubah selama dialog pembuatan terbuka, sedangkan nomornya dapat bergeser bila
   * penanda lain dihapus. Bila penanda itu sudah hilang atau diganti (dihapus, disalin ulang), tidak ada yang dipasang.
   */
  function retarget(requester: ItemStickerMarkDto, target: ItemStickerMarkDto['target']) {
    setMarks((marks) => {
      const at = marks.indexOf(requester);
      return at < 0 ? marks : marks.map((m, i) => (i === at ? { ...m, target } : m));
    });
  }

  function removeMark(markIndex: number) {
    setMarks((marks) => marks.filter((_, i) => i !== markIndex));
    setSelected((current) => {
      if (current === null || current === markIndex) return null;
      return current > markIndex ? current - 1 : current;
    });
  }

  const buKey = normalizeKey(buTerm);
  const buOptions: LinkOption[] = businessUnits
    .filter((bu) => buKey === '' || normalizeKey(bu.label).includes(buKey))
    .slice(0, BU_OPTION_LIMIT)
    .map((bu) => ({ id: bu.id, label: bu.label }));
  const captionInvalid = photoErrors.some((message) => /catatan/i.test(message));

  return (
    <fieldset
      ref={cardRef}
      aria-label={`Foto instruksi ${number}`}
      className="m-0 min-w-0 space-y-3 rounded-lg border p-3"
    >
      <div className="flex items-center gap-1">
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">
          Foto {number}: {guide.name}
        </h3>
        <Button
          type="button"
          variant="ghost"
          color="primary"
          size="icon"
          className="size-7"
          aria-label={`Naikkan foto ${number}`}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUp />
        </Button>
        <Button
          type="button"
          variant="ghost"
          color="primary"
          size="icon"
          className="size-7"
          aria-label={`Turunkan foto ${number}`}
          disabled={index === count - 1}
          onClick={() => onMove(1)}
        >
          <ArrowDown />
        </Button>
        <Button
          type="button"
          variant="ghost"
          color="primary"
          size="icon"
          className="size-7"
          aria-label={`Hapus foto ${number}`}
          onClick={onRemove}
        >
          <Trash2 />
        </Button>
      </div>
      <Input
        aria-label={`Catatan foto ${number}`}
        aria-invalid={captionInvalid ? true : undefined}
        placeholder="Catatan foto, mis. bagian belakang kardus"
        value={photo.caption}
        onChange={(event) => {
          const caption = event.target.value;
          onUpdate((current) => ({ ...current, caption }));
        }}
      />
      <LinkField
        id={`photo-${photo.guideId}-bu`}
        label={`Label BU foto ${number}`}
        placeholder="Tanpa label BU"
        value={photo.buId}
        labelOf={(id) => businessUnits.find((bu) => bu.id === id)?.label}
        options={buOptions}
        searchDebounceMs={0}
        onSearchChange={setBuTerm}
        onChange={(buId) => onUpdate((current) => ({ ...current, buId }))}
      />
      {photoErrors.map((message) => (
        <p key={message} role="alert" className="text-sm text-destructive-text">
          {capitalize(message)}
        </p>
      ))}
      <MarkerCanvas
        src={guidePreviewUrl(photo.guideId)}
        width={guide.width}
        height={guide.height}
        marks={photo.marks}
        selected={selected}
        onSelect={setSelected}
        onAdd={(point) => addMark(point, false)}
        onMove={(markIndex, point) =>
          setMarks((marks) =>
            marks.map((mark, i) => (i === markIndex ? { ...mark, x: point.x, y: point.y } : mark)),
          )
        }
      />
      <p className="text-xs text-muted-foreground">
        Ketuk foto untuk menambah penanda dan seret untuk memindahkan. Dengan papan ketik, pakai
        tombol Tambah penanda dan tombol panah pada penanda.
      </p>
      <div className="space-y-2">
        {photo.marks.map((mark, markIndex) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: penanda tak punya id; nomor = urutan
          <div key={markIndex} data-mark-row={markIndex}>
            <MarkRow
              index={markIndex}
              mark={mark}
              stickerOptions={stickers}
              typeOptions={types}
              selected={selected === markIndex}
              onSelect={() => setSelected(markIndex)}
              onChange={(next) =>
                setMarks((marks) => marks.map((m, i) => (i === markIndex ? next : m)))
              }
              onRemove={() => removeMark(markIndex)}
              error={markErrors(markIndex).map(capitalize).join('. ') || undefined}
              {...(onCreateSticker
                ? {
                    onCreateSticker: () =>
                      onCreateSticker((sticker) =>
                        retarget(mark, { kind: 'sticker', stickerId: sticker.id }),
                      ),
                  }
                : {})}
              {...(onCreateType
                ? {
                    onCreateType: () =>
                      onCreateType((type) => retarget(mark, { kind: 'type', typeId: type.id })),
                  }
                : {})}
            />
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        color="primary"
        size="sm"
        aria-label={`Tambah penanda pada foto ${number}`}
        disabled={markCount >= INSTRUCTION_LIMITS.marks}
        onClick={() => addMark(CENTER, true)}
      >
        <Plus />
        Tambah penanda
        <span className="text-xs text-muted-foreground">
          ({markCount}/{INSTRUCTION_LIMITS.marks})
        </span>
      </Button>
    </fieldset>
  );
}
