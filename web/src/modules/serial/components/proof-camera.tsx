import { X } from 'lucide-react';
import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { captureFrame } from '../lib/photo-capture';
import type { ProofPhotoRef } from '../lib/proof-source';
import type { StampPreviewInput } from '../lib/stamp-preview';
import { CAMERA_ERROR_TEXT, type CameraErrorKind, useCameraStream } from '../lib/use-camera-stream';
import { usePinchZoom } from '../lib/use-pinch-zoom';
import { CameraTopButtons, CameraZoomRail } from './proof-camera-controls';
import { ProofPhotoGrid } from './proof-photo-grid';
import { ProofPhotoStack } from './proof-photo-stack';
import { FLOAT_BUTTON, nextDevice } from './scan-camera-controls';
import { StampNote, StampToggleButton } from './stamp-preview';

export interface ProofCameraDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Sisa foto yang masih boleh ditambah; 0 = rana nonaktif. */
  remaining: number;
  /** Tanpa ini pratinjau cap tidak ditampilkan. */
  stamp?: StampPreviewInput | undefined;
  /**
   * Dipanggil dengan berkas JPEG tiap jepretan. Menolak (Error berpesan) bila foto tak dapat ditambahkan; pesannya
   * tampil di dialog. Tidak ditunggu oleh rana: jepretan berikutnya boleh jalan selagi yang sebelumnya diunggah.
   */
  onShot(file: File): Promise<void>;
  /** Foto yang sudah dibidik pada pembukaan dialog foto ini (strip thumbnail). */
  shots: ProofPhotoRef[];
  /** Jumlah foto yang sedang diunggah: tiap satu tampil sebagai sel berputar di ujung strip. */
  uploading?: number;
  /** Tanpa ini thumbnail di strip tidak punya tombol buang. */
  onRemoveShot?(photo: ProofPhotoRef): void;
  /** Kamera dilaporkan tak dapat dipakai (izin ditolak dsb.): pemanggil boleh menyembunyikan tombol Kamera. */
  onUnavailable?(kind: CameraErrorKind): void;
  /** Kamera menyala (termasuk sesudah "Coba lagi" yang berhasil): pemanggil boleh menampilkan tombol Kamera lagi. */
  onAvailable?(): void;
}

/** Lama kilat putih tiap jepretan. */
const FLASH_MS = 140;
/** Lama cincin ketuk-untuk-fokus tampil. */
const FOCUS_RING_MS = 900;
/** Strip foto menutup sendiri setelah selang ini tanpa interaksi. */
const STRIP_IDLE_MS = 4000;
/** Lama nama kamera aktif tampil setelah berganti kamera. */
const CAMERA_NAME_MS = 2500;

const UNAVAILABLE_KINDS: readonly CameraErrorKind[] = [
  'denied',
  'notfound',
  'insecure',
  'unsupported',
];

function messageOf(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message !== '' ? reason.message : fallback;
}

/**
 * Kamera foto bukti layar penuh satu layar (AlertDialog `size="full"`, gaya kamera ponsel): video memenuhi seluruh
 * dialog dan SEMUA kontrol mengambang di atasnya, satu tata letak untuk semua ukuran. Kiri atas tutup; kanan atas
 * sembunyikan cap, senter, ganti kamera; kanan tengah zoom; bawah: pratinjau cap, strip thumbnail horizontal, lalu
 * baris rana (sisa kuota kiri, rana tengah, Selesai kanan). Isi hanya dipasang selama dialog terbuka: unmount =
 * aliran kamera dilepas. Foto hanya dibidik di sini; unggah dan penyimpanan oleh pemanggil (`onShot`). Aturan dialog
 * "header/footer tetap" tidak berlaku di sini: tidak ada bagian yang menggulir.
 */
