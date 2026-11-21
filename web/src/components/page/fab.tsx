import { ACTIONS, type ActionKind } from '@/components/action-button';
import { Button } from '@/components/ui/button';

/**
 * Tombol aksi utama mengambang di ponsel (FAB 48 px kanan bawah, ikon saja; `aria-label` = label aksi). Menghormati
 * area aman dan tak menutupi isi terakhir karena halaman memberi padding bawah (`ListPage`).
 */
export function Fab({
  label,
  onClick,
  kind = 'create',
  tour,
}: {
  label: string;
  onClick: () => void;
  kind?: ActionKind;
  /** `data-tour` untuk panduan interaktif. */
  tour?: string;
}) {
  const Icon = ACTIONS[kind].icon;
  return (
    <Button
      type="button"
      size="icon"
      aria-label={label}
      data-slot="fab"
      data-tour={tour}
      onClick={onClick}
      className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 size-12 touch:size-12 rounded-full shadow-lg"
    >
      <Icon aria-hidden className="size-5" />
    </Button>
  );
}
