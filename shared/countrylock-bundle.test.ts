import { describe, expect, test } from 'bun:test';
import {
  CL_BINARY_MAX_BYTES,
  CL_CHUNK_BYTES,
  CL_FILES_MAX,
  CL_PATH_MAX,
  CL_TEXT_MAX_BYTES,
  type ClDraftFile,
  type ClFirmwareRef,
  canonicalHashInput,
  countryLockBrandOf,
  extractPlaceholders,
  extractTempRefs,
  FIRMWARE_CODE_MAX,
  PLACEHOLDER_NAMES,
  parseSettingsFile,
  pathKey,
  routerUsedBy,
  SETTINGS_PATH,
  validateClPath,
  validateDraft,
} from './countrylock-bundle';

const VALID_SETTINGS = {
  schema: 1,
  router: { ip: '192.168.88.1', username: 'admin', password: '', interfaceBridge: 'bridge1' },
  network: { computerIp: '192.168.88.10', prefixLength: 24 },
  brands: {
    mikrotik: {
      label: 'Mikrotik',
      username: 'admin',
      password: '',
      web: 'http://{ip}/',
      modes: {
        single: {
          ip: '192.168.88.2',
          ipServer: '192.168.88.1',
          connectVia: 'Target',
          interfaceBridge: 'bridge1',
        },
        multi: {
          ip: '',
          ipServer: '192.168.88.1',
          connectVia: 'Server',
          interfaceBridge: 'bridge1',
        },
      },
    },
    ubiquiti: {
      label: 'Ubiquiti',
      username: 'ubnt',
      password: 'ubnt',
      web: 'https://{ip}/',
      modes: {
        single: {
          ip: '192.168.1.20',
          ipServer: '192.168.1.1',
          connectVia: 'Server',
          interfaceBridge: 'bridge1',
        },
        multi: {
          ip: '',
          ipServer: '192.168.1.1',
          connectVia: 'Server',
          interfaceBridge: 'bridge1',
        },
      },
    },
  },
};

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function settingsFile(text: string = JSON.stringify(VALID_SETTINGS)): ClDraftFile {
  return { path: SETTINGS_PATH, role: 'settings', sha256: HASH_A, size: text.length, text };
}

function scriptFile(path: string, text: string): ClDraftFile {
  return { path, role: 'script', sha256: HASH_B, size: text.length, text };
}

function routerFile(path: string): ClDraftFile {
  return { path, role: 'router', sha256: HASH_B, size: 10 };
}

const FIRMWARE: ClFirmwareRef = {
  brand: 'mikrotik',
  code: 'AC',
  scriptPath: 'mikrotik/AC.rsc',
  parallel: false,
};

function codes(issues: { code: string }[]): string[] {
  return issues.map((issue) => issue.code);
}

describe('konstanta', () => {
  test('batas sesuai spek', () => {
    expect(CL_TEXT_MAX_BYTES).toBe(200 * 1024);
    expect(CL_BINARY_MAX_BYTES).toBe(64 * 1024 * 1024);
    expect(CL_CHUNK_BYTES).toBe(4 * 1024 * 1024);
    expect(CL_PATH_MAX).toBe(200);
    expect(CL_FILES_MAX).toBe(400);
    expect(FIRMWARE_CODE_MAX).toBe(40);
    expect(SETTINGS_PATH).toBe('settings.json');
    expect([...PLACEHOLDER_NAMES]).toEqual([
      'ipTarget',
      'usernameTarget',
      'passwordTarget',
      'ipServer',
      'usernameServer',
      'passwordServer',
      'sshKey',
    ]);
  });
});

