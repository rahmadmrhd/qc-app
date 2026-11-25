import {
  type DashboardGroupId,
  GROUP_FILTERS,
  GROUP_LABELS,
  type WidgetId,
  widgetMeta,
} from '@shared/dashboard';
import type {
  DashboardShareDetailDto,
  ShareStatus,
  ShareWidgetScope,
} from '@shared/dashboard-share';
import type { ShareVisitDto } from '@shared/dashboard-visit';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { type DataColumn, DataTable } from '@/components/data-table';
import { PageContent } from '@/components/page/page-container';
import { DetailList, ViewMeta, ViewPage, ViewSection } from '@/components/page/view-page';
import { DeletedBadge } from '@/components/soft-delete/deleted-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { ActivityLog } from '@/modules/activity/components/activity-log';
import { formatNumber, formatRangeLabel, formatWhen } from '../lib/format';
import { shareDetailQueryOptions, useRevokeShare } from '../share-queries';
import { EditShareDialog } from './edit-share-dialog';
import { RevokeShareDialog } from './revoke-share-dialog';

const STATUS_LABEL: Record<ShareStatus, string> = {
  active: 'Aktif',
  expired: 'Kedaluwarsa',
  revoked: 'Dicabut',
};
const STATUS_COLOR = { active: 'success', expired: 'secondary', revoked: 'destructive' } as const;

const GROUP_ORDER = Object.keys(GROUP_LABELS) as DashboardGroupId[];

/** Tautan tak ada atau di luar hak baca: server menjawab `NOT_FOUND` seragam (`FORBIDDEN` bagi tanpa modul). */
function isMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN');
}

/** Kode negara dua huruf menjadi "Indonesia (ID)"; kosong atau tak dikenal = teks apa adanya, dirender sebagai teks. */
function countryLabel(code: string): string {
  if (code === '') return 'Tidak diketahui';
  try {
    const name = new Intl.DisplayNames(['id'], { type: 'region' }).of(code);
    return name && name !== code ? `${name} (${code})` : code;
  } catch {
    return code;
  }
}

async function copyUrl(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    toast.success('Tautan disalin');
  } catch {
    toast.error('Tautan tidak dapat disalin');
  }
}

interface WidgetGroupView {
  group: DashboardGroupId | 'unknown';
  label: string;
  widgets: { id: string; title: string; filters: string[] }[];
}

/**
 * Widget dikelompokkan menurut grup; nilai filter relasi memakai NAMA dari `valueNames` (id tanpa nama, mis. di luar hak
 * pembaca atau sudah terhapus, tampil "Tidak dikenal"), nilai enum memakai label opsinya. Id widget yang sudah tidak ada
 * di registri tidak menjatuhkan halaman.
 */
function groupWidgets(
  widgets: readonly ShareWidgetScope[],
  valueNames: Record<string, string>,
): WidgetGroupView[] {
  const byGroup = new Map<DashboardGroupId, WidgetGroupView['widgets']>();
  const unknown: WidgetGroupView['widgets'] = [];
  for (const widget of widgets) {
    let meta: ReturnType<typeof widgetMeta>;
    try {
      meta = widgetMeta(widget.id as WidgetId);
    } catch {
      unknown.push({ id: widget.id, title: 'Widget tidak dikenal', filters: [] });
      continue;
    }
    const filters = GROUP_FILTERS[meta.group].flatMap((field) => {
      const values = widget.filters[field.key] ?? [];
      if (values.length === 0) return [];
      const labels = values.map((value) =>
        field.kind === 'enum'
          ? (field.options?.find((option) => option.value === value)?.label ?? 'Tidak dikenal')
          : (valueNames[value] ?? 'Tidak dikenal'),
      );
      return [`${field.label}: ${labels.join(', ')}`];
    });
    const list = byGroup.get(meta.group) ?? [];
    list.push({ id: widget.id, title: meta.title, filters });
    byGroup.set(meta.group, list);
  }
  const grouped: WidgetGroupView[] = GROUP_ORDER.flatMap((group) => {
    const list = byGroup.get(group);
    return list ? [{ group, label: GROUP_LABELS[group], widgets: list }] : [];
  });
  return unknown.length > 0
    ? [...grouped, { group: 'unknown', label: 'Lainnya', widgets: unknown }]
    : grouped;
}

/** Nama filter relasi yang ditawarkan ke penonton, berlabel dari definisi filter grup. */
function offerLabels(offers: readonly string[]): string[] {
  const labels = new Map<string, string>();
  for (const fields of Object.values(GROUP_FILTERS)) {
    for (const field of fields) if (!labels.has(field.key)) labels.set(field.key, field.label);
  }
  return offers.map((key) => labels.get(key) ?? key);
}

