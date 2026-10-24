import path from 'node:path';
import { WORKER_DIST_DIR } from './paths';

/**
 * Anggaran per potongan JS (gzip). Rencana Task 4.2 mulai 500 KB; dinaikkan ke 600 KB karena potongan rute QR
 * (pdf-lib + fontkit + font label, dimuat lazy) terukur ≈ 510 KB gzip. Potongan terbesar berikutnya ≈ 168 KB.
 */
export const MAX_CHUNK_GZIP_BYTES = 600_000;

export interface DistFile {
  file: string;
  text: string;
  gzipBytes: number;
}

/** Memeriksa keluaran build web berpotongan; mengembalikan daftar masalah (kosong = lolos). */
export function checkDist(files: DistFile[]): string[] {
  const problems: string[] = [];
  const index = files.find((entry) => entry.file === 'index.html');
  if (!index) {
    problems.push('worker/dist/index.html tidak ada');
  } else {
    if (!/<script[^>]+type=["']module["'][^>]+\bsrc=/i.test(index.text)) {
      problems.push('index.html tidak memuat skrip modul utama');
    }
    if (index.text.includes('__QC_BOOT__') || index.text.includes('__BOOT__')) {
      problems.push('index.html masih memuat penanda boot Apps Script');
    }
  }
  if (!files.some((entry) => entry.file.endsWith('.js'))) problems.push('tidak ada potongan JS');
  for (const entry of files) {
    if (entry.file.endsWith('.js')) {
      if (entry.text.includes('mock-secret')) {
        problems.push(`${entry.file}: kode mock backend ikut ter-bundle ke build produksi`);
      }
      if (entry.gzipBytes > MAX_CHUNK_GZIP_BYTES) {
        problems.push(
          `${entry.file}: ${entry.gzipBytes} byte gzip melebihi anggaran ${MAX_CHUNK_GZIP_BYTES}`,
        );
      }
    }
  }
  return problems;
}

if (import.meta.main) {
  const files: DistFile[] = [];
  for await (const file of new Bun.Glob('**/*').scan({ cwd: WORKER_DIST_DIR })) {
    if (!/\.(html|js|css)$/.test(file)) continue;
    const text = await Bun.file(path.join(WORKER_DIST_DIR, file)).text();
    files.push({ file, text, gzipBytes: Bun.gzipSync(text).byteLength });
  }
  const problems = checkDist(files);
  if (problems.length > 0) {
    console.error(`verify-dist gagal:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  const js = files.filter((entry) => entry.file.endsWith('.js'));
  const largest = Math.max(0, ...js.map((entry) => entry.gzipBytes));
  console.log(`verify-dist OK (${js.length} potongan JS, terbesar ${largest} byte gzip)`);
}
