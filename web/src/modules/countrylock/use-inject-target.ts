// BU dan Lokasi tujuan perangkat yang di-inject (spek desktop §6.6, keputusan pemilik 2026-11-18): dipilih di form inject
// dari katalog offline (jalan tanpa login dan tanpa jaringan) dan dicatat bersama serial di antrean pending, sehingga
// unggah ke Serial Number (BU + lokasi wajib di sana) tidak perlu bertanya lagi. Pilihan terakhir diingat per komputer
// (operator biasanya mengerjakan satu lokasi seharian) dan dibuang bila sudah tak ada di katalog.

import { formatBuLabel } from '@shared/business-units';
import type { DesktopCatalogDto } from '@shared/desktop-catalog';
import { useCallback, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'qc.countrylock.target';

interface Ref {
  id: string;
  code: string;
  name: string;
}

/** Bidang yang dicatat ke pending (`PendingEntry`); kosong semua bila tak ada yang dipilih. */
export interface PendingTarget {
  buId?: string;
  buLabel?: string;
  locationId?: string;
  locationLabel?: string;
}

export interface TargetOption {
  id: string;
  label: string;
}

export interface InjectTarget {
  buId: string;
  locationId: string;
  buOptions: TargetOption[];
  locationOptions: TargetOption[];
  setBu(id: string | null): void;
  setLocation(id: string | null): void;
  /** Nilai yang dicatat ke pending saat inject sukses. */
  pendingTarget: PendingTarget;
}

/** Label lokasi untuk tampilan dan catatan: kode lalu nama (BU memakai `formatBuLabel`, satu pembentuk label BU). */
export const targetLabel = (ref: Pick<Ref, 'code' | 'name'>): string =>
  ref.code === '' ? ref.name : `${ref.code} - ${ref.name}`;

function loadStored(): { buId: string; locationId: string } {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (typeof parsed === 'object' && parsed !== null) {
      const { buId, locationId } = parsed as Record<string, unknown>;
      return {
        buId: typeof buId === 'string' ? buId : '',
        locationId: typeof locationId === 'string' ? locationId : '',
      };
    }
  } catch {
    // Penyimpanan tak tersedia atau isinya rusak: mulai kosong.
  }
  return { buId: '', locationId: '' };
}

function saveStored(value: { buId: string; locationId: string }): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Penyimpanan penuh atau diblokir: pilihan hanya berlaku selama jendela ini terbuka.
  }
}

const NO_REFS: readonly Ref[] = [];

const toOptions = (refs: readonly Ref[], label: (ref: Ref) => string): TargetOption[] =>
  refs.map((ref) => ({ id: ref.id, label: label(ref) }));

/**
 * @param catalog potret katalog (null = belum termuat)
 * @param tipeId Tipe yang dipilih di form: bila ada, BU yang ditawarkan hanya BU milik Tipe itu (serial harus ber-BU
 *   milik item), dan Tipe yang punya tepat satu BU langsung mengisinya.
 */
export function useInjectTarget(
  catalog: DesktopCatalogDto | null,
  tipeId: string | null,
): InjectTarget {
  const [stored] = useState(loadStored);
  const [rawBu, setRawBu] = useState(stored.buId);
  const [rawLocation, setRawLocation] = useState(stored.locationId);

  const tipeItem = tipeId === null ? undefined : catalog?.items.find((item) => item.id === tipeId);
  const buRefs: readonly Ref[] = tipeItem
    ? tipeItem.businessUnits
    : (catalog?.businessUnits ?? NO_REFS);
  const locationRefs: readonly Ref[] = catalog?.locations ?? NO_REFS;

  const buOptions = useMemo(() => toOptions(buRefs, formatBuLabel), [buRefs]);
  const locationOptions = useMemo(() => toOptions(locationRefs, targetLabel), [locationRefs]);

  // Nilai yang berlaku = pilihan yang masih ada di daftar; selain itu kosong (tanpa menimpa ingatan sebelum katalog termuat).
  const buId = buRefs.some((ref) => ref.id === rawBu) ? rawBu : '';
  const locationId = locationRefs.some((ref) => ref.id === rawLocation) ? rawLocation : '';

  // Tipe berganti: BU ikut Tipe (satu BU = terisi sendiri; BU terpilih yang bukan milik Tipe dilepas).
  const tipeBuKey = tipeItem?.businessUnits.map((ref) => ref.id).join(',') ?? null;
  useEffect(() => {
    if (tipeBuKey === null) return;
    const ids = tipeBuKey === '' ? [] : tipeBuKey.split(',');
    setRawBu((previous) => {
      const only = ids[0];
      if (ids.length === 1 && only !== undefined) return only;
      return ids.includes(previous) ? previous : '';
    });
  }, [tipeBuKey]);

  // Hanya ada satu lokasi aktif: terisi sendiri (saat katalog termuat atau daftar berubah; mengosongkannya sesudah itu tetap boleh).
  const onlyLocation = locationRefs.length === 1 ? locationRefs[0]?.id : undefined;
  useEffect(() => {
    if (onlyLocation !== undefined) setRawLocation(onlyLocation);
  }, [onlyLocation]);

  useEffect(() => {
    saveStored({ buId: rawBu, locationId: rawLocation });
  }, [rawBu, rawLocation]);

  const setBu = useCallback((id: string | null) => setRawBu(id ?? ''), []);
  const setLocation = useCallback((id: string | null) => setRawLocation(id ?? ''), []);

  const pendingTarget = useMemo<PendingTarget>(() => {
    const target: PendingTarget = {};
    const bu = buRefs.find((ref) => ref.id === buId);
    if (bu) {
      target.buId = bu.id;
      target.buLabel = formatBuLabel(bu);
    }
    const location = locationRefs.find((ref) => ref.id === locationId);
    if (location) {
      target.locationId = location.id;
      target.locationLabel = targetLabel(location);
    }
    return target;
  }, [buRefs, locationRefs, buId, locationId]);

  return { buId, locationId, buOptions, locationOptions, setBu, setLocation, pendingTarget };
}
