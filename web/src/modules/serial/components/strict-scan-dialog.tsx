import { MAX_IMAGE_BYTES } from '@shared/files';
import {
  normalizeSerial,
  SERIAL_LIMITS,
  SERIAL_PROOF_LIMITS,
  serialProblem,
} from '@shared/serials';
import { Camera, ScanLine } from 'lucide-react';
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AttachDialog, AttachmentView } from '@/components/file-dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { BarcodeEngine } from '../lib/barcode-engine';
import { createPayloadGate } from '../lib/camera-payload';
import { DRAFT_FULL_NOTE } from '../lib/draft';
import { type ProofPhotoRef, proofSource } from '../lib/proof-source';
import { type ScanFeedback, useScanFeedback } from '../lib/scan-feedback';
import { type IsKnown, pickSingleSerial } from '../lib/scan-table';
import type { StampPreviewInput } from '../lib/stamp-preview';
import { useCameraScanner } from '../lib/use-camera-scanner';
import type { ProofSession } from '../lib/use-proof-uploads';
import { discardProofPhotos } from '../queries';
import { proofAttachmentItems } from './proof-photo-field';
import { ScanCameraPane } from './scan-camera-pane';
import { proofCameraStamp } from './stamp-preview';

/** Informasi item (dari Default) yang ditampilkan di langkah konfirmasi dan dipakai pratinjau cap. */
export interface StrictInfo {
  itemLabel: string;
  buLabel: string;
  locationLabel: string;
  testDate: string;
  /** Minimum foto bukti item (>= 1). */
  proofMin: number;
  /** Data pratinjau cap tanpa serial (serial diambil dari field yang sedang diedit). */
  stamp: Omit<StampPreviewInput, 'serial'>;
}

export interface StrictScanResult {
  /**
   * Kunci pemilik unggahan dialog ini (= `ownerId`); dipakai pemanggil sebagai `clientId` baris baru, sehingga
   * unggahan yang masih berjalan lanjut di bawah baris itu.
   */
  clientId: string;
  /** Serial ternormalisasi. */
  serial: string;
  /** Hanya foto yang SUDAH selesai; yang masih berjalan menyusul ke baris lewat antrean halaman. */
  photos: ProofPhotoRef[];
}

export interface StrictScanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ada = mulai di langkah konfirmasi (serial sudah diketik/ditempel/dipindai fisik); tidak ada = mulai di langkah scan. */
  initialSerial?: string | undefined;
  info: StrictInfo;
  /** Kunci pemilik unggahan sesi dialog ini (dibuat halaman tiap dibuka; kelak `clientId` baris). */
  ownerId: string;
  /** Antrean unggah bersama milik halaman, dan pemasangan penerima foto selesai selama baris belum ada. */
  proof: ProofSession;
  /** Serial (ternormalisasi) yang sudah ada di draft. */
  isKnown: IsKnown;
  /** Dipanggil SAAT Simpan; pemanggil memasukkan baris ke draft. Foto sudah milik baris itu (tidak dibuang dialog). */
  onConfirm: (result: StrictScanResult) => void;
  /**
   * Sisa kapasitas draft (jumlah baris yang masih boleh ditambah). Habis (<= 0) saat dibuka atau saat serial diterima =
   * dialog hanya menampilkan pemberitahuan batas, supaya pengguna tidak memotret lalu kehilangan fotonya.
   */
  capacity?: () => number;
  /** Disuntik tes. */
  createEngine?: () => Promise<BarcodeEngine>;
  now?: () => number;
}

const NOTE_MANY = 'Item ini wajib foto: satu serial per kali, arahkan ke satu kode';

/** Tindakan yang dibuka isi dialog bagi cangkangnya (Escape = Batal; ketukan pertama menyiapkan bunyi). */
interface BodyActions {
  cancel: () => void;
  unlock: () => void;
}

/**
 * Dialog scan untuk item wajib foto (AlertDialog layar penuh, dua langkah): langkah 1 = scan SATU kode lewat kamera,
 * langkah 2 = konfirmasi (informasi item, serial yang dapat diedit, lampiran foto lewat dialog Foto bukti). Simpan baru
 * aktif bila foto mencapai minimum. Kamera hanya menyala di langkah 1 dan dilepas begitu pindah ke langkah 2 atau
 * dialog ditutup. Foto yang belum dikonfirmasi dibuang di server saat dialog ditutup dengan cara apa pun selain Simpan.
 */
