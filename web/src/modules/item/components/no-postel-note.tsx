import { cn } from '@/lib/utils';

/** Tanda kecil "belum ada Postel"; dipakai tabel daftar item dan detail item. */
export function NoPostelNote({ className }: { className?: string }) {
  return <span className={cn('text-xs text-muted-foreground', className)}>Belum ada Postel</span>;
}
