import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { legacyRender } from '../test-support/legacy-oracle';
import {
  type Brand,
  PLACEHOLDERS,
  renderScript,
  ScriptRenderError,
  type ScriptValues,
} from './script-template';

const FIXTURE_DIR = join(import.meta.dir, '..', 'fixtures', 'country-lock2');

const SAFE_VALUES: ScriptValues = {
  ipTarget: '192.168.88.1',
  usernameTarget: 'admin',
  passwordTarget: 'pw123',
  ipServer: '192.168.1.1',
  usernameServer: 'admin',
  passwordServer: 'srvpw',
  sshKey: 'AAAAB3Nza+/=',
};

function fixtures(): { brand: Brand; name: string; raw: string }[] {
  const out: { brand: Brand; name: string; raw: string }[] = [];
  for (const [folder, brand] of [
    ['MIKROTIK', 'mikrotik'],
    ['UBIQUITI', 'ubiquiti'],
  ] as const) {
    for (const name of readdirSync(join(FIXTURE_DIR, folder)).sort()) {
      out.push({ brand, name, raw: readFileSync(join(FIXTURE_DIR, folder, name), 'utf8') });
    }
  }
  return out;
}

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('renderScript', () => {
  test('paritas emas: 17 skrip nyata dirender sama dengan oracle lama untuk nilai aman', () => {
    const all = fixtures();
    expect(all.length).toBe(17);
    for (const { brand, name, raw } of all) {
      const rendered = renderScript(raw, SAFE_VALUES, brand);
      expect(rendered, name).toBe(legacyRender(raw, SAFE_VALUES));
      // Semua placeholder yang dikenal habis terisi.
      for (const key of PLACEHOLDERS) expect(rendered, name).not.toContain(`{${key}}`);
    }
  });

  test('mikrotik: nilai berisi " $ dan ? di dalam kutip di-escape', () => {
    const out = renderScript(
      'user="{usernameTarget}" password="{passwordTarget}"',
      { usernameTarget: 'admin', passwordTarget: 'a"b$c?d\\e' },
      'mikrotik',
    );
    expect(out).toBe('user="admin" password="a\\"b\\$c\\?d\\\\e"');
  });

  test('mikrotik: nilai tak aman tanpa kutip melempar UNSAFE_BARE_VALUE', () => {
    const error = catchError(() =>
      renderScript('user={usernameTarget}', { usernameTarget: 'a b' }, 'mikrotik'),
    );
    expect(error).toBeInstanceOf(ScriptRenderError);
    expect((error as ScriptRenderError).code).toBe('UNSAFE_BARE_VALUE');
  });

  test('mikrotik: nilai aman tanpa kutip disisipkan apa adanya', () => {
    expect(renderScript('user={usernameTarget}', { usernameTarget: 'ad.min-1' }, 'mikrotik')).toBe(
      'user=ad.min-1',
    );
  });

  test('ubiquiti: nilai aman tak berubah, nilai tak aman tanpa kutip dibungkus kutip tunggal', () => {
    const raw = 'scp {usernameServer}@{ipServer}:/temp/x /tmp/';
    expect(
      renderScript(raw, { usernameServer: 'admin', ipServer: '192.168.1.1' }, 'ubiquiti'),
    ).toBe('scp admin@192.168.1.1:/temp/x /tmp/');
    expect(
      renderScript(
        '{usernameServer}@{ipServer}',
        { usernameServer: 'a b', ipServer: '192.168.1.1' },
        'ubiquiti',
      ),
    ).toBe("'a b'@192.168.1.1");
    // Tanda kutip tunggal di dalam nilai: ' -> '\''
    expect(renderScript('x {passwordServer}', { passwordServer: "it's $HOME" }, 'ubiquiti')).toBe(
      "x 'it'\\''s $HOME'",
    );
  });

  test('ubiquiti: di dalam kutip ganda meng-escape \\ " $ dan `', () => {
    expect(
      renderScript('echo "{passwordServer}"', { passwordServer: 'a"b$c`d\\e f' }, 'ubiquiti'),
    ).toBe('echo "a\\"b\\$c\\`d\\\\e f"');
  });

  test('ubiquiti: di dalam kutip tunggal hanya kutip tunggal yang di-escape', () => {
    expect(renderScript("echo '{passwordServer}'", { passwordServer: "a'b $c" }, 'ubiquiti')).toBe(
      "echo 'a'\\''b $c'",
    );
  });

  test('placeholder tak dikenal dibiarkan, nilai undefined menjadi string kosong', () => {
    expect(renderScript('a {tidakAda} b {ipTarget} c {sshKey}', {}, 'mikrotik')).toBe(
      'a {tidakAda} b  c ',
    );
    expect(renderScript('a {tidakAda} b {ipTarget} c {sshKey}', {}, 'ubiquiti')).toBe(
      'a {tidakAda} b  c ',
    );
  });

  test('skrip kosong dikembalikan apa adanya', () => {
    expect(renderScript('', SAFE_VALUES, 'mikrotik')).toBe('');
  });

  test('kurung kurawal di nilai tidak diperluas ulang (satu putaran, bukan replace berurutan)', () => {
    const out = renderScript(
      'a="{passwordTarget}" b="{ipServer}"',
      { passwordTarget: '{ipServer}', ipServer: '1.2.3.4' },
      'mikrotik',
    );
    expect(out).toBe('a="{ipServer}" b="1.2.3.4"');
  });

  test('keadaan kutip dilacak per baris: kutip tak tertutup tidak menular ke baris berikut', () => {
    expect(
      renderScript(
        'echo "tak tertutup\nuser={usernameTarget}',
        { usernameTarget: 'ok' },
        'mikrotik',
      ),
    ).toBe('echo "tak tertutup\nuser=ok');
    const error = catchError(() =>
      renderScript(
        'echo "tak tertutup\nuser={usernameTarget}',
        { usernameTarget: 'a b' },
        'mikrotik',
      ),
    );
    expect((error as ScriptRenderError).code).toBe('UNSAFE_BARE_VALUE');
  });

  test('backslash melepas kutip: \\" tidak membuka/menutup kutip', () => {
    // Kutip dibuka, \" dilepas, lalu kutip penutup; placeholder sesudahnya di luar kutip.
    const error = catchError(() =>
      renderScript('x="a\\"b" y={usernameTarget}', { usernameTarget: 'a b' }, 'mikrotik'),
    );
    expect((error as ScriptRenderError).code).toBe('UNSAFE_BARE_VALUE');
    expect(renderScript('x="a\\" {usernameTarget}"', { usernameTarget: 'a b' }, 'mikrotik')).toBe(
      'x="a\\" a b"',
    );
  });

  test('nilai berisi baris baru atau karakter kontrol ditolak (mencegah suntikan perintah)', () => {
    for (const brand of ['mikrotik', 'ubiquiti'] as const) {
      for (const bad of ['a\nb', 'a\rb', 'a\u0000b', 'a\u001bb']) {
        const error = catchError(() =>
          renderScript('p="{passwordTarget}"', { passwordTarget: bad }, brand),
        );
        expect(error).toBeInstanceOf(ScriptRenderError);
        expect((error as ScriptRenderError).code).toBe('CONTROL_CHARACTER');
      }
    }
  });
});
