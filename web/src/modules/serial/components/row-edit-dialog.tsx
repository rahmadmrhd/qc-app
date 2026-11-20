import { MAX_IMAGE_BYTES } from '@shared/files';
import {
  isIsoDate,
  normalizeSerial,
  SERIAL_LIMITS,
  SERIAL_PROOF_LIMITS,
  serialProblem,
} from '@shared/serials';
import { Camera } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AttachDialog, AttachmentView } from '@/components/file-dialog';
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
import { existingProblem, type StagingRow, type StagingSticker } from '../lib/draft';
import { type ProofPhotoRef, proofSource } from '../lib/proof-source';
import type { StampPreviewInput } from '../lib/stamp-preview';
import type { ProofSession } from '../lib/use-proof-uploads';
import { discardProofPhotos } from '../queries';
import { ItemBuField, type ItemBuValue } from './item-bu-field';
import { proofAttachmentItems } from './proof-photo-field';
import { choicesFor, RecheckBuField, useWritableBus } from './recheck-bu-field';
import { SerialLocationField } from './serial-location-field';
import { SerialNoteField } from './serial-note-field';
import { proofCameraStamp } from './stamp-preview';
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
  /** Antrean unggah bersama milik halaman; foto baru dialog ini memakai pemilik sendiri dan baru menempel saat Terapkan. */
  proof: ProofSession;
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
  proof,
  actorName = '',
}: RowEditDialogProps) {
  const [serial, setSerial] = useState(row.serial);
  // Serial hasil inject Country Lock berasal dari perangkat: tidak dapat diubah.
  const serialLocked = row.source === 'countrylock';
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
  const { options, state, loaded } = useApplicableStickers(
    item.itemId,
    item.buId,
    row.existing?.id,
  );
  // Baris Cek ulang (serial sudah tercatat): item dikunci ke catatan, BU dibatasi, Sample tidak berlaku.
  const existing = row.existing;
  const { bus, loading: busLoading } = useWritableBus();
  const buChoices = useMemo(
    () =>
      existing
        ? choicesFor(existing.recheckBuIds, bus, [{ id: existing.buId, code: existing.buCode }])
        : [],
    [existing, bus],
  );
  const blocked = existingProblem(row);

  const [photos, setPhotos] = useState<ProofPhotoRef[]>(row.proofPhotos);
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const [photoOpen, setPhotoOpen] = useState(false);
  // Foto baru dialog ini diunggah di latar dengan pemilik sendiri (bukan baris: Batal harus membuangnya).
  const ownerId = `edit:${row.clientId}`;
  const proofRef = useRef(proof);
  proofRef.current = proof;
  const own = proof.uploads.forOwner(ownerId);
  const running = own.entries.filter((entry) => entry.phase !== 'failed').length;
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
      proofRef.current.uploads.cancelOwner(ownerId);
      if (settledRef.current) return;
      settledRef.current = true;
      void discardProofPhotos([...addedRef.current]);
    };
  }, [ownerId]);

  // Foto selesai milik dialog ini masuk ke daftar dialog (dan dicatat sebagai baru); penuh = ditolak dan dibuang.
  useEffect(
    () =>
      proofRef.current.attach(ownerId, (photo) => {
        if (photosRef.current.length >= SERIAL_PROOF_LIMITS.perEntryMax) return false;
        addedRef.current.add(photo.id);
        setPhotos([...photosRef.current, photo]);
        return true;
      }),
    [ownerId],
  );

  function close() {
    proofRef.current.uploads.cancelOwner(ownerId);
    if (!settledRef.current) {
      settledRef.current = true;
      void discardProofPhotos([...addedRef.current]);
    }
    onClose();
  }

  // Item/BU diganti: pilihan lama tidak berlaku lagi, kembali ke bawaan (semua tercentang).
  // Baris Cek ulang: stiker bawaan KOSONG (pengguna mencentang yang ditempel lagi), bukan semua yang berlaku.
  function changeItem(next: ItemBuValue) {
    if (next.itemId !== item.itemId || next.buId !== item.buId) {
      setChosen(existing ? new Map() : null);
    }
    setItem(next);
  }

  // Bawaan (belum ada pilihan eksplisit): semua stiker yang berlaku tercentang dengan jumlah awalnya.
  useEffect(() => {
    if (chosen === null && loaded) setChosen(existing ? new Map() : defaultStickerChoice(options));
  }, [chosen, loaded, options, existing]);

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

  const buAllowed = !existing || buChoices.some((bu) => bu.id === item.buId);
  const incomplete =
    item.itemId === '' ||
    item.buId === '' ||
    !buAllowed ||
    location.id === '' ||
    !isIsoDate(testDate);
  // Baris Cek ulang tidak menunggu daftar stiker: item catatan bisa saja tak terlihat/nonaktif bagi pengguna (daftar
  // stiker gagal dimuat), padahal cek ulang tetap sah; stiker bawaan kosong dan dapat dibiarkan.
  const ready =
    !incomplete &&
    (loaded || existing !== undefined) &&
    chosen !== null &&
    normalizedSerial !== '' &&
    blocked === null &&
    running === 0;
  const room = Math.max(0, SERIAL_PROOF_LIMITS.perEntryMax - photos.length - running);
  const items = useMemo(() => proofAttachmentItems(photos, row.serial), [photos, row.serial]);

  function removePhoto(id: string) {
    if (addedRef.current.has(id)) {
      addedRef.current.delete(id);
      void discardProofPhotos([id]);
    } else {
      removedRef.current.add(id);
    }
    setPhotos((list) => list.filter((entry) => entry.id !== id));
  }

  function apply() {
    if (!serialLocked && normalizedSerial !== row.serial) {
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
    const computed: StagingSticker[] = options.flatMap((sticker) => {
      const qty = current.get(sticker.id);
      return qty === undefined ? [] : [{ stickerId: sticker.id, name: sticker.name, qty }];
    });
    // Cek ulang dengan daftar stiker yang tak termuat: pilihan lama baris dipertahankan selama BU-nya tak diganti.
    const stickers =
      existing && !loaded ? (item.buId === row.buId ? (row.stickers ?? []) : []) : computed;
    settledRef.current = true;
    // Unggahan yang gagal (tak ada di server) dibuang; yang berjalan sudah menahan Terapkan.
    proofRef.current.uploads.cancelOwner(ownerId);
    void discardProofPhotos([...removedRef.current]);
    onApply({
      serial: serialLocked ? row.serial : normalizedSerial,
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
                readOnly={existing !== undefined}
                disabled={serialLocked}
                aria-invalid={serialError ? true : undefined}
                maxLength={SERIAL_LIMITS.serialMax * 4}
                onChange={(event) => {
                  setSerial(event.target.value);
                  setSerialError(null);
                }}
              />
              {serialLocked ? (
                <p className="text-xs text-muted-foreground">
                  Serial dari perangkat, tidak dapat diubah.
                </p>
              ) : null}
              {serialError ? (
                <p role="alert" className="text-xs text-destructive">
                  {serialError}
                </p>
              ) : null}
            </div>
            {existing ? (
              <>
                <p
                  role="status"
                  className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm"
                >
                  Cek ulang: serial ini sudah tercatat di {existing.buCode}. Entri ini menjadi
                  kejadian cek ulang lolos pada catatan yang sama; item mengikuti catatan itu.
                </p>
                {blocked !== null ? (
                  <p role="alert" className="text-sm text-destructive">
                    {blocked}
                  </p>
                ) : null}
                <div className="space-y-1.5">
                  <Label htmlFor="detail-item">Item baris</Label>
                  <Input id="detail-item" readOnly value={row.itemLabel} />
                </div>
                <RecheckBuField
                  id="detail-bu"
                  label="Business Unit baris"
                  choices={buChoices}
                  value={{ buId: item.buId, buLabel: item.buLabel }}
                  loading={bus === null && busLoading}
                  onChange={(bu) => changeItem({ ...item, buId: bu.buId, buLabel: bu.buLabel })}
                  error={
                    item.buId !== '' && !buAllowed
                      ? 'Business Unit ini tidak bisa dipakai untuk cek ulang serial ini'
                      : undefined
                  }
                />
              </>
            ) : (
              <ItemBuField
                idPrefix="detail"
                label="Item baris"
                buFieldLabel="Business Unit baris"
                value={item}
                onChange={changeItem}
              />
            )}
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
            {existing ? (
              <p className="text-xs text-muted-foreground">
                Sample tidak berlaku untuk cek ulang. Tanggal uji di sini hanya menjadi tanggal
                kejadian cek ulang.
              </p>
            ) : (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="edit-sample"
                  checked={sample}
                  onCheckedChange={(on) => setSample(on === true)}
                />
                <Label htmlFor="edit-sample">Sample</Label>
              </div>
            )}
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
              <AttachmentView
                items={items}
                pending={own.entries}
                layout="grid"
                label={row.serial}
                onRemove={removePhoto}
                onRetry={own.retry}
                onCancel={own.remove}
              />
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
            {running > 0 ? (
              <span role="status" className="self-center text-xs text-muted-foreground">
                Menunggu {running} foto selesai diunggah
              </span>
            ) : null}
            <Button type="button" disabled={!ready} onClick={apply}>
              Terapkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {photoOpen ? (
        <AttachDialog
          open
          onOpenChange={setPhotoOpen}
          source={proofSource}
          mode="multiple"
          accept={['image']}
          maxBytes={MAX_IMAGE_BYTES}
          maxFiles={Math.max(1, room)}
          hideNames
          title="Foto bukti"
          confirmLabel="Tambahkan"
          camera={stamp ? { stamp: proofCameraStamp(stamp) } : true}
          onConfirm={(result) => own.add(result.files)}
        />
      ) : null}
    </>
  );
}
