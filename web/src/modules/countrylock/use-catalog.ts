// Katalog offline (Tipe, BU, lokasi) di desktop (spek desktop §6.6): potret tersimpan + status sinkron dari jembatan.
// Jembatan lama (di bawah v5) tidak punya `catalog`: hook mengembalikan `supported: false` dan tak memanggil apa pun,
// sehingga UI hibrid yang lebih baru tetap jalan di aplikasi desktop yang belum diperbarui.

import { CATALOG_BRIDGE_VERSION, CATALOG_FILES_PATH } from '@countrylock/bridge-channels';
import type { CatalogSnapshot, CatalogStatus, QcBridge } from '@countrylock/bridge-contract';
import { useCallback, useEffect, useState } from 'react';

/** Alamat gambar katalog di origin `app://qc` (disajikan proses utama dari cache lokal). */
export const catalogImageUrl = (id: string): string =>
  `${CATALOG_FILES_PATH}${encodeURIComponent(id)}`;

export function supportsCatalog(bridge: QcBridge): boolean {
  return bridge.version >= CATALOG_BRIDGE_VERSION && typeof bridge.catalog === 'object';
}

export interface UseCatalog {
  supported: boolean;
  snapshot: CatalogSnapshot | null;
  status: CatalogStatus | null;
  refreshing: boolean;
  refresh(): void;
}

export interface UseCatalogStatus {
  supported: boolean;
  status: CatalogStatus | null;
  refreshing: boolean;
  refresh(): void;
}

/**
 * Hanya status sinkron (tanpa membaca potret): untuk tombol sinkron di navbar yang tampil di semua halaman desktop,
 * terpisah dari `useCatalog` milik halaman Country Lock.
 */
export function useCatalogStatus(bridge: QcBridge): UseCatalogStatus {
  const supported = supportsCatalog(bridge);
  const [status, setStatus] = useState<CatalogStatus | null>(null);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    void bridge.catalog
      .status()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => undefined);
    const stop = bridge.catalog.onChange((next) => setStatus(next));
    return () => {
      cancelled = true;
      stop();
    };
  }, [bridge, supported]);

  const refresh = useCallback(() => {
    if (!supported) return;
    void bridge.catalog.refresh().catch(() => undefined);
  }, [bridge, supported]);

  return { supported, status, refreshing: status?.state === 'syncing', refresh };
}

export function useCatalog(bridge: QcBridge): UseCatalog {
  const supported = supportsCatalog(bridge);
  const [snapshot, setSnapshot] = useState<CatalogSnapshot | null>(null);
  const [status, setStatus] = useState<CatalogStatus | null>(null);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    const loadSnapshot = (): void => {
      void bridge.catalog
        .get()
        .then((next) => {
          if (!cancelled) setSnapshot(next);
        })
        .catch(() => undefined);
    };
    void bridge.catalog
      .status()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => undefined);
    loadSnapshot();
    const stop = bridge.catalog.onChange((next) => {
      setStatus(next);
      // Potret baru hanya ada setelah sinkron sukses.
      if (next.state === 'ok') loadSnapshot();
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [bridge, supported]);

  const refresh = useCallback(() => {
    if (!supported) return;
    void bridge.catalog.refresh().catch(() => undefined);
  }, [bridge, supported]);

  return { supported, snapshot, status, refreshing: status?.state === 'syncing', refresh };
}
