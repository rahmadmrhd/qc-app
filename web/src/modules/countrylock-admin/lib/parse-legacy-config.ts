import {
  type BrandConfig,
  ConfigError,
  type CountryLockConfig,
  parseConfig,
} from '@countrylock/config';
import type { ImportClInput } from '@shared/contract';
import {
  type ClBrand,
  type ClBrandSettings,
  type ClSettings,
  validateClPath,
} from '@shared/countrylock-bundle';

const BRANDS: readonly ClBrand[] = ['mikrotik', 'ubiquiti'];
const FALLBACK_BRIDGE = 'bridge1';
const DEFAULT_PREFIX = 24;

export interface LegacyParseResult {
  /** Permintaan impor utuh (belum dipecah); `null` bila `config.QC` tidak dapat dipakai sama sekali. */
  request: ImportClInput | null;
  /** Hal yang perlu diperhatikan admin sebelum mengimpor (bukan penghalang kecuali `request` null). */
  problems: string[];
  /** Keterangan saja (mis. data lama yang memang tidak dibawa). */
  notes: string[];
}

function isIpv4(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function baseName(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return slash < 0 ? path : path.slice(slash + 1);
}

/**
 * Membuang karakter `)` yang berada DI LUAR string JSON (nilai di dalam string, mis. kunci SSH yang kebetulan berisi
 * `)`, tidak disentuh). Mengembalikan teks bersih dan nomor baris tiap `)` yang dibuang.
 */
function stripStrayParens(text: string): { cleaned: string; lines: number[] } {
  let out = '';
  let inString = false;
  let escaped = false;
  let line = 1;
  const lines: number[] = [];
  for (const char of text) {
    if (char === '\n') line += 1;
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    if (char === ')') {
      lines.push(line);
      continue;
    }
    out += char;
  }
  return { cleaned: out, lines };
}

function defaultBrand(brand: ClBrand, config: CountryLockConfig): ClBrandSettings {
  const bridge = config.server.interfaceBridge || FALLBACK_BRIDGE;
  const mode = {
    ip: '',
    ipServer: config.server.ip,
    connectVia: 'Target' as const,
    interfaceBridge: bridge,
  };
  return brand === 'mikrotik'
    ? {
        label: 'Mikrotik',
        username: 'admin',
        password: '',
        web: 'http://{ip}/',
        modes: { single: mode, multi: mode },
      }
    : {
        label: 'Ubiquiti',
        username: 'ubnt',
        password: 'ubnt',
        web: 'https://{ip}/',
        modes: { single: mode, multi: mode },
      };
}

function mapBrand(brand: BrandConfig): ClBrandSettings {
  return {
    label: brand.label,
    username: brand.username,
    password: brand.password,
    web: brand.web,
    modes: {
      single: {
        ip: brand.single.ip,
        ipServer: brand.single.ipServer,
        connectVia: brand.single.connectVia,
        interfaceBridge: brand.single.interfaceBridge,
      },
      multi: {
        ip: '',
        ipServer: brand.multi.ipServer,
        connectVia: brand.multi.connectVia,
        interfaceBridge: brand.multi.interfaceBridge,
      },
    },
  };
}

/** IP komputer bawaan: satu segmen /24 dengan router jump, alamat .3 (atau .4 bila router sendiri .3). */
function defaultComputerIp(routerIp: string): string {
  const parts = routerIp.split('.');
  const last = Number(parts[3]);
  return `${parts[0]}.${parts[1]}.${parts[2]}.${last === 3 ? 4 : 3}`;
}

function parseOrFail(configText: string): {
  parsed: { config: CountryLockConfig; warnings: string[] } | null;
  problems: string[];
} {
  const problems: string[] = [];
  const attempt = (text: string) => {
    try {
      return parseConfig(text);
    } catch (error) {
      if (error instanceof ConfigError) return error;
      throw error;
    }
  };
  let result = attempt(configText);
  if (result instanceof ConfigError) {
    // JSON rusak: coba buang `)` nyasar di luar string (salah ketik yang pernah ada di config.QC lama).
    const { cleaned, lines } = stripStrayParens(configText);
    if (lines.length > 0) {
      const retry = attempt(cleaned);
      if (!(retry instanceof ConfigError)) {
        result = retry;
        problems.push(
          `config.QC memuat karakter ")" nyasar di luar string (baris ${lines.join(', ')}); dibuang saat impor. Periksa hasilnya.`,
        );
      }
    }
  }
  if (result instanceof ConfigError) {
    return { parsed: null, problems: [`${result.message}`] };
  }
  return { parsed: result, problems };
}

/**
 * Memetakan `config.QC` lama dan berkas skrip terpilih ke permintaan impor (spek §5.2, impor sekali pakai). Skrip dicocokkan
 * dengan firmware lewat nama berkas (tak peka huruf besar/kecil) dan diberi jalur `<folder>/<berkas>`; skrip yang tak
 * dirujuk firmware mana pun dilewati. `sshKeys`, `version`, dan daftar interface lama tidak dibawa (spek §5.2).
 */
export function parseLegacyConfig(
  configText: string,
  files: readonly { path: string; text: string }[],
): LegacyParseResult {
  const { parsed, problems } = parseOrFail(configText);
  if (!parsed) return { request: null, problems, notes: [] };
  const { config, warnings } = parsed;
  if (!isIpv4(config.server.ip)) {
    return {
      request: null,
      problems: [...problems, `server.ip "${config.server.ip}" bukan alamat IPv4 yang sah`],
      notes: [],
    };
  }

  const notes = warnings.filter((warning) => /sshKeys/.test(warning));
  for (const warning of warnings) {
    if (!/sshKeys/.test(warning)) problems.push(`config.QC: ${warning}`);
  }

  // Berkas bernama sama (mis. dari dua folder lama) dikelompokkan: isi sama = satu berkas, isi berbeda = ambigu.
  const byName = new Map<string, { path: string; text: string }[]>();
  for (const file of files) {
    const key = baseName(file.path).toLowerCase();
    const group = byName.get(key) ?? [];
    if (!group.some((existing) => existing.text === file.text)) group.push(file);
    byName.set(key, group);
  }
  const reportedAmbiguous = new Set<string>();
  const used = new Set<string>();
  const scripts: ImportClInput['scripts'] = [];
  const firmwares: ImportClInput['firmwares'] = [];
  const scriptPaths = new Set<string>();

  for (const brand of BRANDS) {
    const brandConfig = config.brands[brand];
    if (!brandConfig) continue;
    const folder =
      brandConfig.folder.trim() === '' ? brand.toUpperCase() : brandConfig.folder.trim();
    for (const firmware of brandConfig.firmware) {
      let scriptPath: string | null = null;
      if (firmware.file === '') {
        problems.push(`Firmware ${firmware.code} (${brand}) tidak punya berkas skrip di config.QC`);
      } else {
        const nameKey = baseName(firmware.file).toLowerCase();
        const candidates = byName.get(nameKey) ?? [];
        const match = candidates.length === 1 ? candidates[0] : undefined;
        const candidate = `${folder}/${firmware.file}`;
        const pathProblem = validateClPath(candidate);
        if (pathProblem !== null) {
          problems.push(
            `Firmware ${firmware.code}: jalur skrip "${candidate}" tidak sah (${pathProblem})`,
          );
        } else if (candidates.length > 1) {
          used.add(nameKey);
          if (!reportedAmbiguous.has(nameKey)) {
            reportedAmbiguous.add(nameKey);
            problems.push(
              `Berkas ${baseName(firmware.file)} dipilih lebih dari satu kali dengan isi berbeda (mis. dari dua folder); tidak dapat ditentukan mana yang dipakai, jadi firmware yang merujuknya diimpor tanpa skrip. Pilih ulang hanya satu versinya.`,
            );
          }
        } else if (!match) {
          problems.push(
            `Skrip ${firmware.file} untuk firmware ${firmware.code} (${brand}) tidak ada di berkas yang dipilih`,
          );
        } else {
          scriptPath = candidate;
          used.add(baseName(match.path).toLowerCase());
          if (!scriptPaths.has(candidate)) {
            scriptPaths.add(candidate);
            scripts.push({ path: candidate, text: match.text, brand });
          }
        }
      }
      firmwares.push({ brand, code: firmware.code, label: firmware.label, scriptPath });
    }
  }

  for (const file of files) {
    if (!used.has(baseName(file.path).toLowerCase())) {
      problems.push(
        `Berkas ${baseName(file.path)} tidak dirujuk firmware mana pun di config.QC; dilewati`,
      );
    }
  }

  const routerIp = config.server.ip;
  problems.push(
    `IP komputer tidak ada di config.QC: diisi bawaan ${defaultComputerIp(routerIp)}/${DEFAULT_PREFIX} (satu segmen dengan router jump). Periksa di Pengaturan Router.`,
  );
  const settings: ClSettings = {
    schema: 1,
    router: {
      ip: routerIp,
      username: config.server.username,
      password: config.server.password,
      interfaceBridge: config.server.interfaceBridge || FALLBACK_BRIDGE,
    },
    network: { computerIp: defaultComputerIp(routerIp), prefixLength: DEFAULT_PREFIX },
    brands: {
      mikrotik: config.brands.mikrotik
        ? mapBrand(config.brands.mikrotik)
        : defaultBrand('mikrotik', config),
      ubiquiti: config.brands.ubiquiti
        ? mapBrand(config.brands.ubiquiti)
        : defaultBrand('ubiquiti', config),
    },
  };
  return { request: { settings, scripts, firmwares }, problems, notes };
}
