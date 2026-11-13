import type { MeDto } from '@shared/contract';
import type { ModuleKey } from '@shared/permissions';
import { canAnywhere } from '@/modules/auth/permissions';
import type { GuideAccess, GuideEntry, GuidePermission, GuideStep } from './types';

export interface GuideOffer {
  entry: GuideEntry;
  /** Jumlah langkah yang lolos izin bagi pengguna ini (selalu >= 1 pada panduan yang ditawarkan). */
  stepCount: number;
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

/** True bila sapaan login belum pernah ditanyakan (penanda `sapaan-awal` belum ada). */
export function greetingDue(done: ReadonlyMap<string, number>): boolean {
  return !done.has(GREETING_ID);
}

function modulesOf(access: GuideAccess | undefined): Set<ModuleKey> {
  return new Set(access === undefined ? [] : alternatives(access).map((item) => item.module));
}

/**
 * Panduan `dasar` yang menjadi syarat sebuah panduan `baru`: yang mencakupnya (`covers`) atau yang modul izinnya
 * beririsan dengan izin panduan `baru` itu ("dasar modul itu", spek 4.2).
 */
function dasarOf(baru: GuideEntry, catalog: readonly GuideEntry[]): GuideEntry[] {
  const modules = modulesOf(baru.izin);
  return catalog.filter(
    (candidate) =>
      candidate.kind === 'dasar' &&
      candidate.status === 'disimpan' &&
      (candidate.covers?.includes(baru.id) === true ||
        [...modulesOf(candidate.izin)].some((module) => modules.has(module))),
  );
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
    if (stepCount > 0) result.push({ entry, stepCount });
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
    offers.push({ entry, stepCount });
  }
  return offers;
}
