import type { SerialActInput, SerialDto } from '@shared/contract';
import { extractFileRefs } from '@shared/items';
import { availableActions, resolveAction } from '@shared/serial-flow';
import {
  recheckBuCandidates,
  SERIAL_LIMITS,
  SERIAL_PROOF_LIMITS,
  type SerialAction,
  type ServiceDiagnosisStage,
} from '@shared/serials';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FieldError } from '@/components/field-error';
import { Select } from '@/components/select';
import { BusyLabel } from '@/components/spinner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
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
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { serialActorModules } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { isStaleSaveError, STALE_SAVE_MESSAGE } from '@/modules/sticker/lib/stale';
import { serialKeys } from '../keys';
import { isProofRejection } from '../lib/draft';
import { todayWib } from '../lib/locations';
import type { ProofPhotoRef } from '../lib/proof-source';
import type { StampPreviewInput } from '../lib/stamp-preview';
import { useProofUploads } from '../lib/use-proof-uploads';
import { useSerialLocations } from '../lib/use-serial-locations';
import {
  discardProofPhotos,
  serialServiceLocationsQueryOptions,
  serialStickerOptionsQueryOptions,
  useActSerial,
} from '../queries';
import type { ActKind } from './act-buttons';
import { MessageField, RecheckStickerList, type RecheckStickerRow } from './act-fields';
import { ProofPhotoField } from './proof-photo-field';
import { choicesFor, RecheckBuField, useWritableBus } from './recheck-bu-field';
import { SerialLocationField } from './serial-location-field';

export interface ActDialogProps {
  serial: SerialDto;
  kind: ActKind;
  onClose: () => void;
}

const STALE_RELOAD_MESSAGE = `${STALE_SAVE_MESSAGE}. Halaman sudah dimuat ulang. Catatan Anda tetap ada; cek lagi lalu kirim ulang.`;
const PROOF_OWNER = 'recheck';

/** Field yang galat servernya tampil di bawah field-nya sendiri. */
type FieldKey =
  | 'occurredOn'
  | 'message'
  | 'toLocationId'
  | 'stickerIds'
  | 'shipmentNote'
  | 'proofPhotoIds'
  | 'buId';
type FieldErrors = Partial<Record<FieldKey, string>>;

type Stage = ServiceDiagnosisStage | 'broken';

const STAGE_LABEL: Record<Stage, string> = {
  diagnosis: 'Diagnosis',
  repairing: 'Sedang diperbaiki',
  done: 'Selesai, kembalikan ke QC',
  broken: 'Rusak',
};

const RESULT_OPTIONS = [
  { value: 'pass', label: 'Lolos' },
  { value: 'fail', label: 'Tidak lolos' },
];

const TITLE: Record<ActKind, string> = {
  report: 'Lapor rusak',
  send: 'Kirim ke servis',
  receive: 'Terima unit',
  diagnosis: 'Diagnosis',
  recheck: 'Cek ulang',
  note: 'Tambah catatan',
};

/**
 * Pisahkan galat server: field yang tampil (`visible`) muncul di bawah field-nya, sisanya jadi pesan umum
 * (jalur galat yang sama dengan aksi lain).
 */
function splitError(
  caught: unknown,
  visible: readonly FieldKey[],
): { fields: FieldErrors; general: string | null } {
  if (caught instanceof ApiError && caught.fields) {
    const fields: FieldErrors = {};
    const rest: Record<string, string> = {};
    for (const [key, value] of Object.entries(caught.fields)) {
      if ((visible as readonly string[]).includes(key)) fields[key as FieldKey] = value;
      else rest[key] = value;
    }
    if (Object.keys(fields).length > 0) {
      const general =
        Object.keys(rest).length > 0
          ? describeError(new ApiError(caught.code, caught.message, caught.requestId, rest))
          : null;
      return { fields, general };
    }
  }
  return { fields: {}, general: describeError(caught) };
}

