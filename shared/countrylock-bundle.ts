// Kontrak murni bundel Country Lock (spek `docs/superpowers/specs/2026-11-28-country-lock-sync-bundel-design.md`
// §5.1-5.2): batas, validator nama jalur, penarik rujukan `/temp/...` dan `{placeholder}` dari skrip, dokumen
// pengaturan berskema 1, validasi draf sebelum terbit, dan bentuk string kanonik hash. Murni: tanpa `node:*`,
// `crypto`, DOM, atau `fetch`; sha256 dihitung pemanggil (server, web, desktop), modul ini hanya membentuk stringnya.

import { normalizeKey } from './items';
import { hasControlChars } from './text';

/** Batas isi berkas teks (skrip, pengaturan) per revisi. */
export const CL_TEXT_MAX_BYTES = 200 * 1024;
/** Batas berkas biner router (firmware, `.npk`, `.cfg`). */
export const CL_BINARY_MAX_BYTES = 64 * 1024 * 1024;
/** Ukuran potongan unggah biner; di bawah rute biner terbesar yang dikunci tes badan permintaan. */
export const CL_CHUNK_BYTES = 4 * 1024 * 1024;
/** Panjang maksimum nama jalur berkas di bundel. */
export const CL_PATH_MAX = 200;
/** Jumlah berkas hidup maksimum di draf. */
export const CL_FILES_MAX = 400;
/** Panjang maksimum kode firmware. */
export const FIRMWARE_CODE_MAX = 40;
/**
 * Batas ukuran JSON satu panggilan impor (byte UTF-8). Di bawah 1 MB agar muatan terburuk tetap jauh di bawah batas JSON
 * REST 2 MB (invarian `body.test.ts`); klien memecah impor yang lebih besar.
 */
export const CL_IMPORT_MAX_JSON_BYTES = 900_000;

/** Tujuh placeholder yang dikenal skrip (dijaga sama dengan `countrylock/src/script-template.ts` oleh tes paritas). */
export const PLACEHOLDER_NAMES: readonly string[] = [
  'ipTarget',
  'usernameTarget',
  'passwordTarget',
  'ipServer',
  'usernameServer',
  'passwordServer',
  'sshKey',
];

/** Jalur berkas dokumen pengaturan di bundel. */
export const SETTINGS_PATH = 'settings.json';

/** Peran berkas: pengaturan dan skrip dipakai komputer; `router` diunggah ke `/temp/` router jump. */
export type ClFileRole = 'settings' | 'script' | 'router';

export type ClBrand = 'mikrotik' | 'ubiquiti';

