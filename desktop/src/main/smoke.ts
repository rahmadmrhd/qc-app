// Laporan smoke: dipakai `--smoke` pada hasil kemas dan oleh tes untuk memastikan runtime yang
// dikirim benar-benar memuat ssh2 dan node:sqlite (bukan sekadar terpasang di mesin pengembang).

export interface SmokeReport {
  node: string;
  /** Kosong bila dijalankan di Node biasa (tes). */
  electron: string;
  ssh2: boolean;
  sqlite: boolean;
}

async function canLoadSsh2(): Promise<boolean> {
  try {
    const mod = (await import('ssh2')) as { Client?: unknown; default?: { Client?: unknown } };
    return typeof (mod.Client ?? mod.default?.Client) === 'function';
  } catch {
    return false;
  }
}

async function canUseSqlite(): Promise<boolean> {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE TABLE smoke (id INTEGER PRIMARY KEY, v TEXT)');
      db.prepare('INSERT INTO smoke (v) VALUES (?)').run('ok');
      const row = db.prepare('SELECT v FROM smoke').get() as { v?: string } | undefined;
      return row?.v === 'ok';
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

export async function collectSmokeReport(): Promise<SmokeReport> {
  const [ssh2, sqlite] = await Promise.all([canLoadSsh2(), canUseSqlite()]);
  return {
    node: process.versions.node,
    electron: process.versions.electron ?? '',
    ssh2,
    sqlite,
  };
}
