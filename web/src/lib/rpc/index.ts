import { REST_MIGRATED_IDS } from '@shared/api';
import type { WorkerRpcMethod } from '@shared/rpc';
import { api } from '@/lib/api';
import { createRpcClient, type RpcCall } from './client';
import { httpTransport } from './http-transport';

/**
 * SATU pintu panggilan backend selama migrasi REST: id yang sudah ada di `REST_MIGRATED_IDS` (himpunan yang sama
 * dengan server) diarahkan ke `api()`; sisanya tetap lewat transport RPC lama. Dihapus di T23 saat semua id REST.
 */
export function createRpc(
  legacy: RpcCall,
  rest: RpcCall,
  migrated: ReadonlySet<WorkerRpcMethod>,
): RpcCall {
  return ((method, input) => (migrated.has(method) ? rest : legacy)(method, input)) as RpcCall;
}

// Sesi lewat cookie HttpOnly (token tidak dipegang JS). Saat dev, Vite meneruskan /api, /auth, dan /sync ke
// server Bun lokal (lihat web/vite.config.ts), jadi transport yang sama dipakai di semua lingkungan.
export const rpc = createRpc(createRpcClient(httpTransport), api, REST_MIGRATED_IDS);
