import {
  Ban,
  Boxes,
  CheckCheck,
  CheckSquare,
  CloudUpload,
  Copy,
  Download,
  Eye,
  History,
  LoaderCircle,
  type LucideIcon,
  PackageCheck,
  PackageMinus,
  PackagePlus,
  Pause,
  Pencil,
  Play,
  Plus,
  Power,
  PowerOff,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  SlidersHorizontal,
  Sticker,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';
import { type ComponentProps, type MouseEvent, useRef, useState } from 'react';
import { BusyLabel } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { UiColor, UiVariant } from '@/components/ui/variant-style';

export type ActionKind =
  | 'create'
  | 'save'
  | 'edit'
  | 'delete'
  | 'activate'
  | 'deactivate'
  | 'restore'
  | 'cancel'
  | 'download'
  | 'export'
  | 'upload'
  | 'print'
  | 'copy'
  | 'refresh'
  | 'select'
  | 'view'
  | 'done'
  | 'reopen'
  | 'abort'
  | 'stock'
  | 'stockIn'
  | 'stockOut'
  | 'adjust'
  | 'history'
  | 'reportDamage'
  | 'stickers'
  | 'warehouse'
  | 'pause'
  | 'resume'
  | 'sendTest';

type ActionSpec = {
  icon: LucideIcon;
  label: string;
  color: UiColor;
  variant: UiVariant;
  compactVariant: UiVariant;
};

/** Kosakata aksi aplikasi (spek redesain 6.3): satu tempat untuk ikon, warna, gaya, dan label bawaan. */
export const ACTIONS: Record<ActionKind, ActionSpec> = {
  create: {
    icon: Plus,
    label: 'Tambah',
    color: 'primary',
    variant: 'solid',
    compactVariant: 'solid',
  },
  save: {
    icon: Save,
    label: 'Simpan',
    color: 'primary',
    variant: 'solid',
    compactVariant: 'solid',
  },
  edit: {
    icon: Pencil,
    label: 'Ubah',
    color: 'primary',
    variant: 'outline',
    compactVariant: 'ghost',
  },
  delete: {
    icon: Trash2,
    label: 'Hapus',
    color: 'destructive',
    variant: 'soft',
    compactVariant: 'ghost',
  },
  activate: {
    icon: Power,
    label: 'Aktifkan',
    color: 'success',
    variant: 'soft',
    compactVariant: 'ghost',
  },
  deactivate: {
    icon: PowerOff,
    label: 'Nonaktifkan',
    color: 'warning',
    variant: 'soft',
    compactVariant: 'ghost',
  },
  restore: {
    icon: RotateCcw,
    label: 'Pulihkan',
    color: 'info',
    variant: 'soft',
    compactVariant: 'ghost',
  },
  cancel: {
    icon: X,
    label: 'Batal',
    color: 'primary',
    variant: 'outline',
    compactVariant: 'ghost',
  },
  download: {
    icon: Download,
    label: 'Unduh',
    color: 'secondary',
    variant: 'soft',
    compactVariant: 'ghost',
  },
  // Ekspor = unggah ke folder Drive (QR Code Manual Book), jadi ikonnya awan-unggah, beda dari Unduh (B5b).
  export: {
    icon: CloudUpload,
    label: 'Ekspor',
    color: 'secondary',
    variant: 'soft',
    compactVariant: 'ghost',
  },
  upload: {
    icon: Upload,
    label: 'Unggah',
    color: 'secondary',
    variant: 'soft',
    compactVariant: 'ghost',
  },
  print: {
    icon: Printer,
    label: 'Cetak',
    color: 'secondary',
    variant: 'soft',
    compactVariant: 'ghost',
  },
  copy: {
    icon: Copy,
    label: 'Salin',
    color: 'secondary',
    variant: 'ghost',
    compactVariant: 'ghost',
  },
  refresh: {
    icon: RefreshCw,
    label: 'Muat ulang',
    color: 'secondary',
    variant: 'ghost',
    compactVariant: 'ghost',
  },
  select: {
    icon: CheckSquare,
    label: 'Pilih',
    color: 'secondary',
    variant: 'ghost',
    compactVariant: 'ghost',
  },
  view: {
    icon: Eye,
    label: 'Lihat',
    color: 'secondary',
    variant: 'soft',
    compactVariant: 'ghost',
  },
  // Serah Terima (fase 4d): menandai task selesai, membuka kembali task Dibatalkan, dan membatalkan task (bukan Hapus).
  done: {
    icon: CheckCheck,
    label: 'Mark done',
    color: 'success',
    variant: 'solid',
    compactVariant: 'ghost',
  },
  reopen: {
    icon: RotateCcw,
    label: 'Buka kembali',
    color: 'info',
    variant: 'outline',
    compactVariant: 'ghost',
  },
  abort: {
    icon: Ban,
    label: 'Batalkan task',
    color: 'destructive',
    variant: 'soft',
    compactVariant: 'ghost',
  },
  // Stok stiker (B10): satu entri "Stok" bersubmenu di kolom Aksi; butirnya memakai empat aksi di bawahnya.
  stock: {
    icon: Boxes,
    label: 'Stok',
    color: 'primary',
    variant: 'outline',
    compactVariant: 'ghost',
  },
  stockIn: {
    icon: PackagePlus,
    label: 'Catat masuk',
    color: 'primary',
    variant: 'outline',
    compactVariant: 'ghost',
  },
  stockOut: {
    icon: PackageMinus,
    label: 'Catat keluar',
    color: 'primary',
    variant: 'outline',
    compactVariant: 'ghost',
  },
  adjust: {
    icon: SlidersHorizontal,
    label: 'Koreksi',
    color: 'primary',
    variant: 'outline',
    compactVariant: 'ghost',
  },
  history: {
    icon: History,
    label: 'Riwayat',
    color: 'primary',
    variant: 'outline',
    compactVariant: 'ghost',
  },
  // Serial Number (P7): melaporkan unit rusak; tampil di sebelah Ubah di View Serial di semua ukuran layar.
  reportDamage: {
    icon: TriangleAlert,
    label: 'Lapor rusak',
    color: 'destructive',
    variant: 'soft',
    compactVariant: 'ghost',
  },
  // Serial Number (R1): mencatat stiker yang baru ditempel pada unit (satu serial lewat dialog, banyak lewat bulk).
  stickers: {
    icon: Sticker,
    label: 'Tempel stiker',
    color: 'primary',
    variant: 'outline',
    compactVariant: 'ghost',
  },
  // Catat Serial WH: membuka form pencatatan Serial Number Gudang (Penjualan atau Ready Stock) dari daftar Riwayat atau detail task.
  warehouse: {
    icon: PackageCheck,
    label: 'Catat Serial WH',
    color: 'primary',
    variant: 'outline',
    compactVariant: 'ghost',
  },
  // Laporan dashboard terjadwal: jeda/lanjutkan pengiriman dan kirim uji ke surel pemilik.
  pause: {
    icon: Pause,
    label: 'Jeda',
    color: 'warning',
    variant: 'soft',
    compactVariant: 'ghost',
  },
  resume: {
    icon: Play,
    label: 'Lanjutkan',
    color: 'success',
    variant: 'soft',
    compactVariant: 'ghost',
  },
  sendTest: {
    icon: Send,
    label: 'Kirim uji',
    color: 'primary',
    variant: 'outline',
    compactVariant: 'ghost',
  },
};

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

export type ActionButtonProps = {
  action: ActionKind;
  /** Menimpa label bawaan (mis. "Tambah item"). Pada `compact` menjadi aria-label dan isi tooltip. */
  label?: string;
  /** Ikon saja, ukuran kecil, dengan tooltip (tabel, kartu, kanban). */
  compact?: boolean;
  /** Proses berjalan: tombol nonaktif dengan spinner; simpan = "Menyimpan…". */
  busy?: boolean;
  /** Teks saat `busy` (bawaan: "Menyimpan…" untuk simpan, lainnya "{label}…"). */
  busyLabel?: string;
  /**
   * `primary` = aksi utama halaman: warna primary SOLID menggantikan gaya bawaan aksi itu (mis. "Ubah" yang bawaannya
   * outline). Hanya berlaku bagi aksi berwarna primary; aksi lain (Hapus, Pulihkan, …) mempertahankan warnanya.
   */
  emphasis?: 'primary';
  /** Menimpa warna/gaya bawaan aksi (mis. tombol Salin ulang berwarna primary). */
  color?: UiColor;
  variant?: UiVariant;
} & Omit<ComponentProps<typeof Button>, 'color' | 'variant' | 'children'>;

function busyText(action: ActionKind, label: string): string {
  return action === 'save' ? 'Menyimpan…' : `${label}…`;
}

export function ActionButton({
  action,
  label,
  compact = false,
  busy: busyProp = false,
  busyLabel,
  disabled,
  size,
  emphasis,
  color,
  variant,
  onClick,
  ...rest
}: ActionButtonProps) {
  // Idempoten: `onClick` yang mengembalikan janji (async) mematikan tombol sampai selesai, dan ketukan kedua pada
  // tick yang sama (sebelum render ulang) diabaikan lewat `inflight`; `busy` dari pemanggil tetap berlaku.
  const inflight = useRef(false);
  const [pending, setPending] = useState(false);
  const busy = busyProp || pending;
  const handleClick = onClick
    ? (event: MouseEvent<HTMLButtonElement>) => {
        if (inflight.current) {
          event.preventDefault();
          return;
        }
        const result: unknown = onClick(event);
        if (isThenable(result)) {
          inflight.current = true;
          setPending(true);
          const done = () => {
            inflight.current = false;
            setPending(false);
          };
          result.then(done, done);
        }
      }
    : undefined;
  const spec = ACTIONS[action];
  const text = label ?? spec.label;
  const Icon = spec.icon;

  if (compact) {
    const button = (
      <Button
        type="button"
        {...rest}
        color={spec.color}
        variant={spec.compactVariant}
        size={size ?? 'icon-sm'}
        aria-label={text}
        disabled={disabled || busy}
        onClick={handleClick}
      >
        {busy ? <LoaderCircle aria-hidden className="animate-spin" /> : <Icon aria-hidden />}
      </Button>
    );
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>{text}</TooltipContent>
      </Tooltip>
    );
  }

  const resolvedColor = color ?? spec.color;
  const resolvedVariant =
    variant ?? (emphasis === 'primary' && resolvedColor === 'primary' ? 'solid' : spec.variant);

  return (
    <Button
      type="button"
      {...rest}
      color={resolvedColor}
      variant={resolvedVariant}
      size={size}
      disabled={disabled || busy}
      onClick={handleClick}
    >
      {busy ? (
        <BusyLabel>{busyLabel ?? busyText(action, text)}</BusyLabel>
      ) : (
        <>
          <Icon aria-hidden data-icon="inline-start" />
          {text}
        </>
      )}
    </Button>
  );
}
