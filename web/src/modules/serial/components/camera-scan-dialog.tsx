import { type MouseEvent, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
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
import { cn } from '@/lib/utils';
import type { BarcodeEngine } from '../lib/barcode-engine';
import { createPayloadGate } from '../lib/camera-payload';
import {
  FEEDBACK_FLASH,
  FEEDBACK_TEXT,
  type ScanFeedback,
  useScanFeedback,
} from '../lib/scan-feedback';
import { SCAN_FRAME } from '../lib/scan-region';
import {
  addScanned,
  editRow,
  type IsKnown,
  rowProblems,
  rowsToScan,
  type ScanRow,
} from '../lib/scan-table';
import { CAMERA_ERROR_TEXT, useCameraScanner } from '../lib/use-camera-scanner';
import { nextDevice, ScanCameraControls } from './scan-camera-controls';
import { ScanResultsTable } from './scan-results-table';

export interface CameraScanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Dipanggil SAAT "Simpan", satu kali per baris tabel (menurut urutan tabel) dengan satu serial ternormalisasi, lewat
   * jalur yang sama dengan tempel/pindai fisik; mengembalikan hasilnya (diringkas menjadi toast bila ada yang
   * dilewati). Hasil bacaan kamera TIDAK langsung dikirim: ia masuk tabel di dalam dialog dulu.
   */
  onScan: (text: string) => ScanFeedback;
  /**
   * Serial (ternormalisasi) yang sudah dimiliki pemakai, mis. yang sudah ada di draft: tidak ditambahkan ke tabel
   * (umpan balik "Sudah ada") dan menandai baris hasil edit yang menjadi sama dengannya.
   */
  isKnown?: IsKnown;
  /** Disuntik tes: pengganti mesin pembaca. */
  createEngine?: () => Promise<BarcodeEngine>;
  /** Disuntik tes: jam untuk jendela bacaan ulang. */
  now?: () => number;
}

/** Lama cincin umpan balik ketuk-untuk-fokus tampil. */
const FOCUS_RING_MS = 900;

/** Lama baris terbaru disorot. */
const HIGHLIGHT_MS = 1500;

const NEVER_KNOWN: IsKnown = () => false;

/** Warna teks hasil di atas latar gelap pratinjau (selalu hitam, jadi tak mengikuti tema). */
const FEEDBACK_TEXT_ON_DARK: Record<ScanFeedback, string> = {
  added: 'text-emerald-300',
  duplicate: 'text-amber-300',
  rejected: 'text-red-300',
};

/** Tindakan yang dibuka isi dialog bagi cangkangnya (Escape = Batal; ketukan pertama menyiapkan bunyi). */
interface BodyActions {
  cancel: () => void;
  unlock: () => void;
}

/**
 * Dialog kamera layar penuh (AlertDialog): kamera di atas dengan kontrol mengambang, tabel hasil scan di bawahnya,
 * lalu Batal | Simpan. Kamera tetap menyala setelah tiap pembacaan; bacaan terkonfirmasi masuk TABEL INTERNAL (dapat
 * diedit/dihapus) dan baru dikirim ke `onScan` saat Simpan. Aliran kamera dimatikan saat dialog ditutup.
 */
