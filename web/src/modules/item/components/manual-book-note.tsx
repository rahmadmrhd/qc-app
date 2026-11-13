import { cn } from '@/lib/utils';

/** Tanda kecil "belum ada QR Manual Book"; dipakai tabel daftar item dan detail item. */
export function NoManualBookNote({ className }: { className?: string }) {
  return (
    <span className={cn('text-xs text-muted-foreground', className)}>Belum ada QR Manual Book</span>
  );
}