function rangeText(scope: DashboardShareDetailDto['scope']): string {
  return scope.range.mode === 'fixed'
    ? `${formatRangeLabel(scope.range)} (tetap)`
    : `${scope.range.days} hari terakhir (bergulir)`;
}

function Summary({ share }: { share: DashboardShareDetailDto }) {
  return (
    <section aria-label="Ringkasan tautan">
      <DetailList
        items={[
          { label: 'Nama', value: share.title },
          {
            label: 'Status',
            value: (
              <Badge variant="soft" color={STATUS_COLOR[share.status]}>
                {STATUS_LABEL[share.status]}
              </Badge>
            ),
          },
          { label: 'Dibagikan oleh', value: share.createdBy },
          { label: 'Dibuat', value: formatWhen(share.createdAt) },
          { label: 'Berlaku sampai', value: formatWhen(share.expiresAt) },
          {
            label: 'Dicabut',
            value: `${formatWhen(share.revokedAt)}${share.revokedBy ? ` oleh ${share.revokedBy}` : ''}`,
            hidden: share.revokedAt === '',
          },
          { label: 'Jumlah widget', value: formatNumber(share.widgetCount) },
        ]}
      />
    </section>
  );
}

/** Nama cakupan beku; yang sudah dihapus tetap bernama dengan penanda kit (spek soft delete bagian 5). */
function NameList({
  names,
  deleted,
  empty,
}: {
  names: readonly string[];
  deleted: readonly boolean[];
  empty: string;
}) {
  if (names.length === 0) return <>{empty}</>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {names.map((name, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: nama boleh kembar; urutan tetap (cakupan beku)
        <span key={index} className="inline-flex items-center gap-1">
          {name}
          {deleted[index] === true ? <DeletedBadge /> : null}
        </span>
      ))}
    </span>
  );
}

