import type { WorkerRpcMethod as RpcMethod } from '@shared/rpc';
import { appError } from '@worker/core/errors';
import type { RouteDef, RouteTable } from '@worker/core/router';
import { authRpcRoutes } from '@worker/modules/auth/rpc';

/**
 * Daftar LENGKAP kunci `RpcContract` (kompilator memastikan tepat sama: kurang atau lebih = galat tipe).
 * Dipakai untuk membangun rute stub dan tes kontrak.
 */
export const ALL_RPC_METHODS: Record<RpcMethod, true> = {
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

/** Method yang sudah diporting; sisanya memakai stub `NOT_IMPLEMENTED` (SEMENTARA, Fase 2). */
const PORTED = new Set<RpcMethod>(['auth.me']);

/**
 * STUB SEMENTARA: rute modul yang belum dipindah. Memakai kode `INTERNAL` dengan pesan
 * `NOT_IMPLEMENTED` (kode galat kontrak tidak ditambah). Tiap task Fase 2 menghapus method
 * miliknya dari sini (tambahkan ke `PORTED` dan ke tabel rute modul).
 */
function notImplementedRoute(method: RpcMethod): RouteDef {
  return {
    validate: (raw) => raw as never,
    handler: () => {
      throw appError('INTERNAL', `NOT_IMPLEMENTED: ${method} belum dipindah ke Worker`);
    },
  };
}

/** Dibangun sekali per isolate. */
let cached: RouteTable | undefined;

export function getRoutes(): RouteTable {
  if (cached) return cached;
  const stubs: Record<string, RouteDef> = {};
  for (const method of Object.keys(ALL_RPC_METHODS) as RpcMethod[]) {
    if (!PORTED.has(method)) stubs[method] = notImplementedRoute(method);
  }
  cached = { ...(stubs as unknown as RouteTable), ...authRpcRoutes() };
  return cached;
}
