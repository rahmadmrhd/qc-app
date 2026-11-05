import { callRoute } from '@server/core/router';
import { signSessionToken } from '@server/core/session';
import { ensureQrDocFolder } from '@server/modules/qrcode/folders';
import { getRoutes } from '@server/routes';
import { seedRole, seedUser } from './access-fixtures';
import type { TestEnv } from './test-env';

/** qrview@/qredit@/qrmanage@ = modul qrcode per level (Semua lokasi); noqr@ = item view saja. */
export async function seedQrEnv(env: TestEnv): Promise<void> {
  await seedRole(env, { id: 'r-qv', name: 'QR view', permissions: { qrcode: 'view' } });
  await seedRole(env, { id: 'r-qe', name: 'QR edit', permissions: { qrcode: 'edit' } });
  await seedRole(env, { id: 'r-qm', name: 'QR manage', permissions: { qrcode: 'manage' } });
  await seedRole(env, { id: 'r-item', name: 'Item', permissions: { item: 'view' } });
  await seedUser(env, { id: 'u-qv', email: 'qrview@gmail.com', roleIds: ['r-qv'] });
  await seedUser(env, { id: 'u-qe', email: 'qredit@gmail.com', roleIds: ['r-qe'] });
  await seedUser(env, { id: 'u-qm', email: 'qrmanage@gmail.com', roleIds: ['r-qm'] });
  await seedUser(env, { id: 'u-nq', email: 'noqr@gmail.com', roleIds: ['r-item'] });
}

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
export type RpcOut = { ok: boolean; data?: any; error?: any };

/** Memanggil RPC lewat router sungguhan (sesi, izin, validasi) sebagai `email`. */
export async function qrRpc(
  env: TestEnv,
  email: string,
  method: string,
  payload: unknown,
): Promise<RpcOut> {
  const token = await signSessionToken(env, email, env.clock.now());
  return (await callRoute(env, token, method, payload, getRoutes())) as RpcOut;
}

/**
 * Dokumen PDF sumber BARU di tiap pemanggilan (satu PDF hanya untuk satu konfigurasi QR): berkas di folder
 * dokumen (bridge palsu), dibagikan, dan baris `qr_documents`.
 */
export async function qrPdfDocumentId(env: TestEnv): Promise<string> {
  const folder = await ensureQrDocFolder(env);
  const driveId = await env.BRIDGE.createFile(
    folder,
    'sumber.pdf',
    'application/pdf',
    'JVBERi0xLjQK',
  );
  await env.BRIDGE.shareAnyoneWithLink(driveId);
  const id = crypto.randomUUID();
  const now = '2026-10-16T00:00:00.000Z';
  await env.DB.prepare(
    "INSERT INTO qr_documents (id, drive_id, name, size, shared, created_at, created_by, updated_at, updated_by) VALUES (?, ?, 'sumber.pdf', 9, '1', ?, 'seed@gmail.com', ?, 'seed@gmail.com')",
  )
    .bind(id, driveId, now, now)
    .run();
  return id;
}