function descriptionOf(kind: ActKind, receivingAtQc: boolean, noOpenReport: boolean): string {
  switch (kind) {
    case 'report':
      return 'Buka laporan baru untuk Serial Number ini. Ceritakan masalahnya di catatan.';
    case 'send':
      return 'Unit dikirim ke tim servis dan berstatus Dalam pengiriman sampai servis menerimanya.';
    case 'receive':
      return receivingAtQc
        ? 'Konfirmasi unit sudah kembali di QC.'
        : 'Konfirmasi unit sudah sampai di servis.';
    case 'diagnosis':
      return 'Perbarui penanganan di servis. Unit yang belum ditandai diterima otomatis tercatat diterima.';
    case 'recheck':
      // Serial Lolos tidak punya laporan terbuka: hasil gagal MEMBUKA laporan baru (tabel transisi baris recheck).
      return noOpenReport
        ? 'Cek ulang unit ini. Kalau tidak lolos, laporan baru dibuka.'
        : 'Cek ulang unit ini. Kalau lolos, laporan ditutup; kalau tidak, laporan tetap terbuka.';
    default:
      return 'Tambahkan catatan ke riwayat Serial Number ini.';
  }
}

/**
 * Dialog update di baris Riwayat: catatan Markdown (gambar maks. `messageImagesMax`), tanggal kejadian, dan isian khas
 * tiap aksi (tujuan servis, tahap diagnosis, hasil cek ulang + stiker yang dicentang). Aksi yang dikirim mengikuti
 * tabel transisi (`resolveAction`, sumber yang sama dengan server), jadi dialog tidak menyimpan aturan sendiri.
 */
