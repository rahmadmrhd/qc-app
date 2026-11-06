/**
 * Bagian murni skrip `qc-integration.ts` (uji integrasi manual klien Google; T30a): pembacaan argumen dan format
 * laporan. Dipisah agar dapat diuji tanpa jaringan dan tanpa kunci.
 */

export interface IntegrationArgs {
  /** Jalur berkas kunci service account (berkas rahasia di luar repositori). */
  key: string;
  /** Id folder induk Drive (dibagikan ke service account sebagai Editor). */
  root: string;
  spreadsheet?: string;
  /** Folder lama milik pemilik yang sudah dibagikan sebagai Editor (hanya membaca `capabilities`). */
  legacyFolder?: string;
  /** Berkas lama milik pemilik (membaca `capabilities`; rename lalu kembalikan). */
  legacyFile?: string;
}

export interface StepResult {
  name: string;
  ok: boolean;
  /** Keterangan singkat tanpa rahasia (ukuran, jumlah, kode galat). */
  detail?: string;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{10,100}$/;
const FLAGS = {
  '--key': 'key',
  '--root': 'root',
  '--spreadsheet': 'spreadsheet',
  '--legacy-folder': 'legacyFolder',
  '--legacy-file': 'legacyFile',
} as const;

export const USAGE = [
  'Pemakaian:',
  '  bun run scripts/google-sa-check/qc-integration.ts --config <berkas.json>',
  '  bun run scripts/google-sa-check/qc-integration.ts --key <kunci.json> --root <idFolderInduk>',
  '      [--spreadsheet <id>] [--legacy-folder <id>] [--legacy-file <id>]',
  'Berkas --config: {"key":"...","root":"...","spreadsheet":"...","legacyFolder":"...","legacyFile":"..."}',
  'Kunci dan id TIDAK boleh ditulis di repositori: beri lewat argumen atau berkas di luar repo.',
].join('\n');

/**
 * Membaca argumen CLI (`--config` memuat berkas JSON lewat `readJson`; flag eksplisit menimpa isi berkas). Melempar
 * `Error` berpesan jelas (tanpa mencetak nilai rahasia) bila kurang atau tidak valid.
 */
export function parseArgs(argv: string[], readJson: (path: string) => unknown): IntegrationArgs {
  const values: Partial<Record<keyof IntegrationArgs, string>> = {};
  const configAt = argv.indexOf('--config');
  if (configAt >= 0) {
    const path = argv[configAt + 1];
    if (path === undefined || path.startsWith('--')) throw new Error('--config butuh jalur berkas');
    const raw = readJson(path);
    if (typeof raw !== 'object' || raw === null) throw new Error('Isi --config bukan objek JSON');
    for (const field of Object.values(FLAGS)) {
      const value = (raw as Record<string, unknown>)[field];
      if (typeof value === 'string' && value !== '') values[field] = value;
    }
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--config') {
      i += 1;
      continue;
    }
    const field = FLAGS[arg as keyof typeof FLAGS];
    if (field === undefined) throw new Error(`Argumen tidak dikenal: ${arg}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} butuh nilai`);
    values[field] = value;
    i += 1;
  }
  if (!values.key) throw new Error('--key (jalur berkas kunci) wajib');
  if (!values.root) throw new Error('--root (id folder induk) wajib');
  for (const field of ['root', 'spreadsheet', 'legacyFolder', 'legacyFile'] as const) {
    const value = values[field];
    if (value !== undefined && !ID_PATTERN.test(value)) {
      throw new Error(`${field} bukan id Google Drive yang valid`);
    }
  }
  return {
    key: values.key,
    root: values.root,
    ...(values.spreadsheet ? { spreadsheet: values.spreadsheet } : {}),
    ...(values.legacyFolder ? { legacyFolder: values.legacyFolder } : {}),
    ...(values.legacyFile ? { legacyFile: values.legacyFile } : {}),
  };
}

/** Laporan teks PASS/FAIL per langkah dan jumlah yang gagal (kode keluar skrip = 1 bila > 0). */
export function formatReport(results: StepResult[]): { text: string; failed: number } {
  const lines = results.map(
    (r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`,
  );
  const failed = results.filter((r) => !r.ok).length;
  lines.push(
    '',
    `${results.length - failed} lulus, ${failed} gagal dari ${results.length} langkah`,
  );
  return { text: lines.join('\n'), failed };
}

/** Byte uji deterministik (tidak sama antar-posisi sehingga potongan yang tertukar terdeteksi). */
export function patternBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 31 + (i >> 8) + (i >> 16)) & 0xff;
  return out;
}
