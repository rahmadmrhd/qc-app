import type { RouteTable } from '@server/core/router';
import {
  addComment,
  cancelHandover,
  getHandoverDto,
  handoverBoard,
  handoverOptions,
  reopenHandover,
  saveHandover,
  saveHandoverBatch,
  setCheck,
  setDone,
} from './service';
import {
  validateAddComment,
  validateBoardPage,
  validateGetHandover,
  validateHandoverRef,
  validateListHandovers,
  validateSaveHandover,
  validateSaveHandoverBatch,
  validateSetCheck,
  validateSetDone,
} from './validate';

type HandoverMethod =
  | 'handovers.options'
  | 'handovers.board'
  | 'handovers.get'
  | 'handovers.save'
  | 'handovers.saveBatch'
  | 'handovers.cancel'
  | 'handovers.reopen'
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

export function handoverRoutes(): Pick<RouteTable, HandoverMethod> {
  return {
    'handovers.options': {
      warm: ['customers'],
      permission: READ_PERMISSION,
      validate: validateListHandovers,
      handler: (_input, ctx) => handoverOptions(ctx.env),
    },
    'handovers.board': {
      permission: READ_PERMISSION,
      validate: validateBoardPage,
      handler: (input, ctx) => handoverBoard(ctx.env, input, ctx.locationIds),
    },
    'handovers.get': {
      permission: READ_PERMISSION,
      validate: validateGetHandover,
      handler: (input, ctx) => getHandoverDto(ctx.env, input, ctx.locationIds),
    },
    'handovers.save': {
      warm: ['customers'],
      permission: { module: 'handover', level: 'edit', scope: 'location' },
      validate: validateSaveHandover,
      handler: (input, ctx) => saveHandover(ctx.env, input, ctx.user),
    },
    'handovers.saveBatch': {
      warm: ['customers'],
      permission: { module: 'handover', level: 'edit', scope: 'location' },
      validate: validateSaveHandoverBatch,
      handler: (input, ctx) => saveHandoverBatch(ctx.env, input, ctx.user),
    },
    'handovers.cancel': {
      permission: { module: 'handover', level: 'manage', scope: 'location' },
      validate: validateHandoverRef,
      handler: (input, ctx) => cancelHandover(ctx.env, input, ctx.user),
    },
    'handovers.reopen': {
      permission: { module: 'handover', level: 'manage', scope: 'location' },
      validate: validateHandoverRef,
      handler: (input, ctx) => reopenHandover(ctx.env, input, ctx.user),
    },
    'handovers.setCheck': {
      permission: { module: 'qc', level: 'edit', scope: 'location' },
      validate: validateSetCheck,
      handler: (input, ctx) => setCheck(ctx.env, input, ctx.user),
    },
    'handovers.setDone': {
      permission: { module: 'qc', level: 'edit', scope: 'location' },
      validate: validateSetDone,
      handler: (input, ctx) => setDone(ctx.env, input, ctx.user),
    },
    'handovers.comment': {
      permission: READ_PERMISSION,
      validate: validateAddComment,
      handler: (input, ctx) => addComment(ctx.env, input, ctx.user),
    },
  };
}
