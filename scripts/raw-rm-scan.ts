// Pemindai sumber untuk penghapusan rekursif langsung di tes (dipakai `no-raw-recursive-rm.test.ts`).

const RM_NAMES = ['rm', 'rmSync', 'rmdir', 'rmdirSync'];

/**
 * Menghapus komentar dari sumber TS/JS tanpa salah mengenali `//` di dalam string, template, atau regex.
 * `blankStrings`: isi string/template/regex diganti spasi (tersisa hanya kode); jika tidak, string dipertahankan.
 */
export function stripSource(source: string, blankStrings: boolean): string {
  let out = '';
  let i = 0;
  let prev = ''; // karakter bermakna terakhir di luar komentar/spasi (untuk menebak regex vs pembagian)
  let prevWord = '';
  const n = source.length;
  const regexAllowed = () =>
    prev === '' ||
    '(,=:[!&|?{};+-*%<>~^'.includes(prev) ||
    prevWord === 'return' ||
    prevWord === 'typeof';
  while (i < n) {
    const c = source[i] as string;
    const d = source[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && source[j] !== c) {
        if (source[j] === '\\') j++;
        else if (c !== '`' && source[j] === '\n') break;
        j++;
      }
      const body = source.slice(i + 1, j);
      out += blankStrings ? c + body.replace(/[^\n]/g, ' ') + c : source.slice(i, j + 1);
      i = j + 1;
      prev = c;
      prevWord = '';
      continue;
    }
    if (c === '/' && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      while (j < n && source[j] !== '\n') {
        if (source[j] === '\\') j++;
        else if (source[j] === '[') inClass = true;
        else if (source[j] === ']') inClass = false;
        else if (source[j] === '/' && !inClass) break;
        j++;
      }
      if (source[j] === '/') {
        out += blankStrings
          ? `/${source.slice(i + 1, j).replace(/[^\n]/g, ' ')}/`
          : source.slice(i, j + 1);
        i = j + 1;
        prev = '/';
        prevWord = '';
        continue;
      }
    }
    out += c;
    if (!/\s/.test(c)) {
      prev = c;
      if (/\w/.test(c)) {
        let k = i;
        while (k > 0 && /\w/.test(source[k - 1] as string)) k--;
        prevWord = source.slice(k, i + 1);
      } else prevWord = '';
    }
    i++;
  }
  return out;
}

function callText(source: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    const c = source[i];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if ((c === ')' || c === '}' || c === ']') && --depth === 0)
      return source.slice(openIndex + 1, i);
  }
  return source.slice(openIndex + 1);
}

function topLevelArgs(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(args.slice(start, i));
      start = i + 1;
    }
  }
  const last = args.slice(start);
  if (last.trim() !== '') parts.push(last);
  return parts.map((p) => p.trim());
}

