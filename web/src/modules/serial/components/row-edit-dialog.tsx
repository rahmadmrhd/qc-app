import {
  isIsoDate,
  normalizeSerial,
  SERIAL_LIMITS,
  SERIAL_PROOF_LIMITS,
  serialProblem,
} from '@shared/serials';
import { Camera } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { StagingRow, StagingSticker } from '../lib/draft';
import { mergeProofPhotos, type ProofPhotoRef } from '../lib/proof-source';
import type { StampPreviewInput } from '../lib/stamp-preview';
import { discardProofPhotos } from '../queries';
import { ItemBuField, type ItemBuValue } from './item-bu-field';
import { ProofPhotoDialog } from './proof-photo-dialog';
import { ProofPhotoGrid } from './proof-photo-grid';
import { SerialLocationField } from './serial-location-field';
import { SerialNoteField } from './serial-note-field';
import { defaultStickerChoice, StickerChecklist, useApplicableStickers } from './sticker-checklist';

export interface RowEditResult {
  serial: string;
  item: ItemBuValue;
  location: { id: string; label: string };
  testDate: string;
  sample: boolean;
  note: string;
  stickers: StagingSticker[];
  proofPhotos: ProofPhotoRef[];
}

export interface RowEditDialogProps {
  row: StagingRow;
  /** Serial baru (ternormalisasi); mengembalikan pesan galat bila ditolak (mis. sudah ada di tabel). */
  commitSerial(serial: string): string | null;
  onClose(): void;
  onApply(result: RowEditResult): void;
  /** Nama pelaku untuk pratinjau cap di kamera foto; kosong = tanpa pratinjau cap. */
  actorName?: string;
}

/**
 * Dialog "Ubah baris": semua kolom satu baris dalam satu kolom form (serial, item dan BU, lokasi, tanggal uji, sample,
 * catatan, stiker, foto). Dibuka dari kartu (ponsel) atau tombol Detail (tabel). Perubahan baru berlaku saat
 * "Terapkan"; foto yang ditambahkan lalu dibatalkan dibuang di server, dan foto lama yang dibuang baru dihapus di server
 * saat "Terapkan" (jadi Batal tidak meninggalkan baris dengan rujukan foto yang sudah hilang).
 */
