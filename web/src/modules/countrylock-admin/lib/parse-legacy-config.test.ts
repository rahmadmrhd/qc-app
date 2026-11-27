import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSettingsFile } from '@shared/countrylock-bundle';
import { describe, expect, test } from 'vitest';
import { parseLegacyConfig } from './parse-legacy-config';

const FIXTURE = join(__dirname, '../../../../../countrylock/fixtures/country-lock2');
const configText = readFileSync(join(FIXTURE, 'config.QC'), 'utf-8');

/** Semua skrip fixture sebagai berkas terpilih (hanya nama berkas, seperti pilihan berkas di peramban). */
function fixtureScripts() {
  const files: { path: string; text: string }[] = [];
  for (const folder of ['MIKROTIK', 'UBIQUITI']) {
    for (const name of readdirSync(join(FIXTURE, folder))) {
      files.push({ path: name, text: readFileSync(join(FIXTURE, folder, name), 'utf-8') });
    }
  }
  return files;
}

describe('parseLegacyConfig dengan config.QC contoh', () => {
  const result = parseLegacyConfig(configText, fixtureScripts());

  test('menghasilkan 17 firmware (8 Mikrotik + 9 Ubiquiti) dengan jalur skrip folder/berkas', () => {
    expect(result.request).not.toBeNull();
    const firmwares = result.request?.firmwares ?? [];
    expect(firmwares).toHaveLength(17);
    expect(firmwares.filter((firmware) => firmware.brand === 'mikrotik')).toHaveLength(8);
    expect(firmwares.filter((firmware) => firmware.brand === 'ubiquiti')).toHaveLength(9);
    expect(firmwares.find((firmware) => firmware.code === 'AC')).toEqual({
      brand: 'mikrotik',
      code: 'AC',
      label: 'AC',
      scriptPath: 'MIKROTIK/mikrotik-ac.txt',
    });
    expect(firmwares.find((firmware) => firmware.code === 'af5xhd')).toMatchObject({
      brand: 'ubiquiti',
      scriptPath: 'UBIQUITI/AF5XHD.txt',
    });
  });

  test('skrip diberi jalur folder/berkas dan merk dari firmware yang merujuknya', () => {
    const scripts = result.request?.scripts ?? [];
    expect(scripts).toHaveLength(17);
    const ac = scripts.find((script) => script.path === 'MIKROTIK/mikrotik-ac.txt');
    expect(ac?.brand).toBe('mikrotik');
    expect(ac?.text.length).toBeGreaterThan(0);
    expect(scripts.find((script) => script.path === 'UBIQUITI/XM.txt')?.brand).toBe('ubiquiti');
  });

  test('pengaturan hasil pemetaan lolos validasi settings.json skema 1', () => {
    const settings = result.request?.settings;
    expect(settings).toBeDefined();
    const parsed = parseSettingsFile(JSON.stringify(settings));
    expect(parsed.ok).toBe(true);
    expect(settings?.router).toMatchObject({
      ip: '192.168.88.2',
      username: 'admin',
      interfaceBridge: 'BridgeAll',
    });
    expect(settings?.brands.mikrotik.modes.single).toMatchObject({
      ip: '192.168.88.1',
      connectVia: 'Server',
      interfaceBridge: 'BridgeAll',
    });
    expect(settings?.brands.ubiquiti.modes.single).toMatchObject({
      ip: '192.168.88.50',
      ipServer: '192.168.1.1',
      connectVia: 'Target',
    });
    // Mode Multi tidak punya IP target.
    expect(settings?.brands.ubiquiti.modes.multi.ip).toBe('');
  });

  test('IP komputer tidak ada di config.QC: diisi bawaan satu segmen dengan router dan dilaporkan', () => {
    expect(result.request?.settings.network).toEqual({
      computerIp: '192.168.88.3',
      prefixLength: 24,
    });
    expect(result.problems.some((problem) => /IP komputer/.test(problem))).toBe(true);
  });

  test('peringatan informasi (sshKeys diabaikan) bukan masalah', () => {
    expect(result.problems.some((problem) => /sshKeys/.test(problem))).toBe(false);
    expect(result.notes.some((note) => /sshKeys/.test(note))).toBe(true);
  });
});

