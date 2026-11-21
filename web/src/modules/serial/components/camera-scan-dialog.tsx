import { SERIAL_LIMITS } from '@shared/serials';
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { type ScanFeedback, useScanFeedback } from '../lib/scan-feedback';
import {
  addScanned,
  editRow,
  type IsKnown,
  pickSingleSerial,
  rowProblems,
  rowsToScan,
  type ScanRow,
} from '../lib/scan-table';
import { useCameraScanner } from '../lib/use-camera-scanner';
import { ScanCameraPane } from './scan-camera-pane';
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
  /**
   * Pemakai satu-serial (mis. Lapor Rusak): TANPA tabel dan tanpa Simpan, kamera layar penuh. Bacaan sah pertama
   * langsung diteruskan ke `onScan` lalu dialog menutup (kecuali pemakai menjawab 'rejected'); payload dengan lebih
   * dari satu serial sah ditolak utuh ('rejected' + catatan) dan kamera tetap hidup.
   */
  single?: boolean;
  /**
   * Dipanggil sesudah "Simpan" dengan hasil SEMUA baris (urutan tabel), supaya pemakai dapat meringkasnya. Bila
   * diisi, toast ringkasan dialog tidak ditampilkan (pemakai yang menyampaikannya) agar tidak ganda.
   */
  onSaved?: (results: { serial: string; feedback: ScanFeedback }[]) => void;
  /**
   * Sisa kapasitas draft pemakai (jumlah total baris yang masih boleh dimiliki tabel ini, dibaca tiap bacaan): baris
   * yang melebihinya ditolak DI TABEL (umpan balik "Ditolak: batas N baris draft tercapai"), jadi Simpan tidak
   * menjatuhkan baris diam-diam. Kosong = batas draft penuh.
   */
  draftCapacity?: () => number;
  /** Disuntik tes: pengganti mesin pembaca. */
  createEngine?: () => Promise<BarcodeEngine>;
  /** Disuntik tes: jam untuk jendela bacaan ulang. */
  now?: () => number;
}

/** Lama baris terbaru disorot. */
const HIGHLIGHT_MS = 1500;

const NEVER_KNOWN: IsKnown = () => false;

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
        onClick={() => actionsRef.current?.unlock()}
        onTouchEnd={() => actionsRef.current?.unlock()}
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
  single = false,
  onSaved,
  draftCapacity,
  onClose,
  actionsRef,
  createEngine,
  now,
}: Pick<
  CameraScanDialogProps,
  'onScan' | 'isKnown' | 'single' | 'onSaved' | 'draftCapacity' | 'createEngine' | 'now'
