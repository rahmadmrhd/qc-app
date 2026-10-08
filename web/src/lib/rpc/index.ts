import { getToken } from '@/modules/auth/session';
import { createRpcClient } from './client';
import { gasTransport } from './gas-transport';
import type { RpcTransport } from './transport';

/** Mock dimuat lazy hanya saat dev, sehingga tidak ikut ter-bundle ke build produksi (dicek verify-dist). */
function createDevTransport(): RpcTransport {
  return {
    async call(method, payloadJson, token) {
      const { mockTransport } = await import('./mock-backend');
      return mockTransport.call(method, payloadJson, token);
    },
  };
}

export const rpc = createRpcClient(
  import.meta.env.DEV ? createDevTransport() : gasTransport,
  getToken,
);