describe('validateClPath', () => {
  test('menolak jalur berbahaya atau tak sah', () => {
    expect(validateClPath('')).not.toBeNull();
    expect(validateClPath('/a')).not.toBeNull();
    expect(validateClPath('a/../b')).not.toBeNull();
    expect(validateClPath('..')).not.toBeNull();
    expect(validateClPath('a\\b')).not.toBeNull();
    expect(validateClPath('a//b')).not.toBeNull();
    expect(validateClPath('a/')).not.toBeNull();
    expect(validateClPath('a\u0000b')).not.toBeNull();
    expect(validateClPath('a‮b')).not.toBeNull();
    expect(validateClPath('a'.repeat(CL_PATH_MAX + 1))).not.toBeNull();
  });

  test('menerima jalur biasa', () => {
    expect(validateClPath('mikrotik/IDN.rsc')).toBeNull();
    expect(validateClPath('settings.json')).toBeNull();
    expect(validateClPath('a'.repeat(CL_PATH_MAX))).toBeNull();
  });

  test('pathKey huruf kecil untuk deteksi bentrok huruf besar/kecil', () => {
    expect(pathKey('Mikrotik/AC.rsc')).toBe('mikrotik/ac.rsc');
  });
});

describe('extractTempRefs', () => {
  test('mengambil nama berkas /temp tanpa duplikat, urut kemunculan', () => {
    expect(extractTempRefs('src-path=/temp/customblock-x.npk\n/temp/a.bin /temp/a.bin')).toEqual([
      'customblock-x.npk',
      'a.bin',
    ]);
  });

  test('menghentikan nama di kutip dan mengabaikan jalur lain bernama temp', () => {
    expect(extractTempRefs('/file remove "/temp/x.cfg"; /disk/temp/y.bin')).toEqual(['x.cfg']);
    expect(extractTempRefs('tidak ada rujukan')).toEqual([]);
  });
});

describe('extractPlaceholders', () => {
  test('isi {nama} unik', () => {
    expect(extractPlaceholders('{ipTarget} {nope} {ipTarget}')).toEqual(['ipTarget', 'nope']);
    expect(extractPlaceholders('tanpa placeholder')).toEqual([]);
  });
});

describe('countryLockBrandOf', () => {
  test('mengenali Mikrotik dan Ubiquiti tanpa peka huruf besar/kecil dan spasi', () => {
    expect(countryLockBrandOf('Mikrotik')).toBe('mikrotik');
    expect(countryLockBrandOf('  UBIQUITI ')).toBe('ubiquiti');
    expect(countryLockBrandOf('TP-Link')).toBeNull();
    expect(countryLockBrandOf('')).toBeNull();
  });
});

describe('parseSettingsFile', () => {
  test('menerima contoh sah', () => {
    const result = parseSettingsFile(JSON.stringify(VALID_SETTINGS));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.settings.schema).toBe(1);
      expect(result.settings.router.ip).toBe('192.168.88.1');
      expect(result.settings.network.prefixLength).toBe(24);
      expect(result.settings.brands.mikrotik.modes.multi.connectVia).toBe('Server');
    }
  });

  test('menolak JSON rusak dan schema selain 1', () => {
    expect(parseSettingsFile('{bukan json').ok).toBe(false);
    expect(parseSettingsFile('[]').ok).toBe(false);
    expect(parseSettingsFile(JSON.stringify({ ...VALID_SETTINGS, schema: 2 })).ok).toBe(false);
    expect(parseSettingsFile(JSON.stringify({ router: VALID_SETTINGS.router })).ok).toBe(false);
  });

  test('menolak IP atau nilai mode yang tak sah', () => {
    const badIp = { ...VALID_SETTINGS, router: { ...VALID_SETTINGS.router, ip: '300.1.1.1' } };
    expect(parseSettingsFile(JSON.stringify(badIp)).ok).toBe(false);
    const badVia = structuredClone(VALID_SETTINGS);
    (badVia.brands.mikrotik.modes.single as { connectVia: string }).connectVia = 'Lain';
    expect(parseSettingsFile(JSON.stringify(badVia)).ok).toBe(false);
    const badPrefix = {
      ...VALID_SETTINGS,
      network: { computerIp: '192.168.88.10', prefixLength: 40 },
    };
    expect(parseSettingsFile(JSON.stringify(badPrefix)).ok).toBe(false);
  });
});

