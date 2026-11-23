import {
  DASHBOARD_GROUPS,
  type DashboardGroupId,
  type DashboardRange,
  GROUP_LABELS,
  type WidgetResult,
  widgetMeta,
} from '@shared/dashboard';
import type { PublicDashboardDto } from '@shared/dashboard-public';
import { wibDateIso } from '@shared/postel';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { spanClass } from '../dashboard/components/group-section';
import { WidgetCard } from '../dashboard/components/widgets/widget-card';
import { formatDayLabel, formatRangeLabel } from '../dashboard/lib/format';
import type { DashboardSearch } from '../dashboard/lib/search';
import { isEmptyViewer, PublicDashboardError } from './public-api';
import { PublicGlobalFilters, PublicGroupFilters, viewerFromSearch } from './public-filters';
import { publicDashboardQuery } from './queries';

export interface PublicDashboardPageProps {
  token: string;
  search: DashboardSearch;
  onSearchChange: (patch: Partial<DashboardSearch>) => void;
}

/**
 * Meta halaman publik selama tampil: `robots noindex` (tautan tidak boleh diindeks) dan `referrer no-referrer` (token
 * ada di URL halaman, jadi tak boleh bocor sebagai Referer ke situs lain). Dilepas saat halaman ditutup.
 */
function usePublicMeta(): void {
  useEffect(() => {
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex';
    const referrer = document.createElement('meta');
    referrer.name = 'referrer';
    referrer.content = 'no-referrer';
    document.head.append(robots, referrer);
    return () => {
      robots.remove();
      referrer.remove();
    };
  }, []);
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh bg-muted/40 p-4">
      <main className="mx-auto max-w-7xl space-y-5 py-4">{children}</main>
    </div>
  );
}

