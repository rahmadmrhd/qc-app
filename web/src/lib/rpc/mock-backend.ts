import { setPlatform_ } from '@gas/core/platform';
import { handleRpc_ } from '@gas/core/router';
import { signSessionToken_ } from '@gas/core/session';
import { loadUserContext_ } from '@gas/modules/access/context';
import { insertRole_, insertUser_ } from '@gas/modules/access/repo';
import { getRoutes_ } from '@gas/routes';
import { role, user } from '@gas-test/access-fixtures';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import type { RpcTransport } from './transport';

/** Backend tiruan untuk `bun run dev`: menjalankan router & layanan GAS asli di browser dengan data in-memory. */
export const MOCK_ADMIN_EMAIL = 'admin@qc.local';
const MOCK_LATENCY_MS = import.meta.env.MODE === 'test' ? 0 : 250;

export interface MockUser {
  email: string;
  label: string;
}

export const MOCK_USERS: MockUser[] = [
  { email: MOCK_ADMIN_EMAIL, label: 'Super Admin' },
  {
    email: 'qc.staff@qc.local',
    label: 'QC Staff (item: ubah, serah terima: ubah, stok: lihat)',
  },
  { email: 'wh.staff@qc.local', label: 'WH Staff (serah terima: lihat, stok: lihat)' },
  { email: 'access.viewer@qc.local', label: 'Pemantau Akses (akses: lihat)' },
  { email: 'nonaktif@qc.local', label: 'User nonaktif' },
  { email: 'asing@gmail.com', label: 'Email tidak terdaftar' },
];

let ready = false;

function ensureMockBackend(): void {
  if (ready) return;
  ready = true;
  setPlatform_(
    createMemoryPlatform({
      properties: {
        SPREADSHEET_ID: 'mock',
        SESSION_SECRET: 'mock-secret',
        ADMIN_EMAIL: MOCK_ADMIN_EMAIL,
        OAUTH_CLIENT_ID: 'mock',
        OAUTH_CLIENT_SECRET: 'mock',
        OAUTH_REDIRECT_URI: 'http://localhost:3000',
      },
    }),
  );
  insertRole_(
    role({
      id: 'role-qc',
      name: 'QC Staff',
      description: 'Petugas QC',
      permissions: { item: 'edit', handover: 'edit', stock: 'view' },
    }),
  );
  insertRole_(
    role({
      id: 'role-wh',
      name: 'WH Staff',
      description: 'Petugas gudang',
      permissions: { handover: 'view', stock: 'view' },
    }),
  );
  insertRole_(
    role({ id: 'role-access-viewer', name: 'Pemantau Akses', permissions: { access: 'view' } }),
  );
  insertUser_(
    user({ id: 'user-qc', email: 'qc.staff@qc.local', name: 'Siti QC', roleIds: ['role-qc'] }),
  );
  insertUser_(
    user({ id: 'user-wh', email: 'wh.staff@qc.local', name: 'Andi Gudang', roleIds: ['role-wh'] }),
  );
  insertUser_(
    user({
      id: 'user-viewer',
      email: 'access.viewer@qc.local',
      name: 'Rina Audit',
      roleIds: ['role-access-viewer'],
    }),
  );
  insertUser_(
    user({
      id: 'user-off',
      email: 'nonaktif@qc.local',
      name: 'Dedi Nonaktif',
      status: 'inactive',
      roleIds: ['role-qc'],
    }),
  );
}

export function mockLogin(
  email: string,
): { token: string } | { authError: 'NOT_WHITELISTED'; email: string } {
  ensureMockBackend();
  return loadUserContext_(email)
    ? { token: signSessionToken_(email) }
    : { authError: 'NOT_WHITELISTED', email };
}

export const mockTransport: RpcTransport = {
  async call(method, payloadJson, token) {
    ensureMockBackend();
    await new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS));
    return JSON.stringify(handleRpc_(method, payloadJson, token, getRoutes_()));
  },
};