describe('validateDraft', () => {
  const healthy = (): ClDraftFile[] => [
    settingsFile(),
    scriptFile('mikrotik/AC.rsc', '/file print\n:put {ipTarget}\n/import file-name=/temp/AC.cfg'),
    routerFile('mikrotik/AC.cfg'),
  ];

  test('draf sehat tidak punya temuan', () => {
    expect(validateDraft(healthy(), [FIRMWARE])).toEqual([]);
  });

  test('tanpa settings.json -> SETTINGS_MISSING', () => {
    const issues = validateDraft(healthy().slice(1), [FIRMWARE]);
    expect(codes(issues)).toContain('SETTINGS_MISSING');
    expect(issues.find((i) => i.code === 'SETTINGS_MISSING')?.severity).toBe('error');
  });

  test('settings.json tak terurai -> SETTINGS_INVALID', () => {
    const files = healthy();
    files[0] = settingsFile('{rusak');
    expect(codes(validateDraft(files, [FIRMWARE]))).toContain('SETTINGS_INVALID');
  });

  test('firmware tanpa skrip atau menunjuk skrip yang tak ada -> SCRIPT_MISSING', () => {
    const hilang = validateDraft(healthy(), [{ ...FIRMWARE, scriptPath: 'mikrotik/NONE.rsc' }]);
    expect(codes(hilang)).toContain('SCRIPT_MISSING');
    const kosong = validateDraft(healthy(), [{ ...FIRMWARE, scriptPath: null }]);
    expect(codes(kosong)).toContain('SCRIPT_MISSING');
  });

  test('placeholder tak dikenal -> PLACEHOLDER_UNKNOWN', () => {
    const files = healthy();
    files[1] = scriptFile(
      'mikrotik/AC.rsc',
      ':put {nope} {ipTarget}\n/import file-name=/temp/AC.cfg',
    );
    const issues = validateDraft(files, [FIRMWARE]);
    const found = issues.filter((i) => i.code === 'PLACEHOLDER_UNKNOWN');
    expect(found).toHaveLength(1);
    expect(found[0]?.path).toBe('mikrotik/AC.rsc');
    expect(found[0]?.message).toContain('nope');
  });

  test('rujukan /temp yang tak ada -> TEMP_REF_MISSING', () => {
    const files = healthy();
    files[1] = scriptFile('mikrotik/AC.rsc', '/import file-name=/temp/x.npk');
    const issues = validateDraft(files, [FIRMWARE]);
    expect(codes(issues)).toContain('TEMP_REF_MISSING');
    expect(issues.find((i) => i.code === 'TEMP_REF_MISSING')?.message).toContain('x.npk');
  });

  test('dua jalur beda huruf besar/kecil -> DUPLICATE_PATH_CASE', () => {
    const files = [...healthy(), routerFile('Mikrotik/ac.cfg')];
    expect(codes(validateDraft(files, [FIRMWARE]))).toContain('DUPLICATE_PATH_CASE');
  });

  test('berkas router tak dirujuk skrip -> peringatan ORPHAN_ROUTER_FILE', () => {
    const issues = validateDraft([...healthy(), routerFile('mikrotik/yatim.npk')], [FIRMWARE]);
    const orphan = issues.filter((i) => i.code === 'ORPHAN_ROUTER_FILE');
    expect(orphan).toHaveLength(1);
    expect(orphan[0]?.severity).toBe('warning');
    expect(orphan[0]?.path).toBe('mikrotik/yatim.npk');
    expect(issues.some((i) => i.severity === 'error')).toBe(false);
  });

  test('ARP flush global -> peringatan; dengan filter address tidak', () => {
    const global = healthy();
    global[1] = scriptFile(
      'mikrotik/AC.rsc',
      '/ip arp remove [find]\n/import file-name=/temp/AC.cfg',
    );
    const warned = validateDraft(global, [FIRMWARE]);
    expect(warned.find((i) => i.code === 'ARP_FLUSH_GLOBAL')?.severity).toBe('warning');

    const scoped = healthy();
    scoped[1] = scriptFile(
      'mikrotik/AC.rsc',
      '/ip arp remove [find address={ipTarget}]\n/import file-name=/temp/AC.cfg',
    );
    expect(codes(validateDraft(scoped, [FIRMWARE]))).not.toContain('ARP_FLUSH_GLOBAL');
  });

  test('tanpa bundel sebelumnya tidak ada ADDRESS_CHANGED', () => {
    expect(codes(validateDraft(healthy(), [FIRMWARE]))).not.toContain('ADDRESS_CHANGED');
    expect(codes(validateDraft(healthy(), [FIRMWARE], undefined))).not.toContain('ADDRESS_CHANGED');
  });

  test('alamat router, IP komputer, atau nama bridge beda dari bundel sebelumnya -> peringatan ADDRESS_CHANGED (bukan error)', () => {
    const previous = parseSettingsFile(JSON.stringify(VALID_SETTINGS));
    if (!previous.ok) throw new Error('fixture');
    expect(codes(validateDraft(healthy(), [FIRMWARE], { settings: previous.settings }))).toEqual(
      [],
    );

    const changed = {
      ...VALID_SETTINGS,
      router: { ...VALID_SETTINGS.router, ip: '10.9.9.1', interfaceBridge: 'bridge2' },
      network: { ...VALID_SETTINGS.network, computerIp: '10.9.9.10' },
    };
    const files = healthy();
    files[0] = settingsFile(JSON.stringify(changed));
    const issues = validateDraft(files, [FIRMWARE], { settings: previous.settings });
    const address = issues.filter((issue) => issue.code === 'ADDRESS_CHANGED');
    expect(address).toHaveLength(3);
    expect(address.every((issue) => issue.severity === 'warning')).toBe(true);
    expect(address.every((issue) => issue.path === SETTINGS_PATH)).toBe(true);
    expect(address.map((issue) => issue.message).join(' ')).toContain('192.168.88.1');
    expect(address.map((issue) => issue.message).join(' ')).toContain('10.9.9.1');
    expect(issues.some((issue) => issue.severity === 'error')).toBe(false);
  });

  test('dua berkas router berbeda dengan nama dasar sama -> DUPLICATE_ROUTER_NAME (error)', () => {
    const files = [...healthy(), routerFile('lain/AC.cfg')];
    const issue = validateDraft(files, [FIRMWARE]).find((i) => i.code === 'DUPLICATE_ROUTER_NAME');
    expect(issue?.severity).toBe('error');
    expect(issue?.path).toBe('lain/AC.cfg');
  });
});

