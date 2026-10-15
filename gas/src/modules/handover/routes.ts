import type { RouteTable } from '@gas/core/router';
import { getHandoverDto_, handoverOptions_, listHandoverSummaries_ } from './service';
import { validateGetHandover_, validateListHandovers_ } from './validate';

type HandoverReadMethod = 'handovers.options' | 'handovers.list' | 'handovers.get';

/** WH (handover view ke atas) atau QC (qc edit) boleh membaca; izin diperiksa per lokasi yang diminta. */
const READ_PERMISSION = {
  anyOf: [
    { module: 'handover', level: 'view', scope: 'location' },
    { module: 'qc', level: 'edit', scope: 'location' },
  ],
} as const;

export function handoverReadRoutes_(): Pick<RouteTable, HandoverReadMethod> {
  return {
    'handovers.options': {
      permission: READ_PERMISSION,
      validate: validateListHandovers_,
      handler: () => handoverOptions_(),
    },
    'handovers.list': {
      permission: READ_PERMISSION,
      validate: validateListHandovers_,
      handler: (_input, ctx) => listHandoverSummaries_(ctx.locationIds),
    },
    'handovers.get': {
      permission: READ_PERMISSION,
      validate: validateGetHandover_,
      handler: (input, ctx) => getHandoverDto_(input, ctx.locationIds),
    },
  };
}
