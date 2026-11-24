import type { ReportStatus } from '@shared/dashboard-report';
import { Badge } from '@/components/ui/badge';

const STATUS_LABEL: Record<ReportStatus, string> = {
  '': 'Belum pernah dikirim',
  ok: 'Terkirim',
  skipped: 'Dilewati',
  error: 'Gagal',
};
const STATUS_COLOR = {
  '': 'secondary',
  ok: 'success',
  skipped: 'warning',
  error: 'destructive',
} as const;

/** Hasil pengiriman terakhir: selalu berupa kata, bukan warna saja. */
export function ReportStatusBadge({ status }: { status: ReportStatus }) {
  return (
    <Badge variant="soft" color={STATUS_COLOR[status]}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

/** Status aktif atau dijeda (bukan hasil kirim). */
export function ReportEnabledBadge({ enabled }: { enabled: boolean }) {
  return (
    <Badge variant="soft" color={enabled ? 'success' : 'secondary'}>
      {enabled ? 'Aktif' : 'Dijeda'}
    </Badge>
  );
}