// Nama perangkat cadangan Windows (tak dapat dipakai sebagai nama berkas, dengan atau tanpa ekstensi, tak peka huruf).
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/i;
// Karakter terlarang di nama berkas Windows; `:` juga menutup huruf drive (`C:`) dan alternate data stream (`a:b`).
const WINDOWS_FORBIDDEN = /[<>:"|?*]/;

/**
 * Pesan galat untuk nama jalur yang tak sah, atau `null` bila sah. Berkas bundel ditulis ke disk Windows oleh aplikasi
 * desktop, jadi nama yang berbahaya di Windows ditolak di sini: nama perangkat cadangan (CON, PRN, AUX, NUL, COM1-9,
 * LPT1-9) per bagian, bagian berakhir titik atau spasi, dan karakter `<>:"|?*`. Hanya dipakai saat MENULIS/menerbitkan;
 * berkas lama yang sudah tersimpan tetap terbaca dan `validateDraft` memberi galat `INVALID_PATH` saat diterbitkan.
 */
export function validateClPath(path: string): string | null {
  if (path === '') return 'Nama berkas kosong';
  if (path.length > CL_PATH_MAX) return `Nama berkas maksimal ${CL_PATH_MAX} karakter`;
  if (hasControlChars(path)) return 'Nama berkas memuat karakter kontrol';
  if (path.includes('\\')) return 'Nama berkas tidak boleh memuat garis miring terbalik';
  if (path.startsWith('/')) return 'Nama berkas tidak boleh diawali garis miring';
  for (const segment of path.split('/')) {
    if (segment === '') return 'Nama berkas tidak boleh punya bagian kosong';
    if (segment === '.' || segment === '..') return 'Nama berkas tidak boleh memuat . atau ..';
    if (WINDOWS_FORBIDDEN.test(segment)) {
      return 'Nama berkas tidak boleh memuat karakter < > : " | ? * (tidak sah di Windows)';
    }
    if (segment.endsWith('.') || segment.endsWith(' ')) {
      return 'Bagian nama berkas tidak boleh berakhir titik atau spasi (tidak sah di Windows)';
    }
    if (WINDOWS_RESERVED.test((segment.split('.')[0] ?? '').trimEnd())) {
      return 'Nama berkas memakai nama cadangan Windows (CON, PRN, AUX, NUL, COM1-9, LPT1-9)';
    }
  }
  return null;
}

/** Kunci perbandingan nama jalur (huruf kecil) untuk mendeteksi bentrok huruf besar/kecil. */
export function pathKey(path: string): string {
  return path.toLowerCase();
}

// `/temp/<nama>` yang tidak didahului karakter jalur (agar `/disk/temp/x` tidak terhitung); nama berhenti di spasi,
// kutip, titik koma, kurung, atau koma.
const TEMP_REF_PATTERN = /(?<![\w.-])\/temp\/([^\s"'`;()[\]{}\\,]+)/g;

/** Nama berkas dari rujukan `/temp/<nama>` (termasuk `src-path=/temp/<nama>`), tanpa duplikat, urut kemunculan. */
export function extractTempRefs(text: string): string[] {
  const result: string[] = [];
  for (const match of text.matchAll(TEMP_REF_PATTERN)) {
    const name = (match[1] ?? '').replace(/\.+$/, '');
    if (name !== '' && !result.includes(name)) result.push(name);
  }
  return result;
}

/** Isi `{nama}` unik pada teks, urut kemunculan (nama tak dikenal ikut; pemanggil membandingkan dengan `PLACEHOLDER_NAMES`). */
export function extractPlaceholders(text: string): string[] {
  const result: string[] = [];
  for (const match of text.matchAll(/\{([A-Za-z0-9_]+)\}/g)) {
    const name = match[1] ?? '';
    if (name !== '' && !result.includes(name)) result.push(name);
  }
  return result;
}

/** Merk Country Lock dari nama merk di Data Item (tak peka huruf besar/kecil dan spasi); `null` bila bukan Mikrotik/Ubiquiti. */
export function countryLockBrandOf(name: string): ClBrand | null {
  const key = normalizeKey(name);
  return key === 'mikrotik' || key === 'ubiquiti' ? key : null;
}

// --- Dokumen pengaturan (skema 1) -------------------------------------------------------------------------------
// Menggantikan `config.QC` (spek §5.2). Tidak ada `folder`, `version`, `manualCredentialInput`, `sshKeys`, `interfaceList`,
// atau `interfaceComp`; daftar firmware ada di tabel firmware server, bukan di dokumen ini. Profil runtime mode dan
// keadaan router menyusul di fase berikutnya lewat kenaikan `schema` dan `minApp`.

export interface ClMode {
  /** IP perangkat target; hanya bermakna di mode single (kosong di multi). */
  ip: string;
  /** Nilai placeholder `{ipServer}`. */
  ipServer: string;
  connectVia: 'Target' | 'Server';
  interfaceBridge: string;
}

export interface ClBrandSettings {
  label: string;
  /** Kredensial bawaan target. */
  username: string;
  password: string;
  /** Templat tautan web perangkat (memuat `{ip}`). */
  web: string;
  modes: { single: ClMode; multi: ClMode };
}

export interface ClSettings {
  schema: 1;
  /** Router jump: alamat, kredensial, dan nama bridge. */
  router: { ip: string; username: string; password: string; interfaceBridge: string };
  /** Jaringan komputer yang diharapkan. */
  network: { computerIp: string; prefixLength: number };
  brands: Record<ClBrand, ClBrandSettings>;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIpv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

class SettingsError extends Error {}

function text(node: Json, key: string, where: string): string {
  const value = node[key];
  if (typeof value !== 'string') throw new SettingsError(`${where}.${key} harus berupa teks`);
  return value;
}

function ip(node: Json, key: string, where: string, allowEmpty: boolean): string {
  const value = text(node, key, where);
  if (value === '' && allowEmpty) return value;
  if (!isIpv4(value)) throw new SettingsError(`${where}.${key} bukan alamat IPv4 yang sah`);
  return value;
}

function bridge(node: Json, where: string): string {
  const value = text(node, 'interfaceBridge', where);
  if (value.trim() === '' || hasControlChars(value)) {
    throw new SettingsError(`${where}.interfaceBridge wajib diisi`);
  }
  return value;
}

function object(parent: Json, key: string, where: string): Json {
  const value = parent[key];
  if (!isObject(value))
    throw new SettingsError(`${where === '' ? key : `${where}.${key}`} harus berupa objek`);
  return value;
}

function parseMode(parent: Json, key: 'single' | 'multi', where: string): ClMode {
  const here = `${where}.modes.${key}`;
  const node = object(object(parent, 'modes', where), key, `${where}.modes`);
  const connectVia = node.connectVia;
  if (connectVia !== 'Target' && connectVia !== 'Server') {
    throw new SettingsError(`${here}.connectVia harus Target atau Server`);
  }
  return {
    ip: ip(node, 'ip', here, true),
    ipServer: ip(node, 'ipServer', here, false),
    connectVia,
    interfaceBridge: bridge(node, here),
  };
}

function parseBrand(root: Json, brand: ClBrand): ClBrandSettings {
  const where = `brands.${brand}`;
  const node = object(object(root, 'brands', ''), brand, 'brands');
  const web = text(node, 'web', where);
  if (web !== '' && !web.includes('{ip}')) {
    throw new SettingsError(`${where}.web harus memuat {ip}`);
  }
  const label = text(node, 'label', where).trim();
  if (label === '') throw new SettingsError(`${where}.label wajib diisi`);
  return {
    label,
    username: text(node, 'username', where),
    password: text(node, 'password', where),
    web,
    modes: { single: parseMode(node, 'single', where), multi: parseMode(node, 'multi', where) },
  };
}

/** Mengurai dan memvalidasi isi `settings.json` (skema 1). Kunci tak dikenal diabaikan. */
export function parseSettingsFile(
  source: string,
): { ok: true; settings: ClSettings } | { ok: false; error: string } {
  let root: unknown;
  try {
    root = JSON.parse(source);
  } catch {
    return { ok: false, error: 'settings.json bukan JSON yang valid' };
  }
  if (!isObject(root)) return { ok: false, error: 'settings.json harus berupa objek JSON' };
  try {
    if (root.schema !== 1) throw new SettingsError('schema harus 1');
    const router = object(root, 'router', '');
    const network = object(root, 'network', '');
    const prefixLength = network.prefixLength;
    if (
      typeof prefixLength !== 'number' ||
      !Number.isInteger(prefixLength) ||
      prefixLength < 1 ||
      prefixLength > 32
    ) {
      throw new SettingsError('network.prefixLength harus bilangan bulat 1-32');
    }
    const settings: ClSettings = {
      schema: 1,
      router: {
        ip: ip(router, 'ip', 'router', false),
        username: text(router, 'username', 'router'),
        password: text(router, 'password', 'router'),
        interfaceBridge: bridge(router, 'router'),
      },
      network: { computerIp: ip(network, 'computerIp', 'network', false), prefixLength },
      brands: { mikrotik: parseBrand(root, 'mikrotik'), ubiquiti: parseBrand(root, 'ubiquiti') },
    };
    return { ok: true, settings };
  } catch (error) {
    if (error instanceof SettingsError) return { ok: false, error: error.message };
    throw error;
  }
}

// --- Validasi draf -------------------------------------------------------------------------------------------------

export interface ClDraftFile {
  path: string;
  role: ClFileRole;
  sha256: string;
  size: number;
  /** Isi berkas teks (settings, skrip); kosong untuk biner. */
  text?: string;
}

export interface ClFirmwareRef {
  brand: ClBrand;
  code: string;
  scriptPath: string | null;
  parallel: boolean;
}

export interface ClIssue {
  severity: 'error' | 'warning';
  code: string;
  path?: string;
  message: string;
}

function basename(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? path : path.slice(index + 1);
}

// `/ip arp remove [find ...]`; isi kurung siku diperiksa apakah memfilter menurut alamat.
const ARP_REMOVE_PATTERN = /\/ip\s+arp\s+remove\s+\[\s*find\b([^\]]*)\]/gi;

function flushesArpGlobally(script: string): boolean {
  for (const match of script.matchAll(ARP_REMOVE_PATTERN)) {
    if (!/\baddress\s*=/i.test(match[1] ?? '')) return true;
  }
  return false;
}

/** Pengaturan bundel terbit sebelumnya, pembanding peringatan `ADDRESS_CHANGED`. */
export interface ClPreviousBundle {
  settings: ClSettings;
}

function addressChanges(path: string, before: ClSettings, after: ClSettings): ClIssue[] {
  const issues: ClIssue[] = [];
  if (before.router.ip !== after.router.ip) {
    issues.push({
      severity: 'warning',
      code: 'ADDRESS_CHANGED',
      path,
      message: `Alamat router berubah dari ${before.router.ip} ke ${after.router.ip}. Router yang sudah terpasang masih memakai alamat lama (${before.router.ip}), jadi komputer tidak akan menjangkaunya sampai router diatur ulang; skrip yang memakai {ipServer} perlu diperiksa`,
    });
  }
  if (before.network.computerIp !== after.network.computerIp) {
    issues.push({
      severity: 'warning',
      code: 'ADDRESS_CHANGED',
      path,
      message: `IP komputer berubah dari ${before.network.computerIp} ke ${after.network.computerIp}. Komputer operator harus pindah segmen/alamat ini, dan router yang terpasang masih mengenal alamat lama`,
    });
  }
  if (before.router.interfaceBridge !== after.router.interfaceBridge) {
    issues.push({
      severity: 'warning',
      code: 'ADDRESS_CHANGED',
      path,
      message: `Nama bridge router berubah dari ${before.router.interfaceBridge} ke ${after.router.interfaceBridge}. Router yang sudah terpasang masih memakai nama lama, sehingga skrip bisa gagal mencari bridge`,
    });
  }
  return issues;
}

/**
 * Memeriksa draf bundel sebelum terbit. Kode `error` menolak penerbitan: `SETTINGS_MISSING`, `SETTINGS_INVALID`,
 * `SCRIPT_MISSING`, `TEMP_REF_MISSING`, `PLACEHOLDER_UNKNOWN`, `DUPLICATE_PATH_CASE`. Kode `warning` hanya peringatan:
 * `ORPHAN_ROUTER_FILE`, `ARP_FLUSH_GLOBAL`, `ADDRESS_CHANGED`. `DUPLICATE_ROUTER_NAME` (error): dua berkas router berbeda
 * bernama dasar sama bertabrakan di `/temp/` router yang datar. `previous` (opsional) = pengaturan bundel terbit sebelumnya;
 * bila alamat router, IP komputer, atau nama bridge router berbeda, tiap perbedaan jadi peringatan `ADDRESS_CHANGED`
 * (spek §5.2 f; hanya peringatan, tidak menghalangi terbit).
 */
export function validateDraft(
  files: ClDraftFile[],
  firmwares: ClFirmwareRef[],
  previous?: ClPreviousBundle,
): ClIssue[] {
  const issues: ClIssue[] = [];

  // Berkas lama dengan nama yang kini ditolak (tetap terbaca, tetapi tak boleh masuk bundel).
  for (const file of files) {
    const problem = validateClPath(file.path);
    if (problem !== null) {
      issues.push({
        severity: 'error',
        code: 'INVALID_PATH',
        path: file.path,
        message: `Nama berkas "${file.path}" tidak sah: ${problem}. Buat berkas baru dengan nama yang sah lalu hapus yang lama`,
      });
    }
  }

  // Bentrok huruf besar/kecil (atau jalur kembar).
  const seen = new Map<string, string>();
  for (const file of files) {
    const key = pathKey(file.path);
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, file.path);
    } else {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_PATH_CASE',
        path: file.path,
        message: `Nama berkas bentrok dengan "${first}" (beda huruf besar/kecil tidak dianggap berbeda)`,
      });
    }
  }

  // Dua berkas router berbeda dengan nama dasar sama saling menimpa di /temp/ router (datar).
  const routerBase = new Map<string, string>();
  for (const file of files) {
    if (file.role !== 'router') continue;
    const first = routerBase.get(basename(file.path));
    if (first === undefined) {
      routerBase.set(basename(file.path), file.path);
    } else if (first !== file.path) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_ROUTER_NAME',
        path: file.path,
        message: `Berkas router "${file.path}" bernama dasar sama dengan "${first}"; keduanya akan saling menimpa di /temp/ router`,
      });
    }
  }

  // Dokumen pengaturan.
  const settings = files.find((file) => pathKey(file.path) === pathKey(SETTINGS_PATH));
  if (!settings) {
    issues.push({
      severity: 'error',
      code: 'SETTINGS_MISSING',
      path: SETTINGS_PATH,
      message: 'Dokumen pengaturan (settings.json) belum ada',
    });
  } else if (settings.role !== 'settings' || settings.text === undefined) {
    issues.push({
      severity: 'error',
      code: 'SETTINGS_INVALID',
      path: settings.path,
      message: 'settings.json harus berupa berkas teks berperan pengaturan',
    });
  } else {
    const parsed = parseSettingsFile(settings.text);
    if (!parsed.ok) {
      issues.push({
        severity: 'error',
        code: 'SETTINGS_INVALID',
        path: settings.path,
        message: parsed.error,
      });
    } else if (previous !== undefined) {
      issues.push(...addressChanges(settings.path, previous.settings, parsed.settings));
    }
  }

  // Skrip tiap firmware harus ada.
  const scriptKeys = new Set(
    files.filter((file) => file.role === 'script').map((file) => pathKey(file.path)),
  );
  for (const firmware of firmwares) {
    if (firmware.scriptPath === null) {
      issues.push({
        severity: 'error',
        code: 'SCRIPT_MISSING',
        message: `Firmware ${firmware.brand} ${firmware.code} belum punya skrip`,
      });
    } else if (!scriptKeys.has(pathKey(firmware.scriptPath))) {
      issues.push({
        severity: 'error',
        code: 'SCRIPT_MISSING',
        path: firmware.scriptPath,
        message: `Skrip "${firmware.scriptPath}" untuk firmware ${firmware.brand} ${firmware.code} tidak ada`,
      });
    }
  }

  // Isi skrip: placeholder, rujukan /temp, dan ARP flush global.
  const routerNames = new Set(
    files.filter((file) => file.role === 'router').map((file) => basename(file.path)),
  );
  const referenced = new Set<string>();
  const known = new Set(PLACEHOLDER_NAMES);
  for (const file of files) {
    if (file.role !== 'script' || file.text === undefined) continue;
    for (const name of extractPlaceholders(file.text)) {
      if (known.has(name)) continue;
      issues.push({
        severity: 'error',
        code: 'PLACEHOLDER_UNKNOWN',
        path: file.path,
        message: `Placeholder {${name}} tidak dikenal`,
      });
    }
    for (const name of extractTempRefs(file.text)) {
      referenced.add(name);
      if (routerNames.has(name)) continue;
      issues.push({
        severity: 'error',
        code: 'TEMP_REF_MISSING',
        path: file.path,
        message: `Skrip merujuk /temp/${name} tetapi berkas router itu tidak ada di bundel`,
      });
    }
    if (flushesArpGlobally(file.text)) {
      issues.push({
        severity: 'warning',
        code: 'ARP_FLUSH_GLOBAL',
        path: file.path,
        message:
          'Skrip menghapus semua entri ARP (/ip arp remove [find]) tanpa filter alamat; inject paralel bisa saling mengganggu',
      });
    }
  }

  // Berkas router yang tak dirujuk skrip mana pun.
  for (const file of files) {
    if (file.role !== 'router' || referenced.has(basename(file.path))) continue;
    issues.push({
      severity: 'warning',
      code: 'ORPHAN_ROUTER_FILE',
      path: file.path,
      message: `Berkas router "${file.path}" tidak dirujuk skrip mana pun`,
    });
  }

  return issues;
}

