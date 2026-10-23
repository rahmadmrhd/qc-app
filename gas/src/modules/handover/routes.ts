import type { RouteTable } from '@gas/core/router';
import {
  addComment_,
  cancelHandover_,
  getHandoverDto_,
  handoverBoard_,
  handoverOptions_,
  saveHandover_,
  saveHandoverBatch_,
  setCheck_,
  setDone_,
} from './service';
import {
  validateAddComment_,
  validateGetHandover_,
  validateHandoverRef_,
  validateListHandovers_,
  validateSaveHandover_,
  validateSaveHandoverBatch_,
  validateSetCheck_,
  validateSetDone_,
} from './validate';

type HandoverMethod =
  | 'handovers.options'
  | 'handovers.board'
  | 'handovers.get'
  | 'handovers.save'
  | 'handovers.saveBatch'
  | 'handovers.cancel'
  | 'handovers.setCheck'
  | 'handovers.setDone'
  | 'handovers.comment';

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
    'handovers.board': {
      permission: READ_PERMISSION,
      validate: validateListHandovers_,
      handler: (_input, ctx) => handoverBoard_(ctx.locationIds),
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
    'handovers.saveBatch': {
      permission: { module: 'handover', level: 'edit', scope: 'location' },
      validate: validateSaveHandoverBatch_,
      handler: (input, ctx) => saveHandoverBatch_(input, ctx.user),
    },
    'handovers.cancel': {
      permission: { module: 'handover', level: 'manage', scope: 'location' },
      validate: validateHandoverRef_,
      handler: (input, ctx) => cancelHandover_(input, ctx.user),
    },
    'handovers.setCheck': {
      permission: { module: 'qc', level: 'edit', scope: 'location' },
      validate: validateSetCheck_,
      handler: (input, ctx) => setCheck_(input, ctx.user),
    },
    'handovers.setDone': {
      permission: { module: 'qc', level: 'edit', scope: 'location' },
      validate: validateSetDone_,
      handler: (input, ctx) => setDone_(input, ctx.user),
    },
    'handovers.comment': {
      permission: READ_PERMISSION,
      validate: validateAddComment_,
      handler: (input, ctx) => addComment_(input, ctx.user),
    },
  };
}