describe('canonicalHashInput', () => {
  const entries = [
    { path: 'b/two.rsc', sha256: HASH_B },
    { path: 'A/one.rsc', sha256: HASH_A },
  ];

  test('sama untuk urutan masukan berbeda', () => {
    expect(canonicalHashInput(entries)).toBe(canonicalHashInput([...entries].reverse()));
  });

  test('berbeda bila satu sha256 atau extra berbeda', () => {
    const base = canonicalHashInput(entries);
    const changed = [
      { path: 'b/two.rsc', sha256: HASH_B },
      { path: 'A/one.rsc', sha256: 'c'.repeat(64) },
    ];
    expect(canonicalHashInput(changed)).not.toBe(base);
    expect(canonicalHashInput(entries, 'x')).not.toBe(base);
  });

  test('bentuk baris path NUL sha256 LF, extra di akhir', () => {
    expect(canonicalHashInput([{ path: 'a', sha256: HASH_A }], 'EXTRA')).toBe(
      `a\u0000${HASH_A}\nEXTRA`,
    );
  });
});

describe('routerUsedBy', () => {
  test('berkas router -> kode firmware yang skripnya merujuk /temp/<nama dasar>', () => {
    const files = [
      scriptFile('mikrotik/AC.rsc', '/import file-name=/temp/AC.cfg'),
      scriptFile(
        'mikrotik/AD.rsc',
        '/import file-name=/temp/AC.cfg; /import file-name=/temp/lain.npk',
      ),
      scriptFile('mikrotik/bebas.rsc', '/import file-name=/temp/AC.cfg'),
      routerFile('mikrotik/AC.cfg'),
      routerFile('mikrotik/yatim.npk'),
    ];
    const used = routerUsedBy(files, [
      FIRMWARE,
      { brand: 'mikrotik', code: 'AD', scriptPath: 'MIKROTIK/ad.rsc', parallel: false },
      { brand: 'ubiquiti', code: 'XM', scriptPath: null, parallel: false },
    ]);
    expect(used.get('mikrotik/AC.cfg')).toEqual(['AC', 'AD']);
    expect(used.get('mikrotik/yatim.npk')).toEqual([]);
    expect(used.has('mikrotik/AC.rsc')).toBe(false);
  });
});
