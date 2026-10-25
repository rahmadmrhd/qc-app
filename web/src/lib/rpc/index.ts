import { getToken } from '@/modules/auth/session';
import { createRpcClient } from './client';
import { httpTransport } from './http-transport';
import { adaptMockToWorker } from './mock-worker-adapter';
import type { RpcTransport } from './transport';

let adaptedMock: RpcTransport | null = null;
function adapted(mock: RpcTransport): RpcTransport {
  adaptedMock ??= adaptMockToWorker(mock);
  return adaptedMock;
}

/** Mock dimuat lazy hanya saat dev, sehingga tidak ikut ter-bundle ke build produksi (dicek verify-dist). */
function createDevTransport(): RpcTransport {
  return {
    async call(method, payloadJson, token) {
      // Uji UI "memuat": localStorage.rpcLatency = '1500' menambah jeda (ms) pada tiap RPC mock.
      const latency = Number(localStorage.getItem('rpcLatency') ?? 0);
      if (latency > 0) await new Promise((resolve) => setTimeout(resolve, latency));
      const { mockTransport } = await import('./mock-backend');
      return adapted(mockTransport).call(method, payloadJson, token);
    },
  };
}

// Produksi: sesi lewat cookie HttpOnly (token tidak dipegang JS); `getToken` hanya terisi pada mode dev (mock).
export const rpc = createRpcClient(
  import.meta.env.DEV ? createDevTransport() : httpTransport,
  getToken,
);