export function StrictScanDialog({ open, onOpenChange, ...rest }: StrictScanDialogProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<BodyActions | null>(null);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        ref={contentRef}
        size="full"
        // Fokus awal ke cangkang dialog (bukan kolom): papan ketik ponsel tidak muncul dan fokus tetap di dalam dialog.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
        // Escape = Batal (ada konfirmasi bila sudah ada foto), bukan langsung menutup dan membuang foto.
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          if (actionsRef.current) actionsRef.current.cancel();
          else onOpenChange(false);
        }}
        onPointerDown={() => actionsRef.current?.unlock()}
        onClick={() => actionsRef.current?.unlock()}
        onTouchEnd={() => actionsRef.current?.unlock()}
      >
        {/* Isi hanya dipasang selama dialog terbuka: unmount = kamera dilepas dan foto yatim dibuang. */}
        <StrictBody onClose={() => onOpenChange(false)} actionsRef={actionsRef} {...rest} />
      </AlertDialogContent>
    </AlertDialog>
  );
}

function StrictBody({
  initialSerial,
  info,
  ownerId,
  proof,
  isKnown,
  onConfirm,
  capacity,
  createEngine,
  now,
  onClose,
  actionsRef,
}: Omit<StrictScanDialogProps, 'open' | 'onOpenChange'> & {
  onClose: () => void;
  actionsRef: RefObject<BodyActions | null>;
}) {
  const { unlock } = useScanFeedback();
  const [step, setStep] = useState<1 | 2>(initialSerial === undefined ? 1 : 2);
  const [serialText, setSerialText] = useState(initialSerial ?? '');
  const [photos, setPhotos] = useState<ProofPhotoRef[]>([]);
  const [photoDialogOpen, setPhotoDialogOpen] = useState(false);
  const [confirm, setConfirm] = useState<'cancel' | 'rescan' | null>(null);
  const photosRef = useRef<ProofPhotoRef[]>([]);
  const committedRef = useRef(false);
  const proofRef = useRef(proof);
  proofRef.current = proof;
  const own = proof.uploads.forOwner(ownerId);
  // Foto yang masih menunggu/berjalan sudah dihitung terhadap minimum dan batas; yang gagal tidak.
  const running = own.entries.filter((entry) => entry.phase !== 'failed').length;
  const isKnownRef = useRef(isKnown);
  isKnownRef.current = isKnown;
  const capacityRef = useRef(capacity);
  capacityRef.current = capacity;
  const [full, setFull] = useState(() => capacity !== undefined && capacity() <= 0);

  const max = SERIAL_PROOF_LIMITS.perEntryMax;
  const normalized = normalizeSerial(serialText);
  const problem = serialProblem(normalized);
  const serialError =
    problem === 'empty'
      ? 'Isi serial dulu.'
      : problem === 'too_long'
        ? `Terlalu panjang (maks. ${SERIAL_LIMITS.serialMax} karakter).`
        : problem === 'control_chars'
          ? 'Ada karakter yang tidak boleh dipakai.'
          : isKnown(normalized)
            ? 'Sudah ada di draft.'
            : null;
  const missingPhotos = Math.max(0, info.proofMin - photos.length - running);
  const canSave = serialError === null && missingPhotos === 0;
  const hint =
    serialError !== null
      ? serialError
      : missingPhotos > 0
        ? `Butuh ${missingPhotos} foto lagi`
        : 'Siap disimpan';

  function setPhotoList(next: ProofPhotoRef[]) {
    photosRef.current = next;
    setPhotos(next);
  }

  // Foto selesai milik sesi ini masuk ke dialog (bukan ke baris, yang belum ada); penuh = ditolak dan dibuang.
  useLayoutEffect(
    () =>
      proofRef.current.attach(ownerId, (photo) => {
        if (photosRef.current.length >= max) return false;
        const next = [...photosRef.current, photo];
        photosRef.current = next;
        setPhotos(next);
        return true;
      }),
    [ownerId],
  );

  // Dialog ditutup dengan cara apa pun selain Simpan (Batal, Esc, unmount): unggahan dibatalkan dan foto yang sudah
  // selesai tetapi belum dikonfirmasi dibuang di server.
  useLayoutEffect(() => {
    return () => {
      if (committedRef.current) return;
      proofRef.current.uploads.cancelOwner(ownerId);
      if (photosRef.current.length > 0) {
        void discardProofPhotos(photosRef.current.map((photo) => photo.id));
      }
    };
  }, [ownerId]);

  function discardAllPhotos() {
    proofRef.current.uploads.cancelOwner(ownerId);
    if (photosRef.current.length > 0) void discardProofPhotos(photosRef.current.map((p) => p.id));
    setPhotoList([]);
  }

  /** Ada yang akan hilang bila ditutup: foto selesai atau unggahan yang masih berjalan/gagal. */
  const hasWork = () => photosRef.current.length > 0 || own.entries.length > 0;

  function requestCancel() {
    if (hasWork()) setConfirm('cancel');
    else onClose();
  }

  // Dipasang di efek (bukan saat render): aman bagi StrictMode dan render yang dibatalkan.
  useLayoutEffect(() => {
    actionsRef.current = { cancel: requestCancel, unlock };
    return () => {
      actionsRef.current = null;
    };
  });

  function rescan() {
    discardAllPhotos();
    setSerialText('');
    setConfirm(null);
    setStep(1);
  }

  function requestRescan() {
    if (hasWork()) setConfirm('rescan');
    else rescan();
  }

  function save() {
    if (!canSave) return;
    committedRef.current = true;
    onConfirm({ clientId: ownerId, serial: normalized, photos: photosRef.current });
    onClose();
  }

  function removePhoto(id: string) {
    void discardProofPhotos([id]);
    setPhotoList(photosRef.current.filter((item) => item.id !== id));
  }

  const items = useMemo(() => proofAttachmentItems(photos, 'serial ini'), [photos]);

  const stamp = useMemo<StampPreviewInput>(
    () => ({ ...info.stamp, serial: normalized }),
    [info.stamp, normalized],
  );

  const onScanned = useCallback((serial: string) => {
    // Draft penuh: tolak sebelum pengguna sempat memotret (foto yang dibuang setelahnya = usaha sia-sia).
    if (capacityRef.current && capacityRef.current() <= 0) {
      setFull(true);
      return;
    }
    setSerialText(serial);
    setStep(2);
  }, []);

  if (full) {
    return (
      <>
        <div className="space-y-2 p-4">
          <AlertDialogTitle>Draft penuh</AlertDialogTitle>
          <AlertDialogDescription data-testid="strict-full">
            {DRAFT_FULL_NOTE}
          </AlertDialogDescription>
        </div>
        <AlertDialogFooter>
          <Button type="button" onClick={onClose}>
            Tutup
          </Button>
        </AlertDialogFooter>
      </>
    );
  }

  return (
    <>
      <AlertDialogTitle className="sr-only">Scan serial item wajib foto</AlertDialogTitle>
      <AlertDialogDescription className="sr-only">
        {step === 1
          ? 'Arahkan kamera ke satu QR atau barcode. Setelah terbaca, lanjut ke konfirmasi dan foto bukti.'
          : 'Periksa informasi item dan serial, tambahkan foto bukti, lalu Simpan.'}
      </AlertDialogDescription>

      {step === 1 ? (
        <ScanStep
          isKnownRef={isKnownRef}
          onScanned={onScanned}
          onCancel={onClose}
          createEngine={createEngine}
          now={now}
        />
      ) : (
        <>
          <div
            data-testid="strict-confirm"
            className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4 md:grid-cols-2 landscape:grid-cols-2"
          >
            <div className="space-y-4">
              <section
                aria-label="Informasi item"
                className="space-y-1 rounded-lg border p-3 text-sm"
              >
                <p className="font-medium">{info.itemLabel}</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-muted-foreground">
                  <dt>Business Unit</dt>
                  <dd className="text-foreground">{info.buLabel}</dd>
                  <dt>Lokasi</dt>
                  <dd className="text-foreground">{info.locationLabel}</dd>
                  <dt>Tanggal uji</dt>
                  <dd className="text-foreground">{info.testDate}</dd>
                </dl>
                <p className="pt-1 font-medium text-amber-600 dark:text-amber-400">
                  Wajib foto minimal {info.proofMin}
                </p>
              </section>
              <div className="space-y-1.5">
                <Label htmlFor="strict-serial">Serial Number</Label>
                <Input
                  id="strict-serial"
                  value={serialText}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  className="font-mono"
                  aria-invalid={serialError !== null ? true : undefined}
                  aria-describedby={serialError !== null ? 'strict-serial-error' : undefined}
                  onChange={(event) => setSerialText(event.target.value.replace(/[\r\n]+/g, ' '))}
                />
                {serialError !== null ? (
                  <p id="strict-serial-error" role="alert" className="text-xs text-destructive">
                    {serialError}
                  </p>
                ) : null}
              </div>
            </div>
            <section aria-label="Lampiran foto" className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">Lampiran foto</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={photos.length + running >= max}
                  onClick={() => setPhotoDialogOpen(true)}
                >
                  <Camera aria-hidden />
                  Tambah foto
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {photos.length + running} dari minimal {info.proofMin} (maks. {max})
              </p>
              <AttachmentView
                items={items}
                pending={own.entries}
                layout="grid"
                label="serial ini"
                onRemove={removePhoto}
                onRetry={own.retry}
                onCancel={own.remove}
              />
            </section>
          </div>

          <AlertDialogFooter className="bottom-0 mx-0 mb-0 shrink-0 flex-col items-stretch rounded-none p-0 sm:flex-col">
            <p
              role="status"
              className={`px-4 pt-3 text-xs ${canSave ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400'}`}
            >
              {hint}
            </p>
            <div className="grid w-full grid-cols-3 gap-2 p-4">
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-11"
                onClick={requestCancel}
              >
                Batal
              </Button>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-11"
                onClick={requestRescan}
              >
                <ScanLine aria-hidden />
                Scan ulang
              </Button>
              <Button type="button" size="lg" className="h-11" disabled={!canSave} onClick={save}>
                Simpan
              </Button>
            </div>
          </AlertDialogFooter>
        </>
      )}

      {step === 2 && photoDialogOpen ? (
        <AttachDialog
          open
          onOpenChange={setPhotoDialogOpen}
          source={proofSource}
          mode="multiple"
          accept={['image']}
          maxBytes={MAX_IMAGE_BYTES}
          maxFiles={Math.max(1, max - photos.length - running)}
          hideNames
          title="Foto bukti"
          confirmLabel="Tambahkan"
          camera={{ stamp: proofCameraStamp(stamp) }}
          onConfirm={(result) => own.add(result.files)}
        />
      ) : null}

      {/* Konfirmasi bertumpuk: foto yang sudah ditambahkan tidak dibuang diam-diam. */}
      <AlertDialog open={confirm !== null} onOpenChange={(next) => !next && setConfirm(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogTitle>
            {confirm === 'rescan'
              ? 'Scan ulang dan buang foto?'
              : `Buang ${photos.length + own.entries.length} foto?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirm === 'rescan'
              ? 'Foto yang sudah ditambahkan akan dibuang supaya tidak menempel ke serial lain.'
              : 'Foto yang sudah ditambahkan belum disimpan dan akan hilang.'}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Kembali</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => (confirm === 'rescan' ? rescan() : onClose())}
            >
              {confirm === 'rescan' ? 'Scan ulang' : 'Buang'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Langkah 1: kamera layar penuh tanpa tabel; bacaan sah pertama (belum ada di draft) membawa ke langkah konfirmasi. */
function ScanStep({
  isKnownRef,
  onScanned,
  onCancel,
  createEngine,
  now,
}: {
  isKnownRef: RefObject<IsKnown>;
  onScanned: (serial: string) => void;
  onCancel: () => void;
  createEngine?: (() => Promise<BarcodeEngine>) | undefined;
  now?: (() => number) | undefined;
}) {
  const gate = useMemo(() => createPayloadGate(undefined, now), [now]);
  const { feedback, announce } = useScanFeedback();
  const [deviceId, setDeviceId] = useState('');
  const [last, setLast] = useState('');
  const [note, setNote] = useState<string | null>(null);
  // Sesudah serial diterima, bacaan berikutnya (sebelum render ulang) diabaikan.
  const doneRef = useRef(false);
  const onScannedRef = useRef(onScanned);
  onScannedRef.current = onScanned;

  const camera = useCameraScanner({
    open: true,
    deviceId,
    createEngine,
    now,
    onPayload: (payload) => {
      if (doneRef.current) return;
      const text = gate.accept(payload);
      if (text === null) return;
      setLast(text.replace(/\r?\n/g, ', '));
      const pick = pickSingleSerial(text);
      if (pick.serial === null) {
        setNote(pick.reason === 'many' ? NOTE_MANY : null);
        announce('rejected');
        return;
      }
      if (isKnownRef.current?.(pick.serial)) {
        setNote('sudah ada di draft');
        announce('duplicate');
        return;
      }
      doneRef.current = true;
      setNote(null);
      announce('added');
      onScannedRef.current(pick.serial);
    },
  });

  // Efek (bukan nilai awal): StrictMode memasang ulang efek.
  useEffect(() => {
    doneRef.current = false;
  }, []);

  const resultFeedback: ScanFeedback | null = feedback;
  return (
    <>
      <div
        data-testid="scan-layout"
        className="flex min-h-0 flex-1 flex-col bg-black md:flex-row landscape:flex-row"
      >
        <div className="flex min-h-0 flex-1 bg-black">
          <ScanCameraPane
            camera={camera}
            deviceId={deviceId}
            onDeviceChange={setDeviceId}
            feedback={resultFeedback}
            resultText={note ?? last}
            fill
          />
        </div>
      </div>
      <AlertDialogFooter className="bottom-0 mx-0 mb-0 shrink-0 flex-row rounded-none p-0">
        <div className="grid w-full grid-cols-1 p-4">
          <Button type="button" variant="outline" size="lg" className="h-11" onClick={onCancel}>
            Batal
          </Button>
        </div>
      </AlertDialogFooter>
    </>
  );
}
