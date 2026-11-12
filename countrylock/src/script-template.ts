// Render skrip inject: mengisi tujuh placeholder `{nama}` pada skrip per merk/firmware.
//
// Beda dengan `ScriptTemplate.Render` aplikasi lama (replace literal mentah): nilai yang tidak
// aman diberi kutip/escape menurut konteks sintaks merk, supaya sandi berisi `"`, `$`, spasi,
// dan sebagainya tidak merusak skrip atau menyuntikkan perintah. Untuk nilai "aman" hasilnya
// identik dengan aplikasi lama (paritas emas, dites terhadap 17 skrip nyata).

export type Brand = 'mikrotik' | 'ubiquiti';

export interface ScriptValues {
  ipTarget: string;
  usernameTarget: string;
  passwordTarget: string;
  ipServer: string;
  usernameServer: string;
  passwordServer: string;
  sshKey: string;
}

/** Tujuh placeholder yang dikenal, dalam urutan tabel inventaris (§2.5). */
export const PLACEHOLDERS: readonly (keyof ScriptValues)[] = [
  'ipTarget',
  'usernameTarget',
  'passwordTarget',
  'ipServer',
  'usernameServer',
  'passwordServer',
  'sshKey',
];

export type ScriptRenderErrorCode = 'UNSAFE_BARE_VALUE' | 'CONTROL_CHARACTER';

/** Galat render. Pesan hanya memuat NAMA placeholder, tidak pernah nilainya (bisa sandi). */
export class ScriptRenderError extends Error {
  readonly code: ScriptRenderErrorCode;

  constructor(code: ScriptRenderErrorCode, message: string) {
    super(message);
    this.name = 'ScriptRenderError';
    this.code = code;
  }
}

// Nilai "aman": disisipkan apa adanya di konteks mana pun (menjamin paritas dengan aplikasi lama).
const SAFE_VALUE = /^[A-Za-z0-9._@:/+=-]*$/;
// Karakter kontrol (termasuk CR/LF/NUL/ESC/DEL): skrip dikirim baris per baris, jadi baris baru di
// dalam nilai akan menyuntikkan perintah baru.
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

type Context = 'bare' | 'double' | 'single';

const PLACEHOLDER_SET: ReadonlySet<string> = new Set(PLACEHOLDERS);

function isPlaceholder(name: string): name is keyof ScriptValues {
  return PLACEHOLDER_SET.has(name);
}

function escapeSingleQuoted(value: string): string {
  return value.replace(/'/g, "'\\''");
}

function escapeMikrotikDouble(value: string): string {
  return value.replace(/[\\"$?]/g, '\\$&');
}

function escapeUbiquitiDouble(value: string): string {
  return value.replace(/[\\"$`]/g, '\\$&');
}

/**
 * Semua bentuk sebuah nilai rahasia yang dapat tampil pada baris skrip yang dikirim (dan di-echo
 * pty): mentah, escape Mikrotik dalam kutip ganda, escape Ubiquiti dalam kutip ganda, di dalam
 * kutip tunggal, dan dibungkus kutip tunggal. Terpanjang dulu (supaya penyamaran tidak menyisakan
 * potongan bentuk escape); string kosong tidak pernah dikembalikan.
 */
export function secretForms(value: string): string[] {
  if (value === '') return [];
  const forms = new Set([
    value,
    escapeMikrotikDouble(value),
    escapeUbiquitiDouble(value),
    escapeSingleQuoted(value),
    `'${escapeSingleQuoted(value)}'`,
  ]);
  return [...forms].sort((a, b) => b.length - a.length);
}

function quoteValue(name: string, value: string, brand: Brand, context: Context): string {
  if (SAFE_VALUE.test(value)) return value;
  if (brand === 'mikrotik') {
    if (context === 'double') return escapeMikrotikDouble(value);
    throw new ScriptRenderError(
      'UNSAFE_BARE_VALUE',
      `Nilai {${name}} mengandung karakter tak aman tetapi ditempatkan di luar tanda kutip pada skrip; ` +
        'beri tanda kutip ganda di skrip atau ubah nilainya',
    );
  }
  // Ubiquiti (BusyBox ash).
  if (context === 'double') return escapeUbiquitiDouble(value);
  if (context === 'single') return escapeSingleQuoted(value);
  return `'${escapeSingleQuoted(value)}'`;
}

/**
 * Mengisi placeholder pada `raw`. Satu putaran (nilai yang berisi `{ipServer}` tidak diperluas
 * lagi), placeholder tak dikenal dibiarkan literal, nilai yang tidak diberikan menjadi string
 * kosong. Keadaan kutip dilacak per baris: kutip ganda untuk kedua merk (backslash melepas
 * karakter berikutnya), kutip tunggal hanya untuk Ubiquiti (shell; di dalamnya backslash biasa).
 */
export function renderScript(raw: string, values: Partial<ScriptValues>, brand: Brand): string {
  if (!raw) return raw;
  const singleQuotes = brand === 'ubiquiti';
  let out = '';
  let inDouble = false;
  let inSingle = false;
  let i = 0;
  while (i < raw.length) {
    const ch = raw.charAt(i);
    if (ch === '\n') {
      inDouble = false;
      inSingle = false;
      out += ch;
      i += 1;
    } else if (ch === '{') {
      const end = raw.indexOf('}', i + 1);
      const name = end > i ? raw.slice(i + 1, end) : '';
      if (isPlaceholder(name)) {
        const value = values[name] ?? '';
        if (hasControlChars(value)) {
          throw new ScriptRenderError(
            'CONTROL_CHARACTER',
            `Nilai {${name}} mengandung karakter kontrol atau baris baru`,
          );
        }
        const context: Context = inDouble ? 'double' : inSingle ? 'single' : 'bare';
        out += quoteValue(name, value, brand, context);
        i = end + 1;
      } else {
        out += ch;
        i += 1;
      }
    } else if (ch === '\\' && !inSingle) {
      // Melepas karakter berikutnya (kecuali `{`, supaya placeholder tetap terisi seperti aplikasi
      // lama, dan baris baru, yang mengakhiri baris).
      const next = raw.charAt(i + 1);
      if (next !== '' && next !== '{' && next !== '\n') {
        out += ch + next;
        i += 2;
      } else {
        out += ch;
        i += 1;
      }
    } else {
      if (ch === '"' && !inSingle) inDouble = !inDouble;
      else if (ch === "'" && singleQuotes && !inDouble) inSingle = !inSingle;
      out += ch;
      i += 1;
    }
  }
  return out;
}
