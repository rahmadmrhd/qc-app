import type { RouteTable } from '@gas/core/router';
import {
  cancelHandover_,
  getHandoverDto_,
  handoverOptions_,
  listHandoverSummaries_,
  saveHandover_,
} from './service';
import {
  validateGetHandover_,
  validateHandoverRef_,
  validateListHandovers_,
  validateSaveHandover_,
} from './validate';

type HandoverMethod =
  | 'handovers.options'
  | 'handovers.list'
  | 'handovers.get'
  | 'handovers.save'
  | 'handovers.cancel';

/** WH (handover view ke atas) atau QC (qc edit) boleh membaca; izin diperiksa per lokasi yang diminta. */
const READ_PERMISSION = {
  anyOf: [
    { module: 'handover', level: 'view', scope: 'location' },
    { module: 'qc', level: 'edit', scope: 'location' },
  ],
} as const;

export function handoverRoutes_(): Pick<RouteTable, HandoverMethod> {
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
    'handovers.save': {
      permission: { module: 'handover', level: 'edit', scope: 'location' },
      validate: validateSaveHandover_,
      handler: (input, ctx) => saveHandover_(input, ctx.user),
    },
    'handovers.cancel': {
      permission: { module: 'handover', level: 'manage', scope: 'location' },
      validate: validateHandoverRef_,
      handler: (input, ctx) => cancelHandover_(input, ctx.user),
    },
  };
}
