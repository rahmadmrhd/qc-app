import { createRpcClient } from './client';
import { httpTransport } from './http-transport';

// Sesi lewat cookie HttpOnly (token tidak dipegang JS). Saat dev, Vite meneruskan /api, /auth, dan /sync ke
// `wrangler dev` (lihat web/vite.config.ts), jadi transport yang sama dipakai di semua lingkungan.
export const rpc = createRpcClient(httpTransport);