export function ActDialog({ serial, kind, onClose }: ActDialogProps) {
  const me = useMe();
  const queryClient = useQueryClient();
  const act = useActSerial();
  const actor = serialActorModules(me, serial.buId);
  const state = { status: serial.status, custody: serial.custody };
  const today = todayWib();

  const [message, setMessage] = useState('');
  const [occurredOn, setOccurredOn] = useState(today);
  // Status diagnosis sengaja dikosongkan: tim servis harus memilihnya dengan sadar (keputusan pemilik 2026-11-15).
  const [stage, setStage] = useState<Stage | ''>('');
  const [shipmentNote, setShipmentNote] = useState('');
  const [result, setResult] = useState<'pass' | 'fail'>('pass');
  const [toLocation, setToLocation] = useState({ id: '', label: '' });
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  // Foto bukti QC (hanya Cek ulang): `draft` di server sampai Simpan menautkannya ke entri.
  const [proofPhotos, setProofPhotos] = useState<ProofPhotoRef[]>([]);
  // Unggah latar foto bukti milik dialog ini (pemilik form); Task 13 melengkapi penahan Kirim dan pembersihan saat tutup.
  const proofCountRef = useRef(0);
  proofCountRef.current = proofPhotos.length;
  const proofUploads = useProofUploads({
    onAdd: (_owner, photo) => {
      if (proofCountRef.current >= SERIAL_PROOF_LIMITS.perEntryMax) return false;
      proofCountRef.current += 1;
      setProofPhotos((current) => [...current, photo]);
      return true;
    },
  });
  const ownProofUploads = proofUploads.forOwner(PROOF_OWNER);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [confirming, setConfirming] = useState(false);
  // BU tujuan cek ulang lolos: bawaan BU saat ini (kosong di kiriman = BU saat ini).
  const [targetBu, setTargetBu] = useState({ buId: serial.buId, buLabel: serial.buCode });

  const serviceLocations = useQuery({
    ...serialServiceLocationsQueryOptions(),
    enabled: kind === 'send',
  });
  const { locations: activeLocations } = useSerialLocations();
  // Stiker yang berlaku mengikuti BU tujuan (hasil lolos boleh memindahkan BU).
  const stickerBuId = kind === 'recheck' && result === 'pass' ? targetBu.buId : serial.buId;
  const stickerOptions = useQuery({
    ...serialStickerOptionsQueryOptions(serial.itemId, stickerBuId, serial.id),
    enabled: kind === 'recheck' && stickerBuId !== '',
  });
  const { bus, loading: busLoading } = useWritableBus(kind === 'recheck');

  // Aksi tabel transisi yang dipilih dialog ini.
  const hasRecheckRow = availableActions(state, actor).some((row) => row.action === 'recheck');
  const canDeclareBroken = 'row' in resolveAction('declare_broken', state, actor);
  const action: SerialAction =
    kind === 'report'
      ? 'report_failure'
      : kind === 'diagnosis'
        ? stage === 'broken'
          ? 'declare_broken'
          : 'service_diagnosis'
        : kind === 'recheck'
          ? hasRecheckRow
            ? 'recheck'
            : result === 'pass'
              ? 'recheck_pass'
              : 'recheck_fail'
          : kind;
  const resolved = resolveAction(
    action,
    state,
    actor,
    kind === 'recheck' ? result : undefined,
    action === 'service_diagnosis' && stage !== '' && stage !== 'broken' ? stage : undefined,
  );
  const messageRequired = 'row' in resolved && resolved.row.required.includes('message');
  // Pindah BU hanya pada hasil lolos (`recheck` lolos dan `recheck_pass`); gagal tak menerima `buId`.
  const showBuField = kind === 'recheck' && result === 'pass';
  const buChoices = useMemo(
    () =>
      choicesFor(
        recheckBuCandidates({
          currentBuId: serial.buId,
          involvedBuIds: serial.buHistory.map((entry) => entry.buId),
          writableBuIds: bus ? bus.map((bu) => bu.id) : [serial.buId],
        }),
        bus,
        [{ id: serial.buId, code: serial.buCode }],
      ),
    [serial.buId, serial.buCode, serial.buHistory, bus],
  );

  // Tujuan Kirim ke servis: field hanya bila konfigurasi servis punya lebih dari satu lokasi aktif.
  const serviceList = serviceLocations.data?.locations ?? [];
  const needsServiceChoice = kind === 'send' && serviceList.length > 1;
  const onlyService = kind === 'send' && serviceList.length === 1 ? serviceList[0] : undefined;
  // Terima (QC): field lokasi hanya bila lokasi QC asal (tujuan pengiriman) sudah tidak aktif.
  const isReceiveAtQc = kind === 'receive' && serial.status === 'recheck';
  const originInactive =
    isReceiveAtQc &&
    serial.transitToLocationId !== null &&
    activeLocations.length > 0 &&
    !activeLocations.some((location) => location.id === serial.transitToLocationId);
  const needsQcLocation =
    originInactive || (isReceiveAtQc && fieldErrors.toLocationId !== undefined);
  const showLocationField = needsServiceChoice || needsQcLocation;
  const locationRequired = needsServiceChoice || originInactive;

  const minDate =
    serial.custody === 'transit' &&
    serial.transitOn !== null &&
    (kind === 'receive' || kind === 'diagnosis' || kind === 'recheck')
      ? serial.transitOn
      : undefined;
  const tooManyImages = extractFileRefs(message).length > SERIAL_LIMITS.messageImagesMax;
  const clientErrors: FieldErrors = {
    ...(tooManyImages
      ? { message: `Maksimal ${SERIAL_LIMITS.messageImagesMax} gambar per catatan` }
      : {}),
    ...(occurredOn > today ? { occurredOn: 'Tanggal tidak boleh di masa depan' } : {}),
    ...(minDate !== undefined && occurredOn !== '' && occurredOn < minDate
      ? { occurredOn: 'Tanggal tidak boleh sebelum tanggal kirim' }
      : {}),
  };
  const errorOf = (key: FieldKey) => clientErrors[key] ?? fieldErrors[key];

  const submitDisabled =
    act.isPending ||
    // Kirim: pilihan lokasi servis belum dimuat (field-nya baru tampil bila ada lebih dari satu).
    (kind === 'send' && serviceLocations.isPending) ||
    (messageRequired && message.trim() === '') ||
    // Diagnosis: status wajib dipilih (tidak ada nilai bawaan).
    (kind === 'diagnosis' && stage === '') ||
    occurredOn === '' ||
    (locationRequired && toLocation.id === '') ||
    (showBuField && targetBu.buId === '') ||
    Object.keys(clientErrors).length > 0;

  // Pratinjau cap di kamera foto (Cek ulang): lokasi = tempat cek ulang dilakukan (tujuan pengiriman bila unit masih
  // dalam perjalanan, selain itu lokasi serial), sama dengan yang dipakai cap resmi server.
  const stampLocation = serial.transitToLocationName ?? serial.locationName;
  const recheckStamp = useMemo<StampPreviewInput | undefined>(
    () =>
      stampLocation === ''
        ? undefined
        : {
            serial: serial.serial,
            itemLabel: serial.itemLabel,
            buLabel: serial.buCode,
            locationLabel: stampLocation,
            actorName: me.name,
            actorTeam: 'QC',
          },
    [serial.serial, serial.itemLabel, serial.buCode, stampLocation, me.name],
  );

  const stickerRows: RecheckStickerRow[] =
    kind === 'recheck'
      ? [
          ...serial.stickers.map((sticker) => ({
            stickerId: sticker.stickerId,
            name: sticker.name,
            qty: sticker.qty,
            inactive: sticker.stickerStatus === 'inactive',
          })),
          ...(stickerOptions.data?.stickers ?? [])
            .filter((sticker) => !serial.stickers.some((entry) => entry.stickerId === sticker.id))
            .map((sticker) => ({
              stickerId: sticker.id,
              name: sticker.name,
              qty: 0,
              inactive: false,
            })),
        ]
      : [];

  function buildInput(): SerialActInput {
    const common = {
      id: serial.id,
      expectedUpdatedAt: serial.updatedAt,
      occurredOn,
      message,
    };
    const stickerIds = stickerRows
      .map((row) => row.stickerId)
      .filter((stickerId) => checked.has(stickerId));
    const stickerPart = stickerIds.length > 0 ? { stickerIds } : {};
    const proofPart =
      proofPhotos.length > 0 ? { proofPhotoIds: proofPhotos.map((photo) => photo.id) } : {};
    const shipmentPart = shipmentNote.trim() !== '' ? { shipmentNote: shipmentNote.trim() } : {};
    // `buId` kosong = BU saat ini: hanya dikirim bila BU tujuan berbeda.
    const buPart =
      targetBu.buId !== '' && targetBu.buId !== serial.buId ? { buId: targetBu.buId } : {};
    const locationPart =
      toLocation.id !== '' && showLocationField ? { toLocationId: toLocation.id } : {};
    switch (action) {
      case 'send':
        return { ...common, action, ...locationPart, ...shipmentPart };
      case 'receive':
        return { ...common, action, ...locationPart };
      case 'service_diagnosis':
        // `broken` memakai aksi `declare_broken` dan kosong tak dapat dikirim (tombol nonaktif); cadangan demi tipe.
        return {
          ...common,
          action,
          stage: stage === '' || stage === 'broken' ? 'diagnosis' : stage,
        };
      case 'recheck':
        return {
          ...common,
          action,
          result,
          ...stickerPart,
          ...proofPart,
          ...(result === 'pass' ? buPart : {}),
        };
      case 'recheck_pass':
        return { ...common, action, ...stickerPart, ...proofPart, ...buPart };
      case 'recheck_fail':
        return { ...common, action, ...stickerPart, ...proofPart };
      case 'declare_broken':
      case 'report_failure':
        return { ...common, action };
      default:
        return { ...common, action: 'note' };
    }
  }

  async function submit() {
    setError(null);
    setFieldErrors({});
    try {
      await act.mutateAsync(buildInput());
      toast.success('Update disimpan');
      // Foto sudah tertaut ke entri: tidak dibuang.
      onClose();
    } catch (caught) {
      if (isStaleSaveError(caught)) {
        setError(STALE_RELOAD_MESSAGE);
        // Kepala DAN riwayat dimuat ulang: entri orang lain yang membuat versi usang harus terlihat.
        void queryClient.invalidateQueries({ queryKey: serialKeys.one(serial.id) });
        void queryClient.invalidateQueries({ queryKey: serialKeys.history(serial.id) });
        return;
      }
      const visible: FieldKey[] = ['occurredOn', 'message'];
      if (kind === 'send' || kind === 'receive') visible.push('toLocationId');
      if (kind === 'send') visible.push('shipmentNote');
      if (kind === 'recheck') visible.push('stickerIds', 'proofPhotoIds', 'buId');
      const split = splitError(caught, visible);
      setFieldErrors(split.fields);
      setError(split.general);
      // Foto yang ditolak server (kedaluwarsa, milik orang lain, atau sudah dipakai) tak berguna lagi: unggah ulang.
      if (isProofRejection(split.fields.proofPhotoIds ?? '')) setProofPhotos([]);
    }
  }

  // Menutup tanpa menyimpan: foto draft yang sudah diunggah dibuang (upaya terbaik; sisanya disapu penjadwal).
  function cancel() {
    if (act.isPending) return;
    void discardProofPhotos(proofPhotos.map((photo) => photo.id));
    onClose();
  }

  const declaring = action === 'declare_broken';
  const submitLabel =
    kind === 'report'
      ? 'Lapor rusak'
      : kind === 'send'
        ? 'Kirim ke servis'
        : kind === 'receive'
          ? 'Terima'
          : kind === 'diagnosis'
            ? declaring
              ? 'Nyatakan rusak'
              : 'Simpan diagnosis'
            : kind === 'recheck'
              ? 'Simpan cek ulang'
              : 'Kirim catatan';
  const receiveTarget = serial.transitToLocationName ?? serial.locationName;

  return (
    <Dialog open onOpenChange={(open) => !open && cancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{TITLE[kind]}</DialogTitle>
          <DialogDescription>{descriptionOf(kind, isReceiveAtQc, hasRecheckRow)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="act-date">Tanggal</Label>
            <Input
              id="act-date"
              type="date"
              max={today}
              {...(minDate !== undefined ? { min: minDate } : {})}
              value={occurredOn}
              aria-invalid={errorOf('occurredOn') ? true : undefined}
              onChange={(event) => setOccurredOn(event.target.value)}
            />
            <FieldError errors={[errorOf('occurredOn')]} />
          </div>
          {onlyService ? (
            <p className="text-sm">
              Dikirim ke <span className="font-medium">{onlyService.name}</span>.
            </p>
          ) : null}
          {kind === 'receive' && !showLocationField ? (
            <p className="text-sm">
              Diterima di <span className="font-medium">{receiveTarget}</span>
              {isReceiveAtQc
                ? ', lokasi QC saat unit dilaporkan.'
                : '. Lokasi Serial Number pindah ke sana setelah diterima.'}
            </p>
          ) : null}
          {showLocationField ? (
            <div className="space-y-1.5">
              <SerialLocationField
                id="act-to-location"
                label={needsServiceChoice ? 'Lokasi servis' : 'Lokasi penerimaan'}
                placeholder={needsServiceChoice ? 'Pilih lokasi servis…' : 'Pilih lokasi…'}
                value={toLocation.id}
                valueLabel={toLocation.label}
                onChange={(id, label) => setToLocation({ id, label })}
                error={errorOf('toLocationId')}
                {...(needsServiceChoice ? { locations: serviceList } : {})}
              />
              {needsQcLocation ? (
                <p className="text-xs text-muted-foreground">
                  Lokasi QC asal sudah tidak aktif, jadi pilih lokasi aktif lain untuk menerima
                  unit.
                </p>
              ) : null}
            </div>
          ) : null}
          {kind === 'send' ? (
            <div className="space-y-1.5">
              <Label htmlFor="act-shipment-note">Catatan pengiriman (opsional)</Label>
              <Input
                id="act-shipment-note"
                value={shipmentNote}
                maxLength={SERIAL_LIMITS.shipmentNoteMax}
                placeholder="Kurir, nomor resi, atau nama karyawan pengantar"
                aria-invalid={errorOf('shipmentNote') ? true : undefined}
                disabled={act.isPending}
                onChange={(event) => setShipmentNote(event.target.value.replace(/[\r\n]+/g, ' '))}
              />
              <FieldError errors={[errorOf('shipmentNote')]} />
            </div>
          ) : null}
          {kind === 'diagnosis' ? (
            <div className="space-y-1.5">
              <Select
                id="act-stage"
                label="Status"
                placeholder="Pilih status…"
                value={stage}
                options={(canDeclareBroken
                  ? (['diagnosis', 'repairing', 'done', 'broken'] as const)
                  : (['diagnosis', 'repairing', 'done'] as const)
                ).map((value) => ({ value, label: STAGE_LABEL[value] }))}
                onValueChange={(next) => setStage(next as Stage)}
              />
              {stage === 'done' ? (
                <p className="text-xs text-muted-foreground">
                  Unit dikirim kembali ke lokasi QC asal untuk dicek ulang.
                </p>
              ) : null}
              {declaring ? (
                <p
                  role="status"
                  className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs"
                >
                  Status Rusak bersifat final dan tidak bisa dibuka lagi. Email dikirim ke penerima
                  peringatan, berisi catatan ini dan tautan baca-saja ke laporan. Catatan wajib
                  diisi.
                </p>
              ) : null}
            </div>
          ) : null}
          {kind === 'recheck' ? (
            <>
              <Select
                id="act-result"
                label="Hasil cek ulang"
                value={result}
                options={RESULT_OPTIONS}
                onValueChange={(next) => setResult(next === 'fail' ? 'fail' : 'pass')}
              />
              {showBuField ? (
                <div className="space-y-1.5">
                  <RecheckBuField
                    id="act-bu"
                    label="Business Unit"
                    choices={buChoices}
                    value={targetBu}
                    loading={bus === null && busLoading}
                    disabled={act.isPending}
                    error={errorOf('buId')}
                    onChange={setTargetBu}
                  />
                  <p className="text-xs text-muted-foreground">
                    Bawaannya BU saat ini ({serial.buCode}). Pilih BU lain untuk sekalian
                    memindahkan serial ini; BU yang pernah ditinggalkan tidak bisa dipilih lagi.
                  </p>
                </div>
              ) : null}
              <RecheckStickerList
                rows={stickerRows}
                checked={checked}
                onToggle={(stickerId, on) => {
                  const next = new Set(checked);
                  if (on) next.add(stickerId);
                  else next.delete(stickerId);
                  setChecked(next);
                }}
                error={errorOf('stickerIds')}
                disabled={act.isPending}
              />
            </>
          ) : null}
          {kind === 'recheck' ? (
            <div className="space-y-1.5">
              <Label id="act-proof-label">Bukti foto (opsional)</Label>
              <ProofPhotoField
                value={proofPhotos}
                uploads={ownProofUploads}
                max={SERIAL_PROOF_LIMITS.perEntryMax}
                disabled={act.isPending}
                stamp={recheckStamp}
                onChange={setProofPhotos}
              />
              <p className="text-xs text-muted-foreground">
                Foto otomatis diberi cap (serial, tipe, lokasi, waktu simpan) dan tidak bisa diubah
                atau dihapus setelah disimpan.
              </p>
              <FieldError errors={[errorOf('proofPhotoIds')]} />
            </div>
          ) : null}
          <MessageField
            id="act-message"
            required={messageRequired}
            value={message}
            onChange={setMessage}
            error={errorOf('message')}
            disabled={act.isPending}
          />
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={act.isPending} onClick={cancel}>
            Batal
          </Button>
          <Button
            type="button"
            variant={declaring || kind === 'report' ? 'destructive' : 'default'}
            disabled={submitDisabled}
            onClick={() => (declaring ? setConfirming(true) : void submit())}
          >
            {act.isPending ? <BusyLabel>Menyimpan…</BusyLabel> : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Nyatakan Serial Number ini rusak?</AlertDialogTitle>
            <AlertDialogDescription>
              Serial Number ini ditandai Rusak dan laporannya ditutup. Email dikirim ke penerima.
              Status Rusak final dan tidak bisa dibuka lagi.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirming(false);
                void submit();
              }}
            >
              Ya, nyatakan rusak
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
