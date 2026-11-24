import type { DashboardShareDto, ShareStatus } from '@shared/dashboard-share';
import { wibDateIso } from '@shared/postel';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { type DataColumn, DataTable, LinkCell, type RowAction } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatDayLabel } from '../lib/format';
import { sharesQueryOptions, useRevokeShare } from '../share-queries';
import { RevokeShareDialog } from './revoke-share-dialog';

const STATUS_LABEL: Record<ShareStatus, string> = {
  active: 'Aktif',
  expired: 'Kedaluwarsa',
  revoked: 'Dicabut',
};
const STATUS_COLOR = { active: 'success', expired: 'secondary', revoked: 'destructive' } as const;

const dayOf = (iso: string): string => formatDayLabel(wibDateIso(Date.parse(iso)));

async function copyUrl(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    toast.success('Tautan disalin');
  } catch {
    toast.error('Tautan tidak dapat disalin');
  }
}

/**
 * Daftar tautan yang dibagikan. Pemegang `dashboard: edit` melihat tautannya sendiri; `manage`/super admin melihat
 * semua. Semua baris boleh dicabut; "Salin tautan" muncul bila server mengirim `url`. Status selalu berupa teks, bukan warna saja.
 */
export function SharesDialog({ onClose }: { onClose: () => void }) {
  const shares = useQuery(sharesQueryOptions());
  const revoke = useRevokeShare();
  const [target, setTarget] = useState<DashboardShareDto | null>(null);

  const columns: DataColumn<DashboardShareDto>[] = [
    {
      id: 'title',
      header: 'Nama',
      mobile: 'title',
      cell: (share) => (
        <LinkCell to="/dashboard/tautan/$shareId" params={{ shareId: share.id }}>
          {share.title}
        </LinkCell>
      ),
    },
    { id: 'createdBy', header: 'Pembagi', cell: (share) => share.createdBy },
    { id: 'createdAt', header: 'Dibuat', cell: (share) => dayOf(share.createdAt) },
    { id: 'expiresAt', header: 'Kedaluwarsa', cell: (share) => dayOf(share.expiresAt) },
    { id: 'widgetCount', header: 'Widget', align: 'right', cell: (share) => share.widgetCount },
    {
      id: 'status',
      header: 'Status',
      mobile: 'badge',
      cell: (share) => (
        <Badge variant="soft" color={STATUS_COLOR[share.status]}>
          {STATUS_LABEL[share.status]}
        </Badge>
      ),
    },
  ];
  const actions = (share: DashboardShareDto): RowAction[] => [
    {
      id: 'copy',
      action: 'copy',
      label: `Salin tautan ${share.title}`,
      shortLabel: 'Salin tautan',
      hidden: share.url === undefined,
      onSelect: () => void copyUrl(share.url ?? ''),
    },
    {
      id: 'revoke',
      action: 'delete',
      label: `Cabut tautan ${share.title}`,
      shortLabel: 'Cabut',
      hidden: share.status !== 'active',
      busy: revoke.isPending && target?.id === share.id,
      onSelect: () => setTarget(share),
    },
  ];

  return (
    <>
      <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
        <DialogContent size="full-on-phone" className="sm:max-w-4xl">
          <DialogHeader className="pr-10">
            <DialogTitle>Tautan dibagikan</DialogTitle>
            <DialogDescription>
              Tautan publik dashboard. Mencabut tautan langsung mematikan akses semua pemegangnya.
            </DialogDescription>
          </DialogHeader>
          <DataTable
            rows={shares.data ?? []}
            rowKey={(share) => share.id}
            columns={columns}
            label="Daftar tautan dibagikan"
            selectLabel={(share) => share.title}
            actions={actions}
            empty="Belum ada tautan yang dibagikan."
            isLoading={shares.isPending}
            isError={shares.isLoadingError}
            onRetry={() => void shares.refetch()}
          />
        </DialogContent>
      </Dialog>
      <RevokeShareDialog target={target} onClose={() => setTarget(null)} revoke={revoke} />
    </>
  );
}