/**
 * String kanonik untuk hash bundel: entri diurut menurut `pathKey`, tiap entri satu baris `path\0sha256\n`, lalu `extra`
 * (mis. bagian pengaturan yang relevan) di akhir. sha256 atas string ini dihitung pemanggil.
 */
export function canonicalHashInput(
  entries: { path: string; sha256: string }[],
  extra?: string,
): string {
  const sorted = [...entries].sort((a, b) => {
    const left = pathKey(a.path);
    const right = pathKey(b.path);
    if (left !== right) return left < right ? -1 : 1;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
  let result = '';
  for (const entry of sorted) result += `${entry.path}\u0000${entry.sha256}\n`;
  return result + (extra ?? '');
}

/** Manifest bundel terbit yang diunduh desktop. */
export interface ClManifest {
  schema: 1;
  minApp: string;
  number: number;
  computerHash: string;
  routerHash: string;
  files: { path: string; role: ClFileRole; sha256: string; size: number }[];
  firmwares: {
    brand: ClBrand;
    code: string;
    label: string;
    scriptPath: string | null;
    parallel: boolean;
  }[];
}

/**
 * "Dipakai oleh" tiap berkas router (spek §5.2): kode firmware yang skripnya merujuk `/temp/<nama dasar berkas>`. Kunci peta =
 * jalur berkas router (semua berkas router ada, daftar kosong bila tak dirujuk); kode urut abjad tanpa duplikat. Skrip dicari
 * lewat `scriptPath` tak peka huruf besar/kecil.
 */
export function routerUsedBy(
  files: ClDraftFile[],
  firmwares: ClFirmwareRef[],
): Map<string, string[]> {
  const textByKey = new Map<string, string>();
  for (const file of files) {
    if (file.role === 'script' && file.text !== undefined)
      textByKey.set(pathKey(file.path), file.text);
  }
  const used = new Map<string, Set<string>>();
  for (const file of files) if (file.role === 'router') used.set(file.path, new Set());
  for (const firmware of firmwares) {
    if (firmware.scriptPath === null) continue;
    const text = textByKey.get(pathKey(firmware.scriptPath));
    if (text === undefined) continue;
    const refs = new Set(extractTempRefs(text));
    for (const file of files) {
      if (file.role === 'router' && refs.has(basename(file.path)))
        used.get(file.path)?.add(firmware.code);
    }
  }
  return new Map([...used].map(([path, codes]) => [path, [...codes].sort()]));
}
