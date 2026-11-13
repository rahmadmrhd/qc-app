import type { RouteTable } from '@server/core/router';
import { expectNull } from '@server/core/validate';
import {
  pushConfig,
  pushStatus,
  reportPushPermission,
  setPushPreference,
  subscribePush,
  unsubscribePush,
} from './push-service';
import {
  validatePushPermission,
  validatePushPreference,
  validatePushSubscribe,
  validatePushUnsubscribe,
} from './push-validate';

type PushMethod =
  | 'push.config'
  | 'push.subscribe'
  | 'push.unsubscribe'
  | 'push.setPreference'
  | 'push.reportPermission'
  | 'push.status';

/**
 * Push: rute milik pengguna sendiri hanya butuh sesi (seperti `auth.me`); status semua pengguna untuk admin
 * memakai izin yang sudah ada, `access: view` (spek §10), dan hanya memuat status per pengguna.
 */
export function pushRoutes(): Pick<RouteTable, PushMethod> {
  return {
    'push.config': {
      validate: expectNull,
      handler: (_input, ctx) => pushConfig(ctx.env, ctx.user),
    },
    'push.subscribe': {
      validate: validatePushSubscribe,
      handler: (input, ctx) => subscribePush(ctx.env, ctx.user, input),
    },
    'push.unsubscribe': {
      validate: validatePushUnsubscribe,
      handler: (input, ctx) => unsubscribePush(ctx.env, ctx.user, input),
    },
    'push.setPreference': {
      validate: validatePushPreference,
      handler: (input, ctx) => setPushPreference(ctx.env, ctx.user, input),
    },
    'push.reportPermission': {
      validate: validatePushPermission,
      handler: (input, ctx) => reportPushPermission(ctx.env, ctx.user, input),
    },
    'push.status': {
      permission: { module: 'access', level: 'view' },
      validate: expectNull,
      handler: (_input, ctx) => pushStatus(ctx.env),
    },
  };
}