function ScopeSection({ scope }: { scope: DashboardShareDetailDto['scope'] }) {
  const groups = groupWidgets(scope.widgets, scope.valueNames);
  const offers = offerLabels(scope.offers);
  return (
    <div className="space-y-4">
      <DetailList
        items={[
          { label: 'Periode', value: rangeText(scope) },
          {
            label: 'Business Unit',
            value: <NameList names={scope.buNames} deleted={scope.buDeleted} empty="Tidak ada" />,
          },
          {
            label: 'Lokasi',
            value: (
              <NameList
                names={scope.locationNames}
                deleted={scope.locationDeleted}
                empty="Tidak dibatasi"
              />
            ),
          },
          {
            label: 'Pembatasan lokasi',
            value: scope.locationFiltered ? 'Juga berlaku untuk Serial dan Laporan' : undefined,
            hidden: !scope.locationFiltered,
          },
          {
            label: 'Filter untuk penonton',
            value: offers.length > 0 ? offers.join(', ') : 'Tidak ada',
          },
        ]}
      />
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Widget</h3>
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">Tidak ada widget.</p>
        ) : (
          groups.map((entry) => (
            <section key={entry.group} aria-label={entry.label} className="space-y-1">
              <h4 className="text-sm font-medium text-muted-foreground">{entry.label}</h4>
              <ul className="space-y-1 text-sm">
                {entry.widgets.map((widget) => (
                  <li key={widget.id}>
                    {widget.title}
                    {widget.filters.length > 0 ? (
                      <span className="block text-xs text-muted-foreground">
                        {widget.filters.join(' · ')}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function VisitsSection({ share }: { share: DashboardShareDetailDto }) {
  const rows = share.visits.map((visit, index) => ({ ...visit, key: String(index) }));
  const columns: DataColumn<ShareVisitDto & { key: string }>[] = [
    { id: 'visitedAt', header: 'Waktu', mobile: 'title', cell: (row) => formatWhen(row.visitedAt) },
    { id: 'country', header: 'Negara', cell: (row) => countryLabel(row.country) },
    { id: 'device', header: 'Perangkat', cell: (row) => row.device || 'Tidak diketahui' },
    { id: 'ipPrefix', header: 'Jaringan', cell: (row) => row.ipPrefix || 'Tidak diketahui' },
  ];
  return (
    <div className="space-y-3">
      <DetailList
        items={[
          { label: 'Jumlah kunjungan', value: formatNumber(share.visitCount) },
          {
            label: 'Pertama dibuka',
            value: share.firstVisitAt ? formatWhen(share.firstVisitAt) : undefined,
          },
          {
            label: 'Terakhir dibuka',
            value: share.lastVisitAt ? formatWhen(share.lastVisitAt) : undefined,
          },
        ]}
      />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada yang membuka tautan.</p>
      ) : (
        <DataTable
          rows={rows}
          rowKey={(row) => row.key}
          columns={columns}
          label="Kunjungan terbaru"
          fit="content"
          empty="Belum ada yang membuka tautan."
        />
      )}
      <p className="text-xs text-muted-foreground">
        Hanya halaman yang berhasil dibuka yang dihitung. Pembukaan berulang dari jaringan dan
        perangkat yang sama dalam 30 menit dihitung satu kunjungan.
        {share.visitCount > share.visits.length
          ? ` Tabel menampilkan ${formatNumber(share.visits.length)} kunjungan terbaru.`
          : ''}{' '}
        Alamat IP asli tidak disimpan; yang tampil hanya awalan jaringannya.
      </p>
    </div>
  );
}

export interface ShareDetailViewProps {
  shareId: string;
  /** Kembali ke Dashboard (tombol pada keadaan tidak ditemukan/galat). */
  onBack: () => void;
}

/**
 * View satu tautan dashboard publik (kit CRUD, `ViewPage` tanpa tab): ringkasan, cakupan beku dengan NAMA (BU, lokasi,
 * periode, widget per grup beserta filternya), dan kunjungan. Aksi: "Salin tautan" hanya bila server mengirim `url`
 * (pembagi atau super admin, tautan aktif), "Cabut tautan" hanya bagi tautan aktif. Panel samping: pembuat dan log
 * aktivitas (dibuat, dicabut, kedaluwarsa).
 */
export function ShareDetailView({ shareId, onBack }: ShareDetailViewProps) {
  const detail = useQuery(shareDetailQueryOptions(shareId));
  const revoke = useRevokeShare();
  const stack = useStackNavigation();
  const [revoking, setRevoking] = useState(false);
  const [editing, setEditing] = useState(false);
  const share = detail.data;
  if (detail.isPending) {
    return (
      <PageContent>
        <p className="text-sm text-muted-foreground">Memuat…</p>
      </PageContent>
    );
  }
  if (detail.isError || !share) {
    const missing = isMissing(detail.error);
    return (
      <PageContent className="space-y-4">
        <h1 className="text-2xl font-semibold">
          {missing ? 'Tautan tidak ditemukan' : 'Tautan tidak dapat dimuat'}
        </h1>
        {missing ? null : (
          <p role="alert" className="text-sm text-destructive-text">
            {describeError(detail.error)}
          </p>
        )}
        <Button variant="outline" color="primary" onClick={onBack}>
          Kembali ke Dashboard
        </Button>
      </PageContent>
    );
  }
  const url = share.url;
  return (
    <>
      <ViewPage
        title={share.title}
        badge={
          <Badge variant="soft" color={STATUS_COLOR[share.status]}>
            {STATUS_LABEL[share.status]}
          </Badge>
        }
        actionItems={[
          {
            id: 'copy',
            action: 'copy',
            label: 'Salin tautan',
            primary: true,
            hidden: url === undefined,
            onSelect: () => void copyUrl(url ?? ''),
          },
          {
            id: 'edit',
            action: 'edit',
            label: 'Ubah konfigurasi',
            primary: true,
            hidden:
              share.status === 'revoked' || (share.reportId === '' && share.status === 'expired'),
            onSelect: () =>
              share.reportId === ''
                ? setEditing(true)
                : stack.push({
                    to: '/dashboard/laporan/$reportId/edit',
                    params: { reportId: share.reportId },
                  }),
          },
          {
            id: 'revoke',
            action: 'delete',
            label: 'Cabut tautan',
            hidden: share.status !== 'active',
            onSelect: () => setRevoking(true),
          },
        ]}
        aside={
          <>
            <ViewMeta createdBy={share.createdBy} createdAt={share.createdAt} />
            <ActivityLog kind="dashboardShare" id={share.id} createdAt={share.createdAt} />
          </>
        }
      >
        <ViewSection title="Ringkasan">
          <Summary share={share} />
        </ViewSection>
        <ViewSection title="Cakupan yang dibagikan">
          <ScopeSection scope={share.scope} />
        </ViewSection>
        <ViewSection title="Kunjungan">
          <VisitsSection share={share} />
        </ViewSection>
      </ViewPage>
      {editing ? <EditShareDialog shareId={share.id} onClose={() => setEditing(false)} /> : null}
      <RevokeShareDialog
        target={revoking ? { id: share.id, title: share.title } : null}
        onClose={() => setRevoking(false)}
        revoke={revoke}
      />
    </>
  );
}
