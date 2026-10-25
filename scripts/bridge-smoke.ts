import path from 'node:path';
import { createBridgeClient } from '@worker/core/bridge-http';
import type { Env } from '@worker/core/env';
import { BRIDGE_DIR } from './paths';

/**
 * Uji cepat jembatan SESUNGGUHNYA (HANYA BACA): `sheets.dump` untuk satu sheet kecil lewat klien Worker.
 * Konfigurasi dari `bridge/.secrets.local` (BRIDGE_URL, BRIDGE_SECRET; berkas lokal di-gitignore) atau
 * variabel lingkungan. Pemakaian: bun run scripts/bridge-smoke.ts [namaSheet=brands]
 * Tidak menulis apa pun ke Sheets/Drive dan tidak mencetak isi sel maupun rahasia.
 */
async function loadConfig(): Promise<{ url: string; secret: string }> {
  const values: Record<string, string> = {};
  const file = Bun.file(path.join(BRIDGE_DIR, '.secrets.local'));
  if (await file.exists()) {
    for (const line of (await file.text()).split(/\r?\n/)) {
      const at = line.indexOf('=');
      if (at > 0) values[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
  }
  const url = Bun.env.BRIDGE_URL ?? values.BRIDGE_URL ?? '';
  const secret = Bun.env.BRIDGE_SECRET ?? values.BRIDGE_SECRET ?? '';
  if (!url || !secret)
    throw new Error('BRIDGE_URL/BRIDGE_SECRET belum tersedia (bridge/.secrets.local)');
  return { url, secret };
}

const sheet = process.argv[2] ?? 'brands';
const { url, secret } = await loadConfig();
const client = createBridgeClient({ BRIDGE_URL: url, BRIDGE_SECRET: secret } as Env, fetch, {
  timeoutMs: 60_000,
  retries: 0,
});
const started = Date.now();
try {
  const dump = await client.sheetsDump([sheet]);
  const rows = dump[sheet];
  if (!rows) {
    console.log(
      `OK jembatan menjawab, tetapi sheet "${sheet}" tidak ada. Sheet tersedia: ${Object.keys(dump).join(', ') || '(tidak ada)'}`,
    );
  } else {
    console.log(
      `OK sheets.dump "${sheet}": ${rows.length} baris, header: ${(rows[0] ?? []).join(', ')} (${Date.now() - started} ms)`,
    );
  }
} catch (error) {
  console.error(
    `GAGAL (${Date.now() - started} ms): ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