/** Pemeriksaan murah sebelum parsing mahal: berkas tanpa jejak penghapusan tak perlu dipindai. */
const CHEAP_HINT =
  /\b(?:rm|rmSync|rmdir|rmdirSync|rimraf)\b|['"]rm(?:Sync|dir|dirSync)['"]|Remove-Item/;

const DIRECT_CALL = /(?<![.\w$])(?:rm|rmSync|rmdir|rmdirSync)\s*\(/;

/**
 * Daftar pelanggaran (deskripsi pendek) di `source`. Aturan:
 * - pemanggilan `rm`/`rmSync`/`rmdir`/`rmdirSync` (juga alias impor `x as y`, anggota `fs.rm`/`fs.promises.rm`, dan akses kurung
 *   `fs['rmSync']`) dilarang bila argumennya memuat `recursive` ATAU argumen keduanya ada tetapi bukan literal objek murni
 *   (opsi lewat variabel atau spread tak dapat diperiksa); `rm(file)` dan `rm(file, { force: true })` lolos;
 * - perintah shell rekursif (`rm -rf`, `Remove-Item -Recurse`, `rimraf`) hanya bila dijalankan: argumen exec/spawn (string atau
 *   larik perintah, termasuk `Bun.spawn`) atau templat Bun.$; string biasa (mis. muatan uji injeksi) bukan pelanggaran;
 * - gagal-aman: selain pemindaian kode (komentar dan isi string dibuang), tiap BARIS mentah yang memanggil `rm(...)` dengan
 *   `recursive` di baris yang sama dan bukan baris komentar juga dihitung, sehingga tokenizer yang keliru (apostrof di teks JSX,
 *   templat bersarang) tak dapat menyembunyikan pemanggilan. Akibatnya string satu baris yang menyerupai pemanggilan dihitung
 *   sebagai positif palsu dan harus dikecualikan eksplisit.
 */
export function findRawRm(source: string): string[] {
  if (!CHEAP_HINT.test(source)) return [];
  const code = stripSource(source, true);
  const withStrings = stripSource(source, false);
  const found: string[] = [];

  const names = new Set(RM_NAMES);
  for (const m of code.matchAll(new RegExp(`\\b(?:${RM_NAMES.join('|')})\\s+as\\s+(\\w+)`, 'g')))
    names.add(m[1] as string);

  const checkCall = (label: string, text: string) => {
    const second = topLevelArgs(text)[1];
    if (/\brecursive\b/.test(text)) found.push(`${label}(... recursive)`);
    else if (second !== undefined && (!second.startsWith('{') || second.includes('...')))
      found.push(`${label}(..., opsi bukan literal objek murni)`);
  };

  const bare = new RegExp(`(?<![.\\w$])(${[...names].join('|')})\\s*\\(`, 'g');
  const member = new RegExp(`\\.\\s*(${RM_NAMES.join('|')})\\s*\\(`, 'g');
  for (const re of [bare, member]) {
    for (const m of code.matchAll(re)) {
      checkCall(m[1] as string, callText(code, (m.index ?? 0) + m[0].length - 1));
    }
  }
  // akses kurung: string kuncinya hidup di teks yang mempertahankan string
  const bracket = new RegExp(`\\[\\s*['"\`](${RM_NAMES.join('|')})['"\`]\\s*\\]\\s*\\(`, 'g');
  for (const m of withStrings.matchAll(bracket)) {
    checkCall(`[${m[1]}]`, callText(withStrings, (m.index ?? 0) + m[0].length - 1));
  }

  // Shell hanya dihitung bila dijalankan.
  const shellRm = /\brm\s+-[A-Za-z]*[rR]|Remove-Item[^\n'"`]*-Recurse|\brimraf\b/i;
  const argvRm = /['"`]rm['"`]\s*,[^\]]*?['"`](?:-[A-Za-z]*[rR][A-Za-z]*|--recursive)['"`]/;
  const argvRemoveItem = /['"`]Remove-Item['"`][^\]]*?['"`]-Recurse['"`]/i;
  const runner = /(?<![\w$])(?:exec|execSync|execFile|execFileSync|spawn|spawnSync)\s*\(/g;
  for (const m of withStrings.matchAll(runner)) {
    const text = callText(withStrings, (m.index ?? 0) + m[0].length - 1);
    if (shellRm.test(text) || argvRm.test(text) || argvRemoveItem.test(text))
      found.push('shell rekursif lewat exec/spawn');
  }
  for (const m of withStrings.matchAll(/\$`([^`]*)`/g)) {
    if (shellRm.test(m[1] as string)) found.push('shell rekursif lewat Bun.$');
  }
  if (/\brimraf\b/.test(code)) found.push('rimraf (impor atau pemanggilan)');

  if (found.length === 0) {
    for (const line of source.split('\n')) {
      if (/^\s*(?:\/\/|\/\*|\*)/.test(line)) continue;
      if (DIRECT_CALL.test(line) && /\brecursive\b/.test(line)) {
        found.push('baris mentah memanggil rm(... recursive) (gagal-aman)');
        break;
      }
    }
  }
  return found;
}