export function RowEditDialog({
  row,
  commitSerial,
  onClose,
  onApply,
  actorName = '',
}: RowEditDialogProps) {
  const [serial, setSerial] = useState(row.serial);
  const [serialError, setSerialError] = useState<string | null>(null);
  const [item, setItem] = useState<ItemBuValue>({
    itemId: row.itemId,
    itemLabel: row.itemLabel,
    buId: row.buId,
    buLabel: row.buLabel,
    proofMin: row.proofMin ?? 0,
  });
  const [location, setLocation] = useState({ id: row.locationId, label: row.locationLabel });
  const [testDate, setTestDate] = useState(row.testDate);
  const [sample, setSample] = useState(row.sample);
  const [note, setNote] = useState(row.note);
  // Jumlah per stiker yang tercentang; stiker yang tak ada di peta = tak dicentang.
  const [chosen, setChosen] = useState<Map<string, number> | null>(() =>
    row.stickers === null ? null : new Map(row.stickers.map((s) => [s.stickerId, s.qty])),
  );
  const { options, state, loaded } = useApplicableStickers(item.itemId, item.buId);

  const [photos, setPhotos] = useState<ProofPhotoRef[]>(row.proofPhotos);
  const [photoOpen, setPhotoOpen] = useState(false);
  // Foto yang ditambahkan selama dialog terbuka (dibuang bila tidak jadi) dan foto lama yang dibuang (dihapus saat Terapkan).
  const addedRef = useRef(new Set<string>());
  const removedRef = useRef(new Set<string>());
  const settledRef = useRef(false);

  // Dialog dilepas (Batal, Esc, atau induk berhenti merendernya) tanpa Terapkan: foto yang baru diunggah dibuang.
  // Penanda diturunkan lagi di setup efek: StrictMode (dev) memasang ulang efek, dan cleanup simulasinya tidak boleh
  // meninggalkan penanda "selesai" yang membuat Batal tidak membuang foto.
  useEffect(() => {
    settledRef.current = false;
    return () => {
      if (settledRef.current) return;
      settledRef.current = true;
      void discardProofPhotos([...addedRef.current]);
    };
  }, []);

  function close() {
    if (!settledRef.current) {
      settledRef.current = true;
      void discardProofPhotos([...addedRef.current]);
    }
    onClose();
  }

  // Item/BU diganti: pilihan lama tidak berlaku lagi, kembali ke bawaan (semua tercentang).
  function changeItem(next: ItemBuValue) {
    if (next.itemId !== item.itemId || next.buId !== item.buId) setChosen(null);
    setItem(next);
  }

  // Bawaan (belum ada pilihan eksplisit): semua stiker yang berlaku tercentang dengan jumlah awalnya.
  useEffect(() => {
    if (chosen === null && loaded) setChosen(defaultStickerChoice(options));
  }, [chosen, loaded, options]);

  const current = chosen ?? new Map<string, number>();
  const normalizedSerial = normalizeSerial(serial);
  const stamp = useMemo<StampPreviewInput | undefined>(
    () =>
      actorName === ''
        ? undefined
        : {
            serial: normalizedSerial,
            itemLabel: item.itemLabel,
            buLabel: item.buLabel,
            locationLabel: location.label,
            actorName,
            actorTeam: 'QC',
          },
    [normalizedSerial, item.itemLabel, item.buLabel, location.label, actorName],
  );

  const incomplete =
    item.itemId === '' || item.buId === '' || location.id === '' || !isIsoDate(testDate);
  const ready = !incomplete && loaded && chosen !== null && normalizedSerial !== '';
  const room = Math.max(0, SERIAL_PROOF_LIMITS.perEntryMax - photos.length);

  function removePhoto(photo: ProofPhotoRef) {
    if (addedRef.current.has(photo.id)) {
      addedRef.current.delete(photo.id);
      void discardProofPhotos([photo.id]);
    } else {
      removedRef.current.add(photo.id);
    }
    setPhotos((list) => list.filter((entry) => entry.id !== photo.id));
  }

  function addPhotos(added: ProofPhotoRef[]) {
    const { next, extras } = mergeProofPhotos(photos, added, SERIAL_PROOF_LIMITS.perEntryMax);
    if (extras.length > 0) void discardProofPhotos(extras);
    for (const photo of next) {
      if (!row.proofPhotos.some((own) => own.id === photo.id)) addedRef.current.add(photo.id);
    }
    setPhotos(next);
  }

  function apply() {
    if (normalizedSerial !== row.serial) {
      const problem = serialProblem(normalizedSerial);
      const message =
        problem === 'empty'
          ? 'Serial tidak boleh kosong'
          : problem !== null
            ? 'Serial tidak sah'
            : commitSerial(normalizedSerial);
      if (message !== null) {
        setSerialError(message);
        return;
      }
    }
    const stickers: StagingSticker[] = options.flatMap((sticker) => {
      const qty = current.get(sticker.id);
      return qty === undefined ? [] : [{ stickerId: sticker.id, name: sticker.name, qty }];
    });
    settledRef.current = true;
    void discardProofPhotos([...removedRef.current]);
    onApply({
      serial: normalizedSerial,
      item,
      location,
      testDate,
      sample,
      // Catatan yang tak disentuh dikembalikan persis seperti semula (tanpa pangkas atau normalisasi diam-diam).
      note: note === row.note ? row.note : note.trim(),
      stickers,
      proofPhotos: photos,
    });
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && close()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Ubah baris {row.serial}</DialogTitle>
            <DialogDescription>
              Serial, item, lokasi, stiker, dan foto bukti baris ini. Stok stiker dipotong sebanyak
              jumlah yang dicentang saat disimpan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-serial">Serial baris</Label>
              <Input
                id="edit-serial"
                className="font-mono"
                value={serial}
                aria-invalid={serialError ? true : undefined}
                maxLength={SERIAL_LIMITS.serialMax * 4}
                onChange={(event) => {
                  setSerial(event.target.value);
                  setSerialError(null);
                }}
              />
              {serialError ? (
                <p role="alert" className="text-xs text-destructive">
                  {serialError}
                </p>
              ) : null}
            </div>
            <ItemBuField
              idPrefix="detail"
              label="Item baris"
              buFieldLabel="Business Unit baris"
              value={item}
              onChange={changeItem}
            />
            <SerialLocationField
              id="detail-location"
              label="Lokasi baris"
              value={location.id}
              valueLabel={location.label}
              onChange={(id, label) => setLocation({ id, label })}
            />
            <div className="space-y-1.5">
              <Label htmlFor="edit-date">Tanggal uji baris</Label>
              <Input
                id="edit-date"
                type="date"
                value={testDate}
                onChange={(event) => setTestDate(event.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-sample"
                checked={sample}
                onCheckedChange={(on) => setSample(on === true)}
              />
              <Label htmlFor="edit-sample">Sample</Label>
            </div>
            <SerialNoteField id="edit-note" label="Catatan baris" value={note} onChange={setNote} />
            <StickerChecklist
              idPrefix="detail"
              state={state}
              options={options}
              chosen={current}
              onChange={setChosen}
            />
            <div className="space-y-2">
              <p className="text-sm font-medium">Foto bukti ({photos.length})</p>
              <ProofPhotoGrid photos={photos} onRemove={removePhoto} label={row.serial} />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={room === 0}
                  onClick={() => setPhotoOpen(true)}
                >
                  <Camera aria-hidden />
                  Tambah foto
                </Button>
                {room === 0 ? (
                  <span className="text-xs text-muted-foreground">
                    Batas {SERIAL_PROOF_LIMITS.perEntryMax} foto tercapai.
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Batal
            </Button>
            <Button type="button" disabled={!ready} onClick={apply}>
              Terapkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ProofPhotoDialog
        open={photoOpen}
        onOpenChange={setPhotoOpen}
        existingCount={photos.length}
        max={SERIAL_PROOF_LIMITS.perEntryMax}
        stamp={stamp}
        onAdd={addPhotos}
      />
    </>
  );
}