export function CameraScanDialog({ open, onOpenChange, ...rest }: CameraScanDialogProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<BodyActions | null>(null);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        ref={contentRef}
        size="full"
        // Fokus awal ke cangkang dialog (bukan tombol/kolom pertama): papan ketik ponsel tidak muncul dan menutupi
        // pratinjau, sementara fokus tetap di dalam dialog (Escape, Tab, dan pembaca layar jalan).
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
        // Escape = Batal (ada konfirmasi bila sudah ada hasil), bukan langsung menutup dan membuang hasil.
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          if (actionsRef.current) actionsRef.current.cancel();
          else onOpenChange(false);
        }}
        // Ketukan pertama pengguna menyiapkan Web Audio (iOS hanya mau memulainya dari gerak pengguna).
        onPointerDown={() => actionsRef.current?.unlock()}
      >
        {/* Isi hanya dipasang selama dialog terbuka: unmount = efek kamera dibersihkan = aliran dimatikan. */}
        <CameraScanBody onClose={() => onOpenChange(false)} actionsRef={actionsRef} {...rest} />
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CameraScanBody({
  onScan,
  isKnown = NEVER_KNOWN,
  onClose,
  actionsRef,
  createEngine,
  now,
}: Pick<CameraScanDialogProps, 'onScan' | 'isKnown' | 'createEngine' | 'now'> & {
  onClose: () => void;
  actionsRef: RefObject<BodyActions | null>;
}) {
  const gate = useMemo(() => createPayloadGate(undefined, now), [now]);
  const { feedback, announce, unlock } = useScanFeedback();
  const [last, setLast] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [ring, setRing] = useState<{ x: number; y: number; key: number } | null>(null);
  const [rows, setRows] = useState<readonly ScanRow[]>([]);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Salinan sinkron: beberapa bacaan dapat tiba sebelum render ulang.
  const rowsRef = useRef<readonly ScanRow[]>([]);
  const idCounter = useRef(0);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const isKnownRef = useRef(isKnown);
  isKnownRef.current = isKnown;

  function commitRows(next: readonly ScanRow[]) {
    rowsRef.current = next;
    setRows(next);
  }

  function deliver(text: string) {
    setLast(text.replace(/\r?\n/g, ', '));
    const result = addScanned(
      rowsRef.current,
      text,
      (serial) => isKnownRef.current(serial),
      () => `scan-${++idCounter.current}`,
    );
    if (result.rows !== rowsRef.current) commitRows(result.rows);
    const newest = result.added[result.added.length - 1];
    if (newest !== undefined) setHighlightId(newest);
    announce(result.feedback);
  }

  const camera = useCameraScanner({
    open: true,
    deviceId,
    createEngine,
    now,
    onPayload: (payload) => {
      const text = gate.accept(payload);
      if (text !== null) deliver(text);
    },
  });
  const { state } = camera;

  useEffect(() => {
    if (ring === null) return;
    const timer = setTimeout(() => setRing(null), FOCUS_RING_MS);
    return () => clearTimeout(timer);
  }, [ring]);

  useEffect(() => {
    if (highlightId === null) return;
    const timer = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlightId]);

  // Ketuk di area video = fokus sekali ke titik itu (hanya bila kamera mendukung; selain itu tidak melakukan apa-apa).
  // Kontrol mengambang menahan ketukannya sendiri (tidak sampai ke sini).
  function onViewportClick(event: MouseEvent<HTMLDivElement>) {
    const video = camera.videoRef.current;
    if (state.status !== 'scanning' || !camera.tapFocusSupported || !video) return;
    if ((event.target as HTMLElement).closest('button')) return;
    const rect = video.getBoundingClientRect();
    const tap = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (camera.focusAt(tap, { width: rect.width, height: rect.height })) {
      setRing({ ...tap, key: Date.now() });
    }
  }

  const problems = useMemo(() => rowProblems(rows, isKnown), [rows, isKnown]);
  const canSave = rows.length > 0 && problems.every((problem) => problem === null);

  function requestCancel() {
    if (rowsRef.current.length > 0) setConfirmDiscard(true);
    else onClose();
  }

  actionsRef.current = { cancel: requestCancel, unlock };
  useEffect(
    () => () => {
      actionsRef.current = null;
    },
    [actionsRef],
  );

  function save() {
    if (!canSave) return;
    let added = 0;
    let skipped = 0;
    for (const serial of rowsToScan(rowsRef.current)) {
      if (onScanRef.current(serial) === 'added') added++;
      else skipped++;
    }
    if (skipped > 0) toast.warning(`${added} ditambahkan, ${skipped} dilewati`);
    onClose();
  }

  function switchCamera() {
    const next = nextDevice(camera, deviceId || camera.activeDeviceId);
    if (next) setDeviceId(next.id);
  }

  const tip = camera.tapFocusSupported
    ? 'Arahkan kode ke dalam bingkai, ketuk layar untuk fokus.'
    : camera.zoomRange
      ? 'Arahkan kode ke dalam bingkai, lalu atur zoom kalau buram.'
      : 'Arahkan kode ke dalam bingkai.';

  return (
    <>
      <AlertDialogTitle className="sr-only">Scan serial</AlertDialogTitle>
      <AlertDialogDescription className="sr-only">
        Arahkan kamera ke QR atau barcode. Hasil scan masuk ke tabel; tekan Simpan untuk
        memasukkannya, atau Batal untuk membuangnya.
      </AlertDialogDescription>

      {/* Area kamera: latar hitam selebar layar; isinya dipusatkan dengan lebar maksimum agar bingkai tetap proporsional di desktop. */}
      <div className="shrink-0 bg-black">
        {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: ketuk-untuk-fokus hanya pelengkap sentuhan; pemindaian dan semua kontrol lain tetap bisa lewat papan ketik. */}
        <div
          data-testid="camera-viewport"
          onClick={onViewportClick}
          className={cn(
            'relative mx-auto h-[clamp(11rem,55dvh,40rem)] w-full max-w-2xl overflow-hidden border-2 border-transparent bg-black',
            feedback !== null && FEEDBACK_FLASH[feedback],
          )}
        >
          <video
            ref={camera.videoRef}
            aria-label="Pratinjau kamera"
            className="absolute inset-0 size-full object-cover"
            playsInline
            muted
          />
          {/* Area scan: hanya kode di dalam bingkai yang dibaca (ukuran bingkai = SCAN_FRAME, sama dengan pemotongan). */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <div
              data-testid="scan-frame"
              className="rounded-lg border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
              style={{
                width: `${SCAN_FRAME.width * 100}%`,
                height: `${SCAN_FRAME.height * 100}%`,
              }}
            />
          </div>
          {ring !== null ? (
            <span
              key={ring.key}
              aria-hidden
              data-testid="focus-ring"
              className="pointer-events-none absolute size-14 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full border-2 border-white motion-reduce:animate-none"
              style={{ left: ring.x, top: ring.y }}
            />
          ) : null}
          {/* Petunjuk dan hasil terakhir di bagian atas, di luar bingkai (tidak menutupinya). */}
          {state.status !== 'error' ? (
            <div className="pointer-events-none absolute inset-x-3 top-2 flex flex-col items-center gap-1">
              <p className="rounded-md bg-black/50 px-2 py-1 text-center text-xs text-white">
                {tip}
              </p>
              <p
                aria-live="polite"
                // Tetap dirender (kosong tanpa latar) agar pembaca layar mengumumkan perubahannya.
                className={cn(
                  'max-w-full truncate rounded-md px-2 py-1 text-sm font-medium',
                  feedback ? `bg-black/70 ${FEEDBACK_TEXT_ON_DARK[feedback]}` : 'p-0',
                )}
              >
                {feedback ? `${FEEDBACK_TEXT[feedback]}: ${last}` : ''}
              </p>
            </div>
          ) : null}
          {state.status === 'loading' ? (
            <p
              role="status"
              className="absolute inset-0 flex items-center justify-center bg-black/60 p-4 text-center text-sm text-white"
            >
              Menyiapkan kamera…
            </p>
          ) : null}
          {state.status === 'error' ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 p-4 text-center text-sm text-white">
              <p role="alert">{CAMERA_ERROR_TEXT[state.kind]}</p>
              {state.kind !== 'insecure' && state.kind !== 'unsupported' ? (
                <Button type="button" variant="secondary" size="sm" onClick={camera.retry}>
                  Coba lagi
                </Button>
              ) : null}
            </div>
          ) : null}
          {state.status !== 'error' ? (
            <ScanCameraControls camera={camera} onSwitchCamera={switchCamera} />
          ) : null}
        </div>
      </div>

      <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
        <ScanResultsTable
          rows={rows}
          problems={problems}
          highlightId={highlightId}
          onEdit={(id, text) => commitRows(editRow(rowsRef.current, id, text))}
          onRemove={(id) => commitRows(rowsRef.current.filter((row) => row.id !== id))}
        />
      </div>

      <AlertDialogFooter className="bottom-0 mx-0 mb-0 shrink-0 flex-row p-0">
        <div className="mx-auto grid w-full max-w-2xl grid-cols-2 gap-2 p-4">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-11"
            onClick={requestCancel}
          >
            Batal
          </Button>
          <Button type="button" size="lg" className="h-11" disabled={!canSave} onClick={save}>
            {rows.length > 0 ? `Simpan (${rows.length})` : 'Simpan'}
          </Button>
        </div>
      </AlertDialogFooter>

      {/* Konfirmasi bertumpuk (di luar badan form mana pun): hasil scan yang belum disimpan tidak dibuang diam-diam. */}
      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent size="sm">
          <AlertDialogTitle>Buang {rows.length} serial hasil scan?</AlertDialogTitle>
          <AlertDialogDescription>
            Serial yang sudah dipindai belum masuk ke daftar dan akan hilang.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Lanjut scan</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onClose}>
              Buang
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
