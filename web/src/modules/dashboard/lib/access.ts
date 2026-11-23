import { BU_MODULES, type BuModule } from '@shared/business-units';
import type { MeDto } from '@shared/contract';
import {
  DASHBOARD_GROUPS,
  type DashboardGroupId,
  WIDGETS,
  type WidgetMeta,
} from '@shared/dashboard';
import { buIdsWithLevelOf, can, canAnywhere } from '@/modules/auth/permissions';

const isBuModule = (module: string): module is BuModule =>
  (BU_MODULES as readonly string[]).includes(module);

/**
 * Widget boleh dilihat bila SALAH SATU entri `meta.access` terpenuhi (cermin `widgetAllowed` di server; hanya untuk
 * UX, server tetap menyaring): global = izin global, BU = level pada minimal satu BU, lokasi = level di minimal satu
 * lokasi.
 */
export function widgetVisible(me: MeDto | null | undefined, meta: WidgetMeta): boolean {
  return meta.access.some((entry) => {
    if (entry.scope === 'global') return can(me, entry.module, entry.level);
    if (entry.scope === 'bu') {
      return isBuModule(entry.module) && buIdsWithLevelOf(me, entry.module, entry.level).length > 0;
    }
    return canAnywhere(me, entry.module, entry.level);
  });
}

/** Widget yang boleh dilihat, per grup (urutan grup dan widget tetap; grup kosong dibuang). */
export function visibleWidgetsByGroup(
  me: MeDto | null | undefined,
): { group: DashboardGroupId; widgets: WidgetMeta[] }[] {
  return DASHBOARD_GROUPS.map((group) => ({
    group,
    widgets: WIDGETS.filter((meta) => meta.group === group && widgetVisible(me, meta)),
  })).filter((entry) => entry.widgets.length > 0);
}

/** Ada minimal satu widget yang boleh dilihat (menentukan butir menu Dashboard). */
export function canSeeDashboard(me: MeDto | null | undefined): boolean {
  return WIDGETS.some((meta) => widgetVisible(me, meta));
}
