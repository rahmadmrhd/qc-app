import type { QcBridge } from '@countrylock/bridge-contract';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatStamp } from '@/lib/format-stamp';
import { getBridge } from '@/lib/platform';
import { type UseCatalogStatus, useCatalogStatus } from '../use-catalog';

/** Waktu sinkron terakhir untuk tampilan ringkas ("18 Nov 2026 15.30"); `null` bila belum pernah atau tak terbaca. */
export function formatSyncedAt(iso: string | null): string | null {
  if (!iso) return null;
  return Number.isNaN(new Date(iso).getTime()) ? null : formatStamp(iso);
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
      color="primary"
      size="sm"
      onClick={refresh}
      disabled={refreshing}
      aria-label="Sinkronkan katalog"
      title={hint}
      className={warn ? 'text-warning-text' : 'text-muted-foreground'}
    >
      <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
      <span className="hidden text-xs sm:inline">{text}</span>
    </Button>
  );
}

/**
 * Tombol sinkron data offline (Tipe, BU, Lokasi) beserta waktu sinkron terakhir, di baris judul halaman Country Lock (tidak di navbar; keputusan pemilik
 * 2026-11-18). Hanya
 * tampil di desktop berjembatan v5+ yang katalognya aktif; di peramban tidak merender apa pun.
 */
export function CatalogSyncButton({ bridge = getBridge() }: { bridge?: QcBridge | null }) {
  return bridge ? <SyncControl bridge={bridge} /> : null;
}
