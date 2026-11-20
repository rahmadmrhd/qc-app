import type { LocatedModule } from '@shared/assignments';
import { isLocatedModule } from '@shared/assignments';
import type { BuModule } from '@shared/business-units';
import type {
  BusinessUnitAccessDto,
  BusinessUnitRefDto,
  LocationAccessDto,
  MeDto,
} from '@shared/contract';
import type { Level, ModuleKey } from '@shared/permissions';
import { hasLevel } from '@shared/permissions';
import type { ActorModules } from '@shared/serial-flow';
import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { meQueryOptions } from './queries';

/**
 * Izin GLOBAL (penugasan "Semua lokasi"); benar untuk modul `access`.
 * Untuk modul berlokasi pakai `canAt`, `locationsWith`, atau `canAnywhere`.
 * Hanya untuk UX — penegakan sebenarnya ada di router server.
 */
export function can(me: MeDto | null | undefined, module: ModuleKey, level: Level): boolean {
  return me ? hasLevel(me.permissions[module], level) : false;
}

export function canAt(
  me: MeDto | null | undefined,
  module: LocatedModule,
  level: Level,
  locationId: string,
): boolean {
  const location = me?.locations.find((item) => item.id === locationId);
  return location ? hasLevel(location.permissions[module], level) : false;
}

/** Lokasi (opsional dibatasi ke `among`) tempat user punya minimal `level` pada modul berlokasi. */
export function locationsWith(
  me: MeDto | null | undefined,
  module: LocatedModule,
  level: Level,
  among?: readonly string[],
): LocationAccessDto[] {
  if (!me) return [];
  return me.locations.filter(
    (item) => (!among || among.includes(item.id)) && hasLevel(item.permissions[module], level),
  );
}

export function canAnywhere(
  me: MeDto | null | undefined,
  module: ModuleKey,
  level: Level,
  among?: readonly string[],
): boolean {
  if (!me) return false;
  return isLocatedModule(module)
    ? locationsWith(me, module, level, among).length > 0
    : can(me, module, level);
}

export async function requirePermission(
  queryClient: QueryClient,
  module: ModuleKey,
  level: Level,
): Promise<void> {
  const me = await queryClient.ensureQueryData(meQueryOptions());
  if (!canAnywhere(me, module, level)) throw redirect({ to: '/forbidden' });
}

/** Lolos bila SALAH SATU alternatif terpenuhi di minimal satu lokasi (modul berlokasi) atau global. */
export async function requireAnyPermission(
  queryClient: QueryClient,
  alternatives: ReadonlyArray<{ module: ModuleKey; level: Level }>,
): Promise<void> {
  const me = await queryClient.ensureQueryData(meQueryOptions());
  if (!alternatives.some((item) => canAnywhere(me, item.module, item.level))) {
    throw redirect({ to: '/forbidden' });
  }
}

/**
 * `MeDto.businessUnits` bisa `undefined` pada `me` yang dipulihkan dari localStorage oleh `app/query-persist.ts`
 * (bundel lama menyimpan bentuk lama) sebelum dimuat ulang: semua helper BU menganggapnya kosong.
 */
function itemBusinessUnits(me: MeDto | null | undefined): readonly BusinessUnitAccessDto[] {
  return me?.businessUnits ?? [];
}

/** Id BU (aktif maupun nonaktif) tempat user punya minimal `level` pada modul ber-BU `module`. */
export function buIdsWithLevelOf(
  me: MeDto | null | undefined,
  module: BuModule,
  level: Level,
): string[] {
  return itemBusinessUnits(me)
    .filter((bu) => hasLevel(bu.permissions[module], level))
    .map((bu) => bu.id);
}

/** Seperti `buIdsWithLevelOf` tetapi tanpa BU terhapus: untuk PILIHAN dan filter (BU terhapus hanya memberi hak). */
export function liveBuIdsWithLevelOf(
  me: MeDto | null | undefined,
  module: BuModule,
  level: Level,
): string[] {
  return itemBusinessUnits(me)
    .filter((bu) => !bu.deleted && hasLevel(bu.permissions[module], level))
    .map((bu) => bu.id);
}