> & {
  onClose: () => void;
  actionsRef: RefObject<BodyActions | null>;
}) {
  const gate = useMemo(() => createPayloadGate(undefined, now), [now]);
  const { feedback, announce, unlock } = useScanFeedback();
  const [last, setLast] = useState('');
  // Alasan penolakan yang ditampilkan menggantikan serial terakhir di teks hasil.
  const [note, setNote] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState('');
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
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const draftCapacityRef = useRef(draftCapacity);
  draftCapacityRef.current = draftCapacity;
  // Konfirmasi Buang tampil: bacaan kamera baru diabaikan (jumlah di judulnya harus tetap benar).
  const confirmRef = useRef(false);
  confirmRef.current = confirmDiscard;

  function commitRows(next: readonly ScanRow[]) {
    rowsRef.current = next;
    setRows(next);
  }

  function deliverSingle(text: string) {
    const pick = pickSingleSerial(text);
    if (pick.serial === null) {
      setNote(pick.reason === 'many' ? 'satu serial saja per laporan, arahkan ke satu kode' : null);
      announce('rejected');
      return;
    }
    setNote(null);
    const result = onScanRef.current(pick.serial);
    announce(result);
    // Dipakai (atau sama dengan yang sudah dicari): selesai. Hanya penolakan pemakai yang membiarkan kamera menyala.
    if (result !== 'rejected') onClose();
  }

  function deliver(text: string) {
    setLast(text.replace(/\r?\n/g, ', '));
    if (single) {
      deliverSingle(text);
      return;
    }
    const result = addScanned(
      rowsRef.current,
      text,
      (serial) => isKnownRef.current(serial),
      () => `scan-${++idCounter.current}`,
      { capacity: draftCapacityRef.current?.() },
    );
    setNote(
      result.reason === 'limit' ? `batas ${SERIAL_LIMITS.tableRows} baris draft tercapai` : null,
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
      if (confirmRef.current) return;
      const text = gate.accept(payload);
      if (text !== null) deliver(text);
    },
  });

  useEffect(() => {
    if (highlightId === null) return;
    const timer = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlightId]);

  const problems = useMemo(() => rowProblems(rows, isKnown), [rows, isKnown]);
  const canSave = rows.length > 0 && problems.every((problem) => problem === null);

  function requestCancel() {
    if (rowsRef.current.length > 0) setConfirmDiscard(true);
    else onClose();
  }

  // Dipasang di efek (bukan saat render): aman bagi StrictMode dan render yang dibatalkan.
  useLayoutEffect(() => {
    actionsRef.current = { cancel: requestCancel, unlock };
    return () => {
      actionsRef.current = null;
    };
  });

  function save() {
    if (!canSave) return;
    const results = rowsToScan(rowsRef.current).map((serial) => ({
      serial,
      feedback: onScanRef.current(serial),
    }));
    if (onSavedRef.current) onSavedRef.current(results);
    else {
      const added = results.filter((result) => result.feedback === 'added').length;
      const skipped = results.length - added;
      if (skipped > 0) toast.warning(`${added} ditambahkan, ${skipped} dilewati`);
    }
    onClose();
  }

  return (
    <>
      <AlertDialogTitle className="sr-only">Scan serial</AlertDialogTitle>
      <AlertDialogDescription className="sr-only">
        {single
          ? 'Arahkan kamera ke QR atau barcode. Serial yang terbaca langsung dipakai.'
          : 'Arahkan kamera ke QR atau barcode. Hasil scan masuk ke tabel; tekan Simpan untuk memasukkannya, atau Batal untuk membuangnya.'}
      </AlertDialogDescription>

      {/* Tata letak: ponsel portrait = 1 kolom (kamera atas, tabel bawah); lebar >= md ATAU landscape = 2 kolom (kamera kiri, tabel kanan), jadi kontrol tak terpotong di ponsel landscape. Mode satu-serial: hanya kamera, layar penuh. */}
      <div
        data-testid="scan-layout"
        className="flex min-h-0 flex-1 flex-col md:flex-row landscape:flex-row"
      >
        <div
          className={cn(
            'bg-black',
            single
              ? 'flex min-h-0 flex-1'
              : 'shrink-0 md:flex md:w-1/2 md:shrink landscape:flex landscape:w-1/2 landscape:shrink',
          )}
        >
          <ScanCameraPane
            camera={camera}
            deviceId={deviceId}
            onDeviceChange={setDeviceId}
            feedback={feedback}
            resultText={note ?? last}
            fill={single}
          />
        </div>

        {single ? null : (
          <div className="flex min-h-0 w-full flex-1 flex-col md:w-1/2 landscape:w-1/2">
            <ScanResultsTable
              rows={rows}
              problems={problems}
              highlightId={highlightId}
              onEdit={(id, text) => commitRows(editRow(rowsRef.current, id, text))}
              onRemove={(id) => commitRows(rowsRef.current.filter((row) => row.id !== id))}
            />
          </div>
        )}
      </div>

      <AlertDialogFooter className="bottom-0 mx-0 mb-0 shrink-0 flex-row rounded-none p-0">
        {single ? (
          <div className="grid w-full grid-cols-1 p-4">
            <Button
              type="button"
              variant="outline"
              color="primary"
              size="lg"
              className="h-11"
              onClick={onClose}
            >
              Tutup
            </Button>
          </div>
        ) : (
          <div className="grid w-full grid-cols-2 gap-2 p-4">
            <Button
              type="button"
              variant="outline"
              color="primary"
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
        )}
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
            <AlertDialogAction variant="soft" color="destructive" onClick={onClose}>
              Buang
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