export function ProofCameraDialog({ open, onOpenChange, ...rest }: ProofCameraDialogProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        ref={contentRef}
        size="full"
        // Hitam penuh: area aman (notch/bilah gestur) di tepi tidak menampilkan warna popover.
        className="bg-black text-white"
        // Fokus awal ke cangkang dialog (bukan tombol): papan ketik tidak muncul dan fokus tetap di dalam dialog.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          onOpenChange(false);
        }}
      >
        <ProofCameraBody onClose={() => onOpenChange(false)} {...rest} />
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ProofCameraBody({
  onClose,
  remaining,
  stamp,
  onShot,
  shots,
  uploading = 0,
  onRemoveShot,
  onUnavailable,
  onAvailable,
}: Omit<ProofCameraDialogProps, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const [deviceId, setDeviceId] = useState('');
  const camera = useCameraStream({ open: true, deviceId });
  const { state } = camera;
  const [flash, setFlash] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ring, setRing] = useState<{ x: number; y: number; key: number } | null>(null);
  const [cameraName, setCameraName] = useState<string | null>(null);
  const [stampVisible, setStampVisible] = useState(true);
  // Strip foto: tersembunyi awalnya; dibuka lewat tumpukan di samping rana, menutup saat kembali memotret.
  const [stripOpen, setStripOpen] = useState(false);
  const [stripTick, setStripTick] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const aliveRef = useRef(true);
  const capturingRef = useRef(false);
  const onShotRef = useRef(onShot);
  onShotRef.current = onShot;
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;
  const onAvailableRef = useRef(onAvailable);
  onAvailableRef.current = onAvailable;

  // Efek (bukan nilai awal): StrictMode memasang ulang efek, jadi penanda harus dinyalakan lagi di sini.
  useLayoutEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const errorKind = state.status === 'error' ? state.kind : null;
  useEffect(() => {
    if (errorKind !== null && UNAVAILABLE_KINDS.includes(errorKind)) {
      onUnavailableRef.current?.(errorKind);
    }
  }, [errorKind]);

  const scanning = state.status === 'scanning';
  useEffect(() => {
    if (scanning) onAvailableRef.current?.();
  }, [scanning]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(false), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);
  useEffect(() => {
    if (ring === null) return;
    const timer = setTimeout(() => setRing(null), FOCUS_RING_MS);
    return () => clearTimeout(timer);
  }, [ring]);
  useEffect(() => {
    if (cameraName === null) return;
    const timer = setTimeout(() => setCameraName(null), CAMERA_NAME_MS);
    return () => clearTimeout(timer);
  }, [cameraName]);

  const hasPhotos = shots.length > 0 || uploading > 0;
  const stripShown = stripOpen && hasPhotos;
  // Tanpa foto lagi (semua dibuang): strip menutup, dan tak muncul sendiri pada foto berikutnya.
  useEffect(() => {
    if (!hasPhotos) setStripOpen(false);
  }, [hasPhotos]);
  // Tutup otomatis sesudah jeda tanpa interaksi; ditahan selama tampilan besar terbuka.
  // biome-ignore lint/correctness/useExhaustiveDependencies: stripTick sengaja memicu ulang penghitung tiap interaksi.
  useEffect(() => {
    if (!stripShown || previewOpen) return;
    const timer = setTimeout(() => setStripOpen(false), STRIP_IDLE_MS);
    return () => clearTimeout(timer);
  }, [stripShown, previewOpen, stripTick]);

  const pinch = usePinchZoom({
    zoom: camera.zoom,
    range: state.status === 'scanning' ? camera.zoomRange : null,
    setZoom: (value) => void camera.setZoom(value),
  });

  function onViewportClick(event: MouseEvent<HTMLDivElement>) {
    // Ketukan di area video = kembali fokus memotret: strip foto menyembunyikan diri.
    setStripOpen(false);
    if (pinch.wasPinching()) return;
    const video = camera.videoRef.current;
    if (state.status !== 'scanning' || !camera.tapFocusSupported || !video) return;
    if ((event.target as HTMLElement).closest('button')) return;
    const rect = video.getBoundingClientRect();
    const tap = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (camera.focusAt(tap, { width: rect.width, height: rect.height })) {
      setRing({ ...tap, key: Date.now() });
    }
  }

  function switchCamera() {
    const next = nextDevice(camera, deviceId || camera.activeDeviceId);
    if (next) {
      setDeviceId(next.id);
      setCameraName(next.label);
    }
  }

  async function shoot() {
    const video = camera.videoRef.current;
    if (!video || capturingRef.current || remaining <= 0 || state.status !== 'scanning') return;
    capturingRef.current = true;
    setCapturing(true);
    setError(null);
    setStripOpen(false);
    try {
      const file = await captureFrame(video, `foto-${Date.now()}.jpg`);
      if (!aliveRef.current) return;
      // Umpan balik jepretan: kilat singkat dan getar ringan (tanpa nada).
      setFlash(true);
      try {
        navigator.vibrate?.(25);
      } catch {
        // Getar tidak didukung.
      }
      // Tidak ditunggu: jepretan berikutnya boleh jalan selagi ini diunggah. Pesan penolakan tampil di dialog.
      onShotRef.current(file).catch((reason: unknown) => {
        if (aliveRef.current) setError(messageOf(reason, 'Foto gagal ditambahkan'));
      });
    } catch (reason) {
      if (aliveRef.current) setError(messageOf(reason, 'Gagal mengambil foto'));
    } finally {
      capturingRef.current = false;
      if (aliveRef.current) setCapturing(false);
    }
  }

  const full = remaining <= 0;
  const ready = state.status === 'scanning';

  return (
    <>
      <AlertDialogTitle className="sr-only">Kamera foto bukti</AlertDialogTitle>
      <AlertDialogDescription className="sr-only">
        Arahkan kamera ke unit lalu tekan tombol bulat untuk memotret. Tekan Selesai bila sudah
        cukup.
      </AlertDialogDescription>

      {/* Satu tata letak untuk semua ukuran: viewport mengisi dialog, kontrol mengambang di atasnya. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: ketuk-untuk-fokus hanya pelengkap sentuhan; rana dan semua kontrol lain tetap bisa lewat papan ketik. */}
      <div
        data-testid="camera-viewport"
        onClick={onViewportClick}
        onPointerDown={pinch.onPointerDown}
        onPointerMove={pinch.onPointerMove}
        onPointerUp={pinch.onPointerUp}
        onPointerCancel={pinch.onPointerCancel}
        className="relative min-h-0 w-full flex-1 touch-none overflow-hidden bg-black"
      >
        <video
          ref={camera.videoRef}
          aria-label="Pratinjau kamera"
          className="absolute inset-0 size-full object-cover"
          playsInline
          muted
        />
        {flash ? (
          <span
            aria-hidden
            data-testid="shutter-flash"
            className="pointer-events-none absolute inset-0 bg-white/70"
          />
        ) : null}
        {ring !== null ? (
          <span
            key={ring.key}
            aria-hidden
            data-testid="focus-ring"
            className="pointer-events-none absolute size-14 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full border-2 border-white motion-reduce:animate-none"
            style={{ left: ring.x, top: ring.y }}
          />
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

        {/* Atas: tutup (kiri); sembunyikan cap, senter, ganti kamera (kanan). */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 bg-linear-to-b from-black/50 to-transparent pt-3 pr-[max(0.75rem,env(safe-area-inset-right))] pb-6 pl-[max(0.75rem,env(safe-area-inset-left))]">
          <Float>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={FLOAT_BUTTON}
              aria-label="Tutup kamera"
              title="Tutup kamera"
              onClick={onClose}
            >
              <X aria-hidden />
            </Button>
          </Float>
          {state.status !== 'error' ? (
            <Float className="flex items-center gap-2">
              {stamp ? (
                <StampToggleButton
                  visible={stampVisible}
                  onToggle={() => setStampVisible((value) => !value)}
                />
              ) : null}
              <CameraTopButtons camera={camera} onSwitchCamera={switchCamera} />
            </Float>
          ) : null}
        </div>
        {cameraName !== null && state.status !== 'error' ? (
          <p
            data-testid="camera-name"
            aria-live="polite"
            className="pointer-events-none absolute top-[4.5rem] left-[max(0.75rem,env(safe-area-inset-left))] max-w-[60%] truncate rounded-md bg-black/60 px-2 py-1 text-xs text-white"
          >
            {cameraName}
          </p>
        ) : null}

        {state.status !== 'error' ? <CameraZoomRail camera={camera} /> : null}

        {/* Bawah: pesan galat, pratinjau cap, strip thumbnail, lalu baris rana. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-linear-to-t from-black/60 via-black/25 to-transparent pt-10 pr-[max(0.75rem,env(safe-area-inset-right))] pb-3 pl-[max(0.75rem,env(safe-area-inset-left))]">
          {error !== null ? (
            <Float>
              <p
                role="alert"
                className="w-fit max-w-full rounded-md bg-destructive px-2 py-1 text-xs text-white"
              >
                {error}
              </p>
            </Float>
          ) : null}
          {stamp && stampVisible && state.status !== 'error' ? (
            // Sisakan kolom zoom di kanan agar pratinjau tidak menimpanya.
            <Float className="pr-[4.25rem]">
              <StampNote input={stamp} />
            </Float>
          ) : null}
          {/* Pembungkus relatif: strip foto MENGAMBANG di atasnya (absolute) dan tak pernah ikut aliran tata letak. */}
          <div className="relative flex flex-col gap-2">
            <p
              aria-live="polite"
              className="pointer-events-none w-fit self-center rounded-full bg-black/55 px-3 py-1.5 text-xs text-white"
            >
              {full ? 'Batas foto tercapai' : `Sisa ${remaining} foto`}
            </p>
            {stripShown ? (
              // Overlay: menimpa video tepat di atas pil/rana tanpa menggeser elemen lain (cap, zoom, pil). Kolom zoom
              // di kanan disisakan agar strip tidak menimpanya.
              <Float
                className="absolute inset-x-0 bottom-full mb-2 pr-[4.25rem]"
                onInteract={() => setStripTick((value) => value + 1)}
              >
                <div
                  data-testid="proof-photo-strip-panel"
                  className="w-fit max-w-full rounded-xl bg-black/45 px-2 backdrop-blur-sm"
                >
                  <ProofPhotoGrid
                    variant="strip"
                    photos={shots}
                    uploading={uploading}
                    {...(onRemoveShot ? { onRemove: onRemoveShot } : {})}
                    onPreviewChange={setPreviewOpen}
                    label="hasil kamera"
                  />
                </div>
              </Float>
            ) : null}
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <Float className="justify-self-start">
                <ProofPhotoStack
                  photos={shots}
                  uploading={uploading}
                  expanded={stripShown}
                  onToggle={() => setStripOpen((value) => !value)}
                />
              </Float>
              <Float>
                <button
                  type="button"
                  aria-label="Ambil foto"
                  title={full ? 'Batas foto tercapai' : 'Ambil foto'}
                  disabled={!ready || capturing || full}
                  onClick={() => void shoot()}
                  className={cn(
                    'flex size-16 items-center justify-center rounded-full border-4 border-white outline-none focus-visible:ring-4 focus-visible:ring-ring/60',
                    'disabled:opacity-40',
                  )}
                >
                  <span className="size-12 rounded-full bg-white" />
                </button>
              </Float>
              <Float className="justify-self-end">
                <Button
                  type="button"
                  size="lg"
                  className="h-11 rounded-full px-4"
                  onClick={onClose}
                >
                  {shots.length > 0 ? `Selesai (${shots.length})` : 'Selesai'}
                </Button>
              </Float>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Pembungkus kontrol mengambang: menerima ketukan (induknya `pointer-events-none` agar area kosong tetap menerima
 * ketuk-fokus dan cubit) dan menandainya `data-camera-control` sehingga tidak ikut gestur video.
 */
function Float({
  className,
  children,
  onInteract,
}: {
  className?: string;
  children: ReactNode;
  /** Dipanggil pada sentuhan/gulir di dalam pembungkus (mis. menunda penutupan otomatis strip). */
  onInteract?: () => void;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: pembungkus hanya menahan ketukan agar tak jatuh ke area video; kontrol di dalamnya tetap bisa lewat papan ketik.
    <div
      data-camera-control
      className={cn('pointer-events-auto min-w-0', className)}
      onPointerDownCapture={onInteract}
      onScrollCapture={onInteract}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}