/** Id BU yang terhapus di antara BU berhak user (diabaikan syarat "SEMUA BU", keputusan soft delete 9). */
function deletedBuIdsOf(me: MeDto | null | undefined): Set<string> {
  return new Set(
    itemBusinessUnits(me)
      .filter((bu) => bu.deleted)
      .map((bu) => bu.id),
  );
}

/** Id BU (aktif maupun nonaktif) tempat user punya minimal `level` pada modul `item`. */
export function buIdsWithLevelFor(me: MeDto | null | undefined, level: Level): string[] {
  return buIdsWithLevelOf(me, 'item', level);
}

/**
 * Boleh memanggil `serials.locationOptions` (gerbang server: `serial: edit` global; laporan rusak 2026-11-14 §3 butir h:
 * tim servis tidak lagi memilih lokasi). Pembaca tanpa izin itu memakai lokasi dari `me.locations` agar tidak memicu 403.
 */
export function canUseSerialLocationOptions(me: MeDto | null | undefined): boolean {
  return can(me, 'serial', 'edit');
}

/** Modul yang dipegang pengguna pada level `edit` di BU serial itu (masukan `availableActions`/`resolveAction`). */
export function serialActorModules(me: MeDto | null | undefined, buId: string): ActorModules {
  return {
    serial: buIdsWithLevelOf(me, 'serial', 'edit').includes(buId),
    serialservice: buIdsWithLevelOf(me, 'serialservice', 'edit').includes(buId),
  };
}

/**
 * Mengatur penerima surel Serial Number rusak: penanda dihitung SERVER (`auth.me`, aturan yang sama dengan penjaga
 * `serialSettings.get|save`: super admin, atau `serial: manage` pada setiap BU).
 */
export function canManageSerialSettings(me: MeDto | null | undefined): boolean {
  return me?.canManageSerialSettings === true;
}

/** Mencatat serial: level `edit` pada minimal satu BU. */
export function canWriteSerials(me: MeDto | null | undefined): boolean {
  return buIdsWithLevelOf(me, 'serial', 'edit').length > 0;
}

function hasLevelOnAllBus(
  me: MeDto | null | undefined,
  item: { businessUnits?: readonly BusinessUnitRefDto[] },
  level: Level,
): boolean {
  const attached = item.businessUnits ?? [];
  if (attached.length === 0) return false;
  const allowed = new Set(buIdsWithLevelFor(me, level));
  // Sama dengan `canActOnAllBus` server: BU terhapus diabaikan selama masih ada BU hidup pada item.
  const deleted = deletedBuIdsOf(me);
  const live = attached.filter((bu) => !deleted.has(bu.id));
  return (live.length > 0 ? live : attached).every((bu) => allowed.has(bu.id));
}

/** Ubah item: `edit` pada SEMUA BU item (keputusan 13). Item tanpa BU tidak dapat diubah. */
export function canEditItem(
  me: MeDto | null | undefined,
  item: { businessUnits?: readonly BusinessUnitRefDto[] },
): boolean {
  return hasLevelOnAllBus(me, item, 'edit');
}

/** Nonaktifkan/aktifkan item: `manage` pada SEMUA BU item. */
export function canManageItem(
  me: MeDto | null | undefined,
  item: { businessUnits?: readonly BusinessUnitRefDto[] },
): boolean {
  return hasLevelOnAllBus(me, item, 'manage');
}

/** Buat item: ada minimal satu BU aktif ber-`edit`. */
export function canCreateItem(me: MeDto | null | undefined): boolean {
  return itemBusinessUnits(me).some(
    (bu) => bu.status === 'active' && !bu.deleted && hasLevel(bu.permissions.item, 'edit'),
  );
}
