import type { MeDto } from '@shared/contract';
import { GUIDE_VERSIONS } from '@shared/guides';
import { canAnywhere } from '@/modules/auth/permissions';
import type { GuideAccess, GuideEntry, GuidePermission, GuideStep } from './types';

export interface GuideOffer {
  entry: GuideEntry;
  /** Jumlah langkah yang lolos izin bagi pengguna ini (selalu >= 1 pada panduan yang ditawarkan). */
  stepCount: number;
  /** Pernah diselesaikan tetapi pada versi lebih rendah dari katalog (label "Diperbarui", spek 4.7). */
  updated: boolean;
}

/** Penanda sapaan login (4.4 spek); entri katalog biasa dengan penanda di penyimpanan yang sama. */
export const GREETING_ID = 'sapaan-awal';

function alternatives(access: GuideAccess): readonly GuidePermission[] {
  return Array.isArray(access)
    ? (access as readonly GuidePermission[])
    : [access as GuidePermission];
}

/**
 * Tanpa `access` = semua pengguna; daftar = salah satu cukup. Izin berlokasi dinilai pada lokasi aktif terpilih
 * (`activeLocationIds`), seperti `visibleNavGroups`.
 */
export function hasAccess(
  me: MeDto,
  access: GuideAccess | undefined,
  activeLocationIds?: readonly string[],
): boolean {
  if (access === undefined) return true;
  return alternatives(access).some((permission) =>
    canAnywhere(
      me,
      permission.module,
      permission.level,
      permission.scope === 'location' ? activeLocationIds : undefined,
    ),
  );
}

/** Langkah yang lolos `izin` per langkah bagi pengguna ini. */
export function stepsFor(
  entry: GuideEntry,
  me: MeDto,
  activeLocationIds?: readonly string[],
): GuideStep[] {
  return entry.steps.filter((step) => hasAccess(me, step.izin, activeLocationIds));
}

/**
 * True bila sapaan login belum ditanyakan pada versi terdaftar (`GUIDE_VERSIONS`): tak ada penanda, atau versi
 * tersimpan lebih rendah (aturan yang sama dengan penawaran panduan lain, spek 4.2).
 */
export function greetingDue(done: ReadonlyMap<string, number>): boolean {
  return (done.get(GREETING_ID) ?? 0) < GUIDE_VERSIONS[GREETING_ID];
}

/**
 * Panduan `dasar` yang menjadi syarat sebuah panduan `baru` (spek 4.2): yang disebut eksplisit lewat
 * `entry.dasar`. Tak ada penyimpulan dari irisan izin: panduan tata letak (tanpa izin) pun punya induk jelas.
 * Tes katalog mewajibkan setiap entri `baru` menyebut `dasar` yang ada.
 */
function dasarOf(baru: GuideEntry, catalog: readonly GuideEntry[]): GuideEntry[] {
  if (baru.dasar === undefined) return [];
  return catalog.filter((candidate) => candidate.id === baru.dasar && candidate.kind === 'dasar');
}

/**
 * Semua panduan yang berhak bagi pengguna (untuk dialog Panduan di menu profil): tanpa memeriksa selesai/belum,
 * prasyarat `baru`, atau `derived`; hanya yang punya langkah berlaku (N >= 1). `tip` dan `sapaan` tidak ikut.
 */
export function eligibleGuides(input: {
  me: MeDto;
  catalog: readonly GuideEntry[];
  activeLocationIds?: readonly string[];
}): GuideOffer[] {
  const { me, catalog, activeLocationIds } = input;
  const result: GuideOffer[] = [];
  for (const entry of catalog) {
    if (entry.kind === 'tip' || entry.kind === 'sapaan') continue;
    if (!hasAccess(me, entry.izin, activeLocationIds)) continue;
    const stepCount = stepsFor(entry, me, activeLocationIds).length;
    if (stepCount > 0) result.push({ entry, stepCount, updated: false });
  }
  return result;
}

/**
 * Aturan penawaran (spek 4.2): berhak, dan (belum ada catatan atau versi tersimpan lebih rendah), dan (bukan `baru`
 * atau `dasar` modulnya sudah selesai). Panduan `diturunkan` hanya menurut `derived` (keadaan perangkat), tidak
 * pernah membaca `done`. Panduan tanpa langkah yang berlaku bagi pengguna (N = 0) tidak ditawarkan. `tip` dan
 * `sapaan` tidak ikut daftar ini (sapaan lewat `greetingDue`).
 */
export function offeredGuides(input: {
  me: MeDto;
  catalog: readonly GuideEntry[];
  done: ReadonlyMap<string, number>;
  derived: ReadonlyMap<string, boolean>;
  activeLocationIds?: readonly string[];
}): GuideOffer[] {
  const { me, catalog, done, derived, activeLocationIds } = input;
  const finished = (entry: GuideEntry) => (done.get(entry.id) ?? 0) >= entry.version;
  /** `dasar` yang tak berlaku bagi pengguna (tanpa izin atau tanpa langkah) tidak menahan panduan `baru`. */
  const dasarSatisfied = (dasar: GuideEntry) =>
    finished(dasar) ||
    !hasAccess(me, dasar.izin, activeLocationIds) ||
    stepsFor(dasar, me, activeLocationIds).length === 0;

  const offers: GuideOffer[] = [];
  for (const entry of catalog) {
    if (entry.kind === 'tip' || entry.kind === 'sapaan') continue;
    if (!hasAccess(me, entry.izin, activeLocationIds)) continue;
    if (entry.status === 'diturunkan') {
      if (derived.get(entry.id) !== true) continue;
    } else {
      if (finished(entry)) continue;
      if (entry.kind === 'baru' && !dasarOf(entry, catalog).every(dasarSatisfied)) continue;
    }
    const stepCount = stepsFor(entry, me, activeLocationIds).length;
    if (stepCount === 0) continue;
    // N1 (spek 4.7): "Diperbarui" = pernah diselesaikan pada versi lebih rendah dari katalog.
    const saved = done.get(entry.id);
    const updated = entry.status === 'disimpan' && saved !== undefined && saved < entry.version;
    offers.push({ entry, stepCount, updated });
  }
  return offers;
}
