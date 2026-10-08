import path from 'node:path';
import { GAS_DIST_DIR } from './paths';

const problems: string[] = [];
const index = Bun.file(path.join(GAS_DIST_DIR, 'index.html'));

if (!(await index.exists())) {
  problems.push('gas/dist/index.html tidak ada');
} else {
  const html = await index.text();
  const bootCount = html.split('<!--BOOT-->').length - 1;
  if (bootCount !== 1) problems.push(`placeholder <!--BOOT--> muncul ${bootCount} kali (harus 1)`);
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

if (problems.length > 0) {
  console.error(`verify-dist gagal:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('verify-dist OK');