/** `24 Nov 2026 02.15 WIB` dari waktu ISO UTC. */
function formatDateTimeWib(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const time = new Date(ms).toLocaleTimeString('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${formatDayLabel(wibDateIso(ms))} ${time} WIB`;
}

function listOrAll(names: readonly string[], all: string): string {
  return names.length > 0 ? names.join(', ') : all;
}

function Header({ dto }: { dto: PublicDashboardDto }) {
  return (
    <header className="space-y-1.5">
      <h1 className="text-2xl font-semibold">{dto.title}</h1>
      <dl className="grid gap-x-6 gap-y-1 text-sm text-muted-foreground sm:grid-cols-2">
        <div className="flex gap-1.5">
          <dt>Periode:</dt>
          <dd className="text-foreground">{formatRangeLabel(dto.range)}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt>BU:</dt>
          <dd className="text-foreground">{listOrAll(dto.scope.buNames, 'Tidak ada')}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Lokasi:</dt>
          <dd className="text-foreground">{listOrAll(dto.scope.locationNames, 'Tidak ada')}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Diperbarui:</dt>
          <dd className="text-foreground">{formatDateTimeWib(dto.generatedAt)}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Dibagikan oleh:</dt>
          <dd className="text-foreground">{dto.sharedBy}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Tautan berlaku sampai:</dt>
          <dd className="text-foreground">
            {formatDayLabel(wibDateIso(Date.parse(dto.expiresAt)))}
          </dd>
        </div>
      </dl>
    </header>
  );
}

function ErrorView({
  error,
  onRetry,
  onClearFilters,
}: {
  error: unknown;
  onRetry: () => void;
  onClearFilters: () => void;
}) {
  const failure = error instanceof PublicDashboardError ? error : null;
  if (failure?.isInvalidLink) {
    return (
      <Shell>
        <section role="alert" className="space-y-2 rounded-lg border bg-card p-5">
          <h1 className="text-xl font-semibold">
            Tautan tidak berlaku atau terlalu banyak permintaan
          </h1>
          <p className="text-sm text-muted-foreground">
            Tautan ke dashboard ini salah, sudah lewat masa berlakunya, atau terlalu sering dicoba.
            Minta tautan baru ke pembagi kalau masih perlu.
          </p>
        </section>
      </Shell>
    );
  }
  if (failure?.isBadFilter) {
    return (
      <Shell>
        <section role="alert" className="space-y-2 rounded-lg border bg-card p-5">
          <h1 className="text-xl font-semibold">Filter tidak dapat diterapkan</h1>
          <p className="text-sm text-muted-foreground">
            Pilihan filter pada tautan ini tidak sah. Hapus filter untuk melihat tampilan bawaan.
          </p>
          <Button
            type="button"
            variant="outline"
            color="primary"
            size="sm"
            onClick={onClearFilters}
          >
            Hapus filter
          </Button>
        </section>
      </Shell>
    );
  }
  return (
    <Shell>
      <section role="alert" className="space-y-2 rounded-lg border bg-card p-5">
        <h1 className="text-xl font-semibold">Dashboard belum bisa dimuat</h1>
        <p className="text-sm text-muted-foreground">
          Koneksi bermasalah atau server sedang sibuk. Coba lagi sebentar lagi.
        </p>
        <Button type="button" variant="outline" color="primary" size="sm" onClick={onRetry}>
          Coba lagi
        </Button>
      </section>
    </Shell>
  );
}

/**
 * Halaman publik dashboard lewat tautan bertanda tangan (spek dashboard bagian 7.4): hanya baca, tanpa navigasi
 * aplikasi, lonceng, atau menu pengguna, dan tanpa delta periode lalu. Bar filter hanya menawarkan `options` dari server
 * (BU/Lokasi di dalam cakupan beku, filter relasi yang ditawarkan pembagi, filter enum grup); filter penonton ada di
 * search param halaman. Semua kegagalan token dan batas laju memakai SATU pesan, sama seperti jawaban server.
 */
export function PublicDashboardPage({ token, search, onSearchChange }: PublicDashboardPageProps) {
  usePublicMeta();
  const viewer = viewerFromSearch(search);
  const query = useQuery(publicDashboardQuery(token, viewer));
  const dto = query.data;
  const unfiltered = isEmptyViewer(viewer);
  // Rentang pembagi (tanpa penyempitan penonton) = batas kolom tanggal; hanya dikenal dari jawaban GET.
  const [bounds, setBounds] = useState<DashboardRange | undefined>(undefined);
  useEffect(() => {
    if (unfiltered && dto && !query.isPlaceholderData) setBounds(dto.range);
  }, [unfiltered, dto, query.isPlaceholderData]);

  const clearFilters = () => {
    const patch: Partial<DashboardSearch> = {};
    for (const key of Object.keys(search)) patch[key] = undefined;
    onSearchChange(patch);
  };

  if (!dto) {
    if (query.isError) {
      return (
        <ErrorView
          error={query.error}
          onRetry={() => void query.refetch()}
          onClearFilters={clearFilters}
        />
      );
    }
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">Memuat dashboard…</p>
      </Shell>
    );
  }

  const groups: { group: DashboardGroupId; widgets: PublicDashboardDto['widgets'] }[] =
    DASHBOARD_GROUPS.map((group) => ({
      group,
      widgets: dto.widgets.filter((widget) => widget.group === group),
    })).filter((entry) => entry.widgets.length > 0);
  const filterState = {
    bu: (search.bu?.length ?? 0) > 0,
    location: (search.loc?.length ?? 0) > 0,
    date: false,
  };
  const resultOf = (widget: PublicDashboardDto['widgets'][number]): WidgetResult =>
    widget.result.status === 'ok'
      ? { id: widget.id, status: 'ok', data: widget.result.data }
      : { id: widget.id, status: 'error', message: widget.result.message };

  return (
    <Shell>
      <Header dto={dto} />
      <PublicGlobalFilters dto={dto} bounds={bounds} search={search} onChange={onSearchChange} />
      {groups.map(({ group, widgets }) => (
        <section key={group} aria-labelledby={`public-group-${group}`} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id={`public-group-${group}`} className="text-lg font-semibold">
              {GROUP_LABELS[group]}
            </h2>
            <PublicGroupFilters group={group} dto={dto} search={search} onChange={onSearchChange} />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-12">
            {widgets.map((widget) => {
              const meta = widgetMeta(widget.id);
              return (
                <div key={widget.id} className={`min-w-0 ${spanClass(meta)}`}>
                  <WidgetCard
                    meta={meta}
                    result={resultOf(widget)}
                    loading={false}
                    filterState={filterState}
                    onRetry={() => void query.refetch()}
                  />
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </Shell>
  );
}