describe('parseLegacyConfig: kasus bermasalah', () => {
  test('skrip yang dirujuk firmware tetapi tidak dipilih: firmware tanpa skrip dan masalah dilaporkan', () => {
    const files = fixtureScripts().filter((file) => file.path !== 'mikrotik-ac.txt');
    const result = parseLegacyConfig(configText, files);
    expect(
      result.request?.firmwares.find((firmware) => firmware.code === 'AC')?.scriptPath,
    ).toBeNull();
    expect(result.request?.scripts).toHaveLength(16);
    expect(result.problems.some((problem) => /mikrotik-ac\.txt/.test(problem))).toBe(true);
  });

  test('berkas terpilih yang tak dirujuk firmware mana pun dilewati dan dilaporkan', () => {
    const files = [...fixtureScripts(), { path: 'catatan.txt', text: 'x' }];
    const result = parseLegacyConfig(configText, files);
    expect(result.request?.scripts.some((script) => script.path.endsWith('catatan.txt'))).toBe(
      false,
    );
    expect(result.problems.some((problem) => /catatan\.txt/.test(problem))).toBe(true);
  });

  test('pencocokan nama berkas tak peka huruf besar/kecil', () => {
    const files = fixtureScripts().map((file) =>
      file.path === 'XM.txt' ? { ...file, path: 'xm.TXT' } : file,
    );
    const result = parseLegacyConfig(configText, files);
    expect(result.request?.scripts.some((script) => script.path === 'UBIQUITI/XM.txt')).toBe(true);
  });

  test('JSON rusak: tidak ada permintaan dan masalah menjelaskan', () => {
    const result = parseLegacyConfig('{ "server": ', []);
    expect(result.request).toBeNull();
    expect(result.problems[0]).toMatch(/config\.QC/);
  });

  test('server.ip kosong: tidak ada permintaan', () => {
    const result = parseLegacyConfig(JSON.stringify({ mikrotik: {}, server: { ip: '' } }), []);
    expect(result.request).toBeNull();
    expect(result.problems[0]).toMatch(/server\.ip/);
  });

  test('")" nyasar di luar string: dibersihkan, dilaporkan, dan impor tetap dapat jalan', () => {
    const broken = configText.replace('"version": 5', '"version": 5)');
    const result = parseLegacyConfig(broken, fixtureScripts());
    expect(result.request).not.toBeNull();
    expect(result.problems.some((problem) => /nyasar/.test(problem))).toBe(true);
    expect(result.request?.firmwares).toHaveLength(17);
  });

  test('")" di dalam nilai string (kunci SSH contoh) tidak dianggap nyasar', () => {
    const result = parseLegacyConfig(configText, fixtureScripts());
    expect(result.problems.some((problem) => /nyasar/.test(problem))).toBe(false);
  });

  test('config tanpa node merk memetakan hanya merk yang ada', () => {
    const only = JSON.stringify({
      server: { ip: '10.0.0.2', interfaceBridge: 'br' },
      mikrotik: { folder: 'M', firmware: { A: { label: 'A', file: 'a.txt' } } },
    });
    const result = parseLegacyConfig(only, [{ path: 'a.txt', text: '# x' }]);
    expect(result.request?.firmwares).toEqual([
      { brand: 'mikrotik', code: 'A', label: 'A', scriptPath: 'M/a.txt' },
    ]);
    // Merk Ubiquiti tidak ada di config: pengaturannya diisi bawaan agar dokumen tetap sah.
    expect(parseSettingsFile(JSON.stringify(result.request?.settings)).ok).toBe(true);
    expect(result.request?.settings.network.computerIp).toBe('10.0.0.3');
  });
});

describe('berkas kembar antar folder', () => {
  test('nama sama dengan isi berbeda: dilaporkan, firmware yang merujuknya tanpa skrip (tidak saling menimpa diam-diam)', () => {
    const files = [
      ...fixtureScripts(),
      { path: 'mikrotik-ac.txt', text: '# versi lain dari folder lain' },
    ];
    const result = parseLegacyConfig(configText, files);
    expect(
      result.problems.some(
        (problem) => /mikrotik-ac\.txt/.test(problem) && /lebih dari satu/.test(problem),
      ),
    ).toBe(true);
    const ac = result.request?.firmwares.find((firmware) => firmware.code === 'AC');
    expect(ac?.scriptPath).toBeNull();
    expect(
      result.request?.scripts.some((script) => script.path === 'MIKROTIK/mikrotik-ac.txt'),
    ).toBe(false);
  });

  test('nama sama dengan isi persis sama (dipilih dua kali): digabung tanpa masalah', () => {
    const scripts = fixtureScripts();
    const ac = scripts.find((file) => file.path === 'mikrotik-ac.txt');
    const result = parseLegacyConfig(configText, [
      ...scripts,
      { path: 'mikrotik-ac.txt', text: ac?.text ?? '' },
    ]);
    expect(result.problems.some((problem) => /lebih dari satu/.test(problem))).toBe(false);
    expect(result.request?.firmwares.find((firmware) => firmware.code === 'AC')?.scriptPath).toBe(
      'MIKROTIK/mikrotik-ac.txt',
    );
  });
});
