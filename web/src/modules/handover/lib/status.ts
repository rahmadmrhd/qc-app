import type { HandoverStatus } from '@shared/handover';

export const HANDOVER_STATUS_LABELS: Record<HandoverStatus, string> = {
  new: 'Baru',
  in_progress: 'Dikerjakan',
  done: 'Selesai',
  cancelled: 'Dibatalkan',
};

/** Varian `Badge` shadcn; status tidak hanya dibedakan lewat warna (label teks selalu tampil). */
export function handoverStatusVariant(
  status: HandoverStatus,
): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (status === 'done') return 'default';
  if (status === 'cancelled') return 'destructive';
  if (status === 'in_progress') return 'secondary';
  return 'outline';
}
