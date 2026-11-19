import {
  Copy,
  Download,
  LoaderCircle,
  type LucideIcon,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { ComponentProps } from 'react';
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
  | 'refresh';

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
  export: {
    icon: Download,
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
};

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
} & Omit<ComponentProps<typeof Button>, 'color' | 'variant' | 'children'>;

function busyText(action: ActionKind, label: string): string {
  return action === 'save' ? 'Menyimpan…' : `${label}…`;
}

export function ActionButton({
  action,
  label,
  compact = false,
  busy = false,
  busyLabel,
  disabled,
  size,
  ...rest
}: ActionButtonProps) {
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

  return (
    <Button
      type="button"
      {...rest}
      color={spec.color}
      variant={spec.variant}
      size={size}
      disabled={disabled || busy}
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
