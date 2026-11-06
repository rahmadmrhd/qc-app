import path from 'node:path';
import vm from 'node:vm';
import { GAS_DIST_DIR } from './paths';

const problems: string[] = [];
const index = Bun.file(path.join(GAS_DIST_DIR, 'index.html'));

if (!(await index.exists())) {
  problems.push('gas/dist/index.html tidak ada');
} else {
  const html = await index.text();
  const bootCount = ["'__QC_BOOT__'", '"__QC_BOOT__"'].reduce(
    (sum, marker) => sum + html.split(marker).length - 1,
    0,
  );
  if (bootCount !== 1) problems.push(`penanda __QC_BOOT__ muncul ${bootCount} kali (harus 1)`);
  if (/<script[^>]+\bsrc=/i.test(html))
    problems.push('index.html masih memuat <script src> eksternal');
  if (/<link[^>]+rel=["']?stylesheet/i.test(html)) {
    problems.push('index.html masih memuat stylesheet eksternal');
  }
  if (html.includes('mock-secret')) {
    problems.push('kode mock backend ikut ter-bundle ke build produksi');
  }
}

for (const required of ['appsscript.json', 'main.js']) {
  if (!(await Bun.file(path.join(GAS_DIST_DIR, required)).exists())) {
    problems.push(`gas/dist/${required} tidak ada`);
  }
}

for await (const file of new Bun.Glob('**/*.js').scan({ cwd: GAS_DIST_DIR })) {
  const text = await Bun.file(path.join(GAS_DIST_DIR, file)).text();
  if (/^[ \t]*(?:import|export)\b/m.test(text)) {
    problems.push(`${file} masih mengandung import/export`);
  }
}

// Muat semua file seperti GAS (satu global scope, tiap file dieksekusi berurutan) dalam urutan maju dan mundur:
// kode level atas yang memakai global file lain gagal di salah satu urutan (ReferenceError saat dimuat).
const scripts: Array<{ file: string; code: string }> = [];
for await (const file of new Bun.Glob('**/*.js').scan({ cwd: GAS_DIST_DIR })) {
  scripts.push({ file, code: await Bun.file(path.join(GAS_DIST_DIR, file)).text() });
}
scripts.sort((a, b) => a.file.localeCompare(b.file));
for (const [label, order] of [
  ['maju', scripts],
  ['mundur', [...scripts].reverse()],
] as const) {
  const context = vm.createContext({});
  for (const script of order) {
    try {
      vm.runInContext(script.code, context, { filename: script.file });
    } catch (error) {
      problems.push(
        `${script.file} gagal dimuat (urutan ${label}): ${error instanceof Error ? error.message : String(error)}`,
      );
      break;
    }
  }
}

// Dinaikkan dari 1,5 MB untuk pdf-lib + fontkit + font label (ekspor PDF di FE); ukuran aktual ≈ 2,35 MB.
// Dinaikkan dari 2,6 MB untuk editor Tiptap (WYSIWYG Catatan + Detail Item); ukuran aktual ≈ 2,95 MB
// (tambahan ≈ 530 KB mentah / 165 KB gzip: prosemirror ≈ 220 KB, @tiptap/core ≈ 92 KB, marked ≈ 39 KB, dst).
const MAX_INDEX_BYTES = 3_300_000;
const indexFile = Bun.file(path.join(GAS_DIST_DIR, 'index.html'));
if ((await indexFile.exists()) && indexFile.size > MAX_INDEX_BYTES) {
  problems.push(`index.html ${indexFile.size} byte melebihi batas ${MAX_INDEX_BYTES}`);
}

const manifestFile = Bun.file(path.join(GAS_DIST_DIR, 'appsscript.json'));
if (await manifestFile.exists()) {
  const manifest = JSON.parse(await manifestFile.text()) as { oauthScopes?: string[] };
  if (!manifest.oauthScopes?.includes('https://www.googleapis.com/auth/drive')) {
    problems.push(
      'appsscript.json tidak memuat scope Drive (https://www.googleapis.com/auth/drive)',
    );
  }
}

if (problems.length > 0) {
  console.error(`verify-dist gagal:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('verify-dist OK');
