import type { QcBridge } from '@countrylock/bridge-contract';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getBridge } from '@/lib/platform';
import { type UseCatalogStatus, useCatalogStatus } from '../use-catalog';

/** Waktu sinkron terakhir untuk tampilan ringkas ("18 Nov 2026 15.30"); `null` bila belum pernah atau tak terbaca. */
export function formatSyncedAt(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

function describe(status: NonNullable<UseCatalogStatus['status']>): {
  text: string;
  hint: string;
  warn: boolean;
} {
  if (status.state === 'syncing') {
    return { text: 'Menyinkronkan...', hint: 'Sedang menyinkronkan data offline.', warn: false };
  }
  const when = formatSyncedAt(status.syncedAt);
  const last = when ? `Sinkron terakhir: ${when}` : 'Belum pernah sinkron';
  if (status.state === 'error') {
    return {
      text: last,
      hint:
        status.error === 'REJECTED'
          ? 'Server menolak sinkron (token tidak cocok atau katalog dinonaktifkan di server). Data tersimpan terakhir tetap dipakai.'
          : 'Tidak dapat terhubung ke server. Data tersimpan terakhir tetap dipakai.',
      warn: true,
    };
  }
  return {
    text: last,
    hint: `${last}. Data offline: Tipe, BU, dan Lokasi (${status.itemCount} Tipe).`,
    warn: false,
  };
}

function SyncControl({ bridge }: { bridge: QcBridge }) {
  const { supported, status, refreshing, refresh } = useCatalogStatus(bridge);
  // Jembatan lama, build tanpa token katalog, atau status belum terbaca: tak ada yang ditampilkan.
  if (!supported || status === null || status.state === 'disabled') return null;
  const { text, hint, warn } = describe(status);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={refresh}
      disabled={refreshing}
      aria-label="Sinkronkan katalog"
      title={hint}
      className={warn ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}
    >
      <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
      <span className="hidden text-xs lg:inline">{text}</span>
    </Button>
  );
}

/**
 * Tombol sinkron data offline (Tipe, BU, Lokasi) beserta waktu sinkron terakhir, di navbar aplikasi desktop. Hanya
 * tampil di desktop berjembatan v5+ yang katalognya aktif; di peramban tidak merender apa pun.
 */
export function CatalogSyncButton({ bridge = getBridge() }: { bridge?: QcBridge | null }) {
  return bridge ? <SyncControl bridge={bridge} /> : null;
}
