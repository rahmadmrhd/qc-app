import type { RouteTable } from '@server/core/router';
import { accessRoutes } from '@server/modules/access/routes';
import { authRpcRoutes } from '@server/modules/auth/rpc';
import { brandRoutes } from '@server/modules/brand/routes';
import { customerRoutes } from '@server/modules/customer/routes';
import { filesRoutes } from '@server/modules/files/routes';
import { handoverRoutes } from '@server/modules/handover/routes';
import { itemRoutes } from '@server/modules/item/routes';
import { jobsRoutes } from '@server/modules/jobs/routes';
import { qrcodeRoutes } from '@server/modules/qrcode/routes';
import type { WorkerRpcMethod } from '@shared/rpc';

/**
 * Daftar LENGKAP kunci `RpcContract` (kompilator memastikan tepat sama: kurang atau lebih = galat tipe).
 * Dipakai tes kontrak.
 */
export const ALL_RPC_METHODS: Record<WorkerRpcMethod, true> = {
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
  'files.upload': true,
  'files.get': true,
  'brands.list': true,
  'brands.save': true,
  'brands.setStatus': true,
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
  'qrcodes.save': true,
  'qrcodes.delete': true,
  'qrcodes.getDefaults': true,
  'qrcodes.savePreset': true,
  'qrcodes.deletePreset': true,
  'qrcodes.saveLogoLibrary': true,
  'qrcodes.uploadPdf': true,
  'qrcodes.cloneFromDrive': true,
  'qrcodes.export': true,
  'qrcodes.file': true,
  'jobs.get': true,
  'exports.sheets': true,
};

/**
 * Tabel rute semua modul. Bertipe `RouteTable` (bukan parsial): modul yang lupa didaftarkan = typecheck gagal,
 * jadi tak ada rute tanpa handler nyata yang dapat lolos diam-diam. Tambahkan tabel rute tiap modul di sini.
 */
function realRoutes(): RouteTable {
  return {
    ...authRpcRoutes(),
    ...accessRoutes(),
    ...brandRoutes(),
    ...customerRoutes(),
    ...filesRoutes(),
    ...itemRoutes(),
    ...handoverRoutes(),
    ...qrcodeRoutes(),
    ...jobsRoutes(),
  };
}

/** Dibangun sekali per isolate. */
let cached: RouteTable | undefined;

export function getRoutes(): RouteTable {
  cached ??= realRoutes();
  return cached;
}
