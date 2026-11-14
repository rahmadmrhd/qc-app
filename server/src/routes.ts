import type { RouteTable } from '@server/core/router';
import { accessRoutes } from '@server/modules/access/routes';
import { authApiRoutes } from '@server/modules/auth/api';
import { brandRoutes } from '@server/modules/brand/routes';
import { customerRoutes } from '@server/modules/customer/routes';
import { filesRoutes } from '@server/modules/files/routes';
import { guideRoutes } from '@server/modules/guide/routes';
import { handoverRoutes } from '@server/modules/handover/routes';
import { itemRoutes } from '@server/modules/item/routes';
import { jobsRoutes } from '@server/modules/jobs/routes';
import { pushRoutes } from '@server/modules/notification/push-routes';
import { notificationRoutes } from '@server/modules/notification/routes';
import { postelRoutes } from '@server/modules/postel/routes';
import { qrcodeRoutes } from '@server/modules/qrcode/routes';
import { serialRoutes } from '@server/modules/serial/routes';
import { stickerRoutes } from '@server/modules/sticker/routes';
import type { ApiId } from '@shared/contract';

/**
 * Daftar LENGKAP kunci `ApiContract` (kompilator memastikan tepat sama: kurang atau lebih = galat tipe).
 * Dipakai tes kontrak.
 */
export const ALL_API_IDS: Record<ApiId, true> = {
  'auth.me': true,
  'access.users.list': true,
  'access.users.save': true,
  'access.users.setStatus': true,
  'access.roles.list': true,
  'access.roles.save': true,
  'access.roles.delete': true,
  'access.audit.list': true,
  'access.locations.list': true,
  'access.locations.save': true,
  'access.locations.setStatus': true,
  'access.businessUnits.list': true,
  'access.businessUnits.save': true,
  'access.businessUnits.setStatus': true,
  'businessUnits.options': true,
  'files.upload': true,
  'files.get': true,
  'stickerGuides.list': true,
  'stickerGuides.upload': true,
  'stickerGuides.rename': true,
  'stickerGuides.remove': true,
  'stickerGuides.thumbnail': true,
  'stickerGuides.usages': true,
  'brands.list': true,
  'brands.save': true,
  'brands.setStatus': true,
  'stickerSettings.get': true,
  'stickerSettings.save': true,
  'stickerTypes.list': true,
  'stickerTypes.save': true,
  'stickerTypes.setStatus': true,
  'stickers.list': true,
  'stickers.save': true,
  'stickers.setStatus': true,
  'stickerStock.list': true,
  'stickerStock.record': true,
  'stickerStock.adjust': true,
  'stickerStock.opname': true,
  'stickerStock.history': true,
  'customers.list': true,
  'customers.rename': true,
  'customers.setStatus': true,
  'handovers.options': true,
  'handovers.board': true,
  'handovers.get': true,
  'handovers.save': true,
  'handovers.saveBatch': true,
  'handovers.cancel': true,
  'handovers.reopen': true,
  'handovers.setCheck': true,
  'handovers.setDone': true,
  'handovers.comment': true,
  'items.list': true,
  'items.get': true,
  'items.save': true,
  'items.setStatus': true,
  'qrcodes.list': true,
  'qrcodes.get': true,
  'qrcodes.versions': true,
  'qrcodes.save': true,
  'qrcodes.delete': true,
  'qrcodes.getDefaults': true,
  'qrcodes.itemOptions': true,
  'qrcodes.savePreset': true,
  'qrcodes.clonePreset': true,
  'qrcodes.deletePreset': true,
  'qrcodes.saveLogoLibrary': true,
  'qrcodes.uploadPdf': true,
  'qrcodes.cloneFromDrive': true,
  'qrcodes.export': true,
  'qrcodes.file': true,
  'postels.list': true,
  'postels.get': true,
  'postels.save': true,
  'postels.remove': true,
  'postels.history': true,
  'postelSettings.get': true,
  'postelSettings.save': true,
  'postels.itemOptions': true,
  'serials.itemOptions': true,
  'serials.stickerOptions': true,
  'serials.locationOptions': true,
  'serials.serviceLocations': true,
  'serials.lookup': true,
  'serials.reportNew': true,
  'serials.saveBatch': true,
  'serials.get': true,
  'serials.list': true,
  'serials.update': true,
  'serials.updateBatch': true,
  'serials.act': true,
  'serials.history': true,
  'serialSettings.get': true,
  'serialSettings.save': true,
  'serialServiceSettings.get': true,
  'serialServiceSettings.save': true,
  'serialCases.list': true,
  'postelFiles.upload': true,
  'postelFiles.get': true,
  'notifications.list': true,
  'notifications.markRead': true,
  'notifications.markAllRead': true,
  'push.config': true,
  'push.subscribe': true,
  'push.unsubscribe': true,
  'push.setPreference': true,
  'push.reportPermission': true,
  'push.status': true,
  'guides.list': true,
  'guides.mark': true,
  'guides.reset': true,
  'jobs.get': true,
  'exports.sheets': true,
};

/**
 * Tabel rute semua modul. Bertipe `RouteTable` (bukan parsial): modul yang lupa didaftarkan = typecheck gagal,
 * jadi tak ada rute tanpa handler nyata yang dapat lolos diam-diam. Tambahkan tabel rute tiap modul di sini.
 */
function realRoutes(): RouteTable {
  return {
    ...authApiRoutes(),
    ...accessRoutes(),
    ...brandRoutes(),
    ...customerRoutes(),
    ...filesRoutes(),
    ...itemRoutes(),
    ...handoverRoutes(),
    ...qrcodeRoutes(),
    ...postelRoutes(),
    ...notificationRoutes(),
    ...guideRoutes(),
    ...pushRoutes(),
    ...serialRoutes(),
    ...jobsRoutes(),
    ...stickerRoutes(),
  };
}

/** Dibangun sekali per isolate. */
let cached: RouteTable | undefined;

export function getRoutes(): RouteTable {
  cached ??= realRoutes();
  return cached;
}
