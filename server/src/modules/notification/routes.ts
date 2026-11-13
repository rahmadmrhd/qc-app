import type { RouteTable } from '@server/core/router';
import { listForUser, markAllNotificationsRead, markNotificationRead } from './service';
import {
  validateEmptyInput,
  validateListNotifications,
  validateMarkNotificationRead,
} from './validate';

type NotificationMethod =
  | 'notifications.list'
  | 'notifications.markRead'
  | 'notifications.markAllRead';

/**
 * Lonceng notifikasi: tanpa `permission` modul (cukup sesi, seperti `auth.me`); kotak milik pemanggil sendiri dan
 * lokasi yang boleh dibaca dihitung saat dibaca (lihat `service.ts`).
 */
export function notificationRoutes(): Pick<RouteTable, NotificationMethod> {
  return {
    'notifications.list': {
      validate: validateListNotifications,
      handler: (input, ctx) => listForUser(ctx.env, ctx.user, input),
    },
    'notifications.markRead': {
      validate: validateMarkNotificationRead,
      handler: (input, ctx) => markNotificationRead(ctx.env, ctx.user, input.id),
    },
    'notifications.markAllRead': {
      validate: validateEmptyInput,
      handler: (_input, ctx) => markAllNotificationsRead(ctx.env, ctx.user),
    },
  };
}
