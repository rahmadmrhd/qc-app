import type { Preparer } from '@server/core/db';
import type { Env } from '@server/core/env';
import type { WidgetData, WidgetId } from '@shared/dashboard';
import type { ResolvedScope } from './scope';
import { ALL_WIDGETS } from './widgets';

/** Masukan satu widget: cakupan SUDAH diselesaikan (`resolveScope`), jadi widget tak pernah membaca filter mentah. */
export interface WidgetCtx {
  /** Env penuh, hanya untuk widget yang membaca pengaturan (mis. ambang "segera habis" Postel); kueri data memakai `db`. */
  env: Env;
  db: Preparer;
  scope: ResolvedScope;
  /** Filter grup yang sudah divalidasi (`validateDashboardQuery`); kunci terdaftar di `GROUP_FILTERS`. */
  filters: Record<string, string[]>;
}

export interface WidgetImpl {
  id: WidgetId;
  run(ctx: WidgetCtx): Promise<WidgetData>;
}

/** Implementasi widget terdaftar; diisi `widgets/*.ts` lewat `widgets/index.ts`. */
export const WIDGET_IMPLS = new Map<WidgetId, WidgetImpl>();

export function registerWidgets(impls: readonly WidgetImpl[]): void {
  for (const impl of impls) WIDGET_IMPLS.set(impl.id, impl);
}

registerWidgets(ALL_WIDGETS);
