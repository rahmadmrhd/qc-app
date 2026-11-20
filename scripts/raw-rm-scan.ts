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

/**
 * Daftar pelanggaran (deskripsi pendek) di `source`. Aturan:
 * - pemanggilan `rm`/`rmSync`/`rmdir`/`rmdirSync` (juga alias impor `x as y` dan pemanggilan anggota `fs.rm`, `fs.promises.rm`,
 *   `fsp.rmdir`) dilarang bila argumennya memuat `recursive` ATAU argumen keduanya ada tetapi bukan literal objek
 *   (opsi lewat variabel tak dapat diperiksa); `rm(file)` dan `rm(file, { force: true })` lolos;
 * - perintah shell rekursif (`rm -rf`, `Remove-Item -Recurse`, `rimraf`) di dalam string.
 */
export function findRawRm(source: string): string[] {
  const code = stripSource(source, true);
  const withStrings = stripSource(source, false);
  const found: string[] = [];

  const names = new Set(RM_NAMES);
  for (const m of code.matchAll(new RegExp(`\\b(?:${RM_NAMES.join('|')})\\s+as\\s+(\\w+)`, 'g')))
    names.add(m[1] as string);

  const bare = new RegExp(`(?<![.\\w$])(${[...names].join('|')})\\s*\\(`, 'g');
  const member = new RegExp(`\\.\\s*(${RM_NAMES.join('|')})\\s*\\(`, 'g');
  for (const re of [bare, member]) {
    for (const m of code.matchAll(re)) {
      const open = (m.index ?? 0) + m[0].length - 1;
      const text = callText(code, open);
      const second = topLevelArgs(text)[1];
      if (/\brecursive\b/.test(text)) found.push(`${m[1]}(... recursive)`);
      else if (second !== undefined && !second.startsWith('{'))
        found.push(`${m[1]}(..., opsi bukan literal objek)`);
    }
  }

  // Shell hanya dihitung bila dijalankan (argumen exec/spawn atau templat Bun.$); string biasa, mis. muatan uji injeksi, bukan pelanggaran.
  const shellRm = /\brm\s+-[A-Za-z]*[rR]|Remove-Item[^\n'"`]*-Recurse|\brimraf\b/i;
  const runner = /(?<![\w$])(?:exec|execSync|execFile|execFileSync|spawn|spawnSync)\s*\(/g;
  for (const m of withStrings.matchAll(runner)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    if (shellRm.test(callText(withStrings, open))) found.push('shell rekursif lewat exec/spawn');
  }
  for (const m of withStrings.matchAll(/\$`([^`]*)`/g)) {
    if (shellRm.test(m[1] as string)) found.push('shell rekursif lewat Bun.$');
  }
  if (/\brimraf\b/.test(code)) found.push('rimraf (impor atau pemanggilan)');
  return found;
}
