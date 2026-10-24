import type { WorkerRpcMethod } from '@shared/rpc';
import { appError } from '@worker/core/errors';
import type { RouteDef, RouteTable } from '@worker/core/router';
import { accessRoutes } from '@worker/modules/access/routes';
import { authRpcRoutes } from '@worker/modules/auth/rpc';
import { brandRoutes } from '@worker/modules/brand/routes';
import { customerRoutes } from '@worker/modules/customer/routes';
import { filesRoutes } from '@worker/modules/files/routes';
import { handoverRoutes } from '@worker/modules/handover/routes';
import { itemRoutes } from '@worker/modules/item/routes';
import { qrcodeRoutes } from '@worker/modules/qrcode/routes';

/**
 * Daftar LENGKAP kunci `RpcContract` (kompilator memastikan tepat sama: kurang atau lebih = galat tipe).
 * Dipakai untuk membangun rute stub dan tes kontrak.
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
};

/**
 * STUB SEMENTARA: rute modul yang belum dipindah. Memakai kode `INTERNAL` dengan pesan
 * `NOT_IMPLEMENTED` (kode galat kontrak tidak ditambah). Method hilang dari stub otomatis begitu
 * modulnya didaftarkan di `realRoutes()`; stub dihapus seluruhnya di akhir Fase 2.
 */
function notImplementedRoute(method: WorkerRpcMethod): RouteDef {
  return {
    validate: (raw) => raw as never,
    handler: () => {
      throw appError('INTERNAL', `NOT_IMPLEMENTED: ${method} belum dipindah ke Worker`);
    },
  };
}

/** Rute modul yang sudah diporting. Tambahkan tabel rute tiap modul di sini. */
function realRoutes(): Partial<RouteTable> {
  return {
    ...authRpcRoutes(),
    ...accessRoutes(),
    ...brandRoutes(),
    ...customerRoutes(),
    ...filesRoutes(),
    ...itemRoutes(),
    ...handoverRoutes(),
    ...qrcodeRoutes(),
  };
}

/** Dibangun sekali per isolate. */
let cached: RouteTable | undefined;

export function getRoutes(): RouteTable {
  if (cached) return cached;
  const real = realRoutes();
  const table: Record<string, RouteDef> = {};
  for (const method of Object.keys(ALL_RPC_METHODS) as WorkerRpcMethod[]) {
    table[method] = (real[method] as RouteDef | undefined) ?? notImplementedRoute(method);
  }
  cached = table as unknown as RouteTable;
  return cached;
}
