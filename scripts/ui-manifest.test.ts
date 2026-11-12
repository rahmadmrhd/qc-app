import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  isSafeUiPath,
  parseUiManifest,
  signUiManifest,
  UI_MIN_BRIDGE_VERSION,
  verifyUiManifest,
} from '../countrylock/src/ui-manifest';
import { buildUiManifest, writeUiManifest } from './build-ui-manifest';
import { generateSigningKey } from './gen-ui-signing-key';
import { signDistManifest } from './sign-ui-manifest';

let root: string;
let dist: string;

function put(relative: string, content: string | Uint8Array): void {
  const full = path.join(dist, relative);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

async function sha256Hex(bytes: Uint8Array | string): Promise<string> {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

const OPTIONS = { minBridge: 2, now: 1_700_000_000_000 };

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'qc-ui-manifest-'));
  dist = path.join(root, 'dist');
  mkdirSync(dist);
  put('index.html', '<html><script type="module" src="/assets/app-abc.js"></script></html>');
  put('assets/app-abc.js', 'console.log("halo");');
  put('assets/style-def.css', 'body{color:red}');
  put('favicon.svg', new Uint8Array([0, 1, 2, 255, 254]));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('buildUiManifest', () => {
  test('manifest memuat semua berkas dengan sha256 dan ukuran benar, tanpa dirinya sendiri', async () => {
    put('ui-manifest.json', '{"lama":true}');
    put('ui-manifest.sig', 'tanda-tangan-lama');
    const manifest = buildUiManifest(dist, OPTIONS);
    expect(manifest.files.map((file) => file.path)).toEqual([
      'assets/app-abc.js',
      'assets/style-def.css',
      'favicon.svg',
      'index.html',
    ]);
    for (const file of manifest.files) {
      const bytes = readFileSync(path.join(dist, file.path));
      expect(file.size).toBe(bytes.byteLength);
      expect(file.sha256).toBe(await sha256Hex(bytes));
    }
    expect(manifest.minBridge).toBe(2);
    expect(manifest.createdAt).toBe(OPTIONS.now);
    expect(manifest.uiVersion).toMatch(/^[0-9a-f]{64}$/);
    expect(UI_MIN_BRIDGE_VERSION).toBeGreaterThanOrEqual(1);
  });

  test('uiVersion berubah bila satu berkas berubah, stabil bila tidak', () => {
    const first = buildUiManifest(dist, OPTIONS);
    const again = buildUiManifest(dist, { minBridge: 2, now: OPTIONS.now + 5000 });
    expect(again.uiVersion).toBe(first.uiVersion);
    put('assets/app-abc.js', 'console.log("halo!");');
    expect(buildUiManifest(dist, OPTIONS).uiVersion).not.toBe(first.uiVersion);
    put('assets/app-abc.js', 'console.log("halo");');
    expect(buildUiManifest(dist, OPTIONS).uiVersion).toBe(first.uiVersion);
    // berkas baru juga mengubah versi
    put('baru.txt', 'x');
    expect(buildUiManifest(dist, OPTIONS).uiVersion).not.toBe(first.uiVersion);
  });

  test('jalur memakai / tanpa awalan slash dan manifest hasil bangun lolos parseUiManifest', () => {
    const manifest = buildUiManifest(dist, OPTIONS);
    for (const file of manifest.files) {
      expect(file.path.startsWith('/')).toBe(false);
      expect(file.path.includes('\\')).toBe(false);
    }
    expect(parseUiManifest(JSON.stringify(manifest))).toEqual(manifest);
  });

  test('folder kosong atau tak ada ditolak', () => {
    expect(() => buildUiManifest(path.join(root, 'tidak-ada'), OPTIONS)).toThrow();
    const empty = path.join(root, 'kosong');
    mkdirSync(empty);
    expect(() => buildUiManifest(empty, OPTIONS)).toThrow();
  });

  test('symlink (termasuk yang menunjuk ke luar dist) ditolak', () => {
    const outside = path.join(root, 'rahasia.txt');
    writeFileSync(outside, 'rahasia');
    try {
      symlinkSync(outside, path.join(dist, 'tautan.txt'));
    } catch {
      return; // tanpa hak membuat symlink (Windows biasa): tidak dapat diuji di sini
    }
    expect(() => buildUiManifest(dist, OPTIONS)).toThrow(/symlink/i);
  });
});

describe('tanda tangan Ed25519', () => {
  test('tanda tangan valid lolos verifikasi, satu bit berbeda gagal', () => {
    const { privatePem, publicPem } = keyPair();
    const json = JSON.stringify(buildUiManifest(dist, OPTIONS));
    const signature = signUiManifest(json, privatePem);
    expect(signature).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(verifyUiManifest(json, signature, publicPem)).toBe(true);

    // satu bit isi manifest berbeda
    const bytes = Buffer.from(json, 'utf8');
    bytes[10] = (bytes[10] as number) ^ 0x01;
    expect(verifyUiManifest(bytes.toString('utf8'), signature, publicPem)).toBe(false);
    // satu bit tanda tangan berbeda
    const sig = Buffer.from(signature, 'base64url');
    sig[0] = (sig[0] as number) ^ 0x01;
    expect(verifyUiManifest(json, sig.toString('base64url'), publicPem)).toBe(false);
    // kunci lain
    expect(verifyUiManifest(json, signature, keyPair().publicPem)).toBe(false);
  });

  test('masukan rusak ditolak tanpa melempar', () => {
    const { privatePem, publicPem } = keyPair();
    const json = '{"a":1}';
    const signature = signUiManifest(json, privatePem);
    for (const bad of ['', 'pendek', `${signature}=`, `${signature}A`, '!'.repeat(86)]) {
      expect(verifyUiManifest(json, bad, publicPem)).toBe(false);
    }
    expect(verifyUiManifest(json, signature, 'bukan pem')).toBe(false);
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(
      verifyUiManifest(
        json,
        signature,
        rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      ),
    ).toBe(false);
    expect(() =>
      signUiManifest(json, rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()),
    ).toThrow();
  });
});

describe('parseUiManifest dan isSafeUiPath', () => {
  const good = () => JSON.parse(JSON.stringify(buildUiManifest(dist, OPTIONS)));

  test('jalur berbahaya ditolak', () => {
    for (const bad of ['../x', 'a/../x', '/abs', 'a//b', './a', 'a\\b', '', 'a/', 'a\0b']) {
      expect(isSafeUiPath(bad)).toBe(false);
    }
    expect(isSafeUiPath('assets/app-abc.js')).toBe(true);
    for (const bad of ['../x', 'a/../x', '/abs', 'a\\b']) {
      const manifest = good();
      manifest.files[0].path = bad;
      expect(parseUiManifest(JSON.stringify(manifest))).toBeNull();
    }
  });

  test('hash, ukuran, urutan, duplikat, dan versi jembatan tak sah ditolak', () => {
    const mutations: ((manifest: ReturnType<typeof good>) => void)[] = [
      (m) => {
        m.files[0].sha256 = 'ZZ';
      },
      (m) => {
        m.files[0].size = -1;
      },
      (m) => {
        m.files[0].size = 1.5;
      },
      (m) => {
        m.files.reverse();
      },
      (m) => {
        m.files.push({ ...m.files[m.files.length - 1] });
      },
      (m) => {
        m.minBridge = 0;
      },
      (m) => {
        m.minBridge = '2';
      },
      (m) => {
        m.uiVersion = 'abc';
      },
      (m) => {
        m.files = [];
      },
    ];
    for (const mutate of mutations) {
      const manifest = good();
      mutate(manifest);
      expect(parseUiManifest(JSON.stringify(manifest))).toBeNull();
    }
    expect(parseUiManifest('bukan json')).toBeNull();
    expect(parseUiManifest('null')).toBeNull();
  });
});

describe('writeUiManifest dan signDistManifest', () => {
  test('menulis ui-manifest.json kanonik dan membuang .sig lama (tanda tangan basi)', () => {
    put('ui-manifest.sig', 'basi');
    const manifest = writeUiManifest(dist, OPTIONS);
    const written = readFileSync(path.join(dist, 'ui-manifest.json'), 'utf8');
    expect(written).toBe(JSON.stringify(manifest));
    expect(() => statSync(path.join(dist, 'ui-manifest.sig'))).toThrow();
    // dijalankan ulang: berkas manifest sendiri tidak masuk daftar
    const again = writeUiManifest(dist, OPTIONS);
    expect(again.files.some((file) => file.path.startsWith('ui-manifest'))).toBe(false);
    expect(again.uiVersion).toBe(manifest.uiVersion);
  });

  test('signDistManifest menulis .sig yang lolos verifikasi atas byte persis ui-manifest.json', () => {
    writeUiManifest(dist, OPTIONS);
    const { privatePem, publicPem } = keyPair();
    const keyFile = path.join(root, 'k.ui-signing-key.pem');
    writeFileSync(keyFile, privatePem);
    const signature = signDistManifest(dist, keyFile);
    const json = readFileSync(path.join(dist, 'ui-manifest.json'), 'utf8');
    expect(readFileSync(path.join(dist, 'ui-manifest.sig'), 'utf8')).toBe(signature);
    expect(verifyUiManifest(json, signature, publicPem)).toBe(true);
  });

  test('signDistManifest gagal tanpa manifest atau tanpa kunci dan tak membocorkan isi kunci', () => {
    const keyFile = path.join(root, 'k.ui-signing-key.pem');
    writeFileSync(keyFile, keyPair().privatePem);
    expect(() => signDistManifest(dist, keyFile)).toThrow(/ui-manifest\.json/);
    writeUiManifest(dist, OPTIONS);
    expect(() => signDistManifest(dist, path.join(root, 'tidak-ada.pem'))).toThrow();
    writeFileSync(keyFile, 'bukan kunci -----BEGIN RAHASIA-----');
    try {
      signDistManifest(dist, keyFile);
      throw new Error('seharusnya gagal');
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('RAHASIA');
    }
    expect(() => statSync(path.join(dist, 'ui-manifest.sig'))).toThrow();
  });
});

describe('generateSigningKey', () => {
  test('menulis kunci privat dan publik, tidak menimpa, dan menolak nama berkas yang tidak diabaikan git', () => {
    const out = path.join(root, 'rilis.ui-signing-key.pem');
    const result = generateSigningKey(out);
    const privatePem = readFileSync(out, 'utf8');
    expect(privatePem).toContain('BEGIN PRIVATE KEY');
    expect(result.publicKeyPem).toContain('BEGIN PUBLIC KEY');
    expect(result.publicKeyPath).toBe(path.join(root, 'rilis.ui-signing-key.pub.pem'));
    expect(readFileSync(result.publicKeyPath, 'utf8')).toBe(result.publicKeyPem);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    // pasangan cocok
    const signature = signUiManifest('{"x":1}', privatePem);
    expect(verifyUiManifest('{"x":1}', signature, result.publicKeyPem)).toBe(true);
    // tidak menimpa
    expect(() => generateSigningKey(out)).toThrow();
    expect(readFileSync(out, 'utf8')).toBe(privatePem);
    // nama berkas harus sesuai pola .gitignore
    expect(() => generateSigningKey(path.join(root, 'kunci.pem'))).toThrow(/ui-signing-key\.pem/);
  });

  test('pola kunci penandatangan ada di .gitignore dan .dockerignore menyingkirkan *.pem', () => {
    const gitignore = readFileSync(path.join(import.meta.dir, '..', '.gitignore'), 'utf8');
    expect(gitignore.split('\n').map((line) => line.trim())).toContain('*.ui-signing-key.pem');
    const dockerignore = readFileSync(path.join(import.meta.dir, '..', '.dockerignore'), 'utf8');
    expect(dockerignore.split('\n').map((line) => line.trim())).toContain('**/*.pem');
  });
});

describe('integrasi build', () => {
  test('skrip build akar memanggil build-ui-manifest SESUDAH verify-dist', () => {
    const pkg = JSON.parse(readFileSync(path.join(import.meta.dir, '..', 'package.json'), 'utf8'));
    const build = pkg.scripts.build as string;
    expect(build.indexOf('verify-dist.ts')).toBeGreaterThan(-1);
    expect(build.indexOf('build-ui-manifest.ts')).toBeGreaterThan(build.indexOf('verify-dist.ts'));
  });

  test('Dockerfile: semua workspace akar disalin manifestnya sebelum install, dan desktop (Electron) tak dipasang', () => {
    const root = path.join(import.meta.dir, '..');
    const dockerfile = readFileSync(path.join(root, 'Dockerfile'), 'utf8');
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    for (const workspace of pkg.workspaces as string[]) {
      expect(dockerfile).toContain(`COPY ${workspace}/package.json ${workspace}/`);
    }
    const manifestsEnd = dockerfile.indexOf('FROM manifests AS web-build');
    expect(dockerfile.indexOf('COPY desktop/package.json')).toBeLessThan(manifestsEnd);
    expect(dockerfile).toMatch(/^RUN bun install --frozen-lockfile --filter '!@qc\/desktop'\s*$/m);
    // sumber desktop tak pernah disalin ke image
    expect(dockerfile).not.toMatch(/^COPY desktop (desktop|\.)/m);
  });

  test('Dockerfile: tanda tangan hanya lewat secret BuildKit opsional, tanpa kunci di ARG/ENV', () => {
    const dockerfile = readFileSync(path.join(import.meta.dir, '..', 'Dockerfile'), 'utf8');
    expect(dockerfile).toContain('--mount=type=secret,id=ui_signing_key,required=false');
    expect(dockerfile).toContain('/run/secrets/ui_signing_key');
    expect(dockerfile).toContain('COPY countrylock countrylock');
    expect(dockerfile).not.toMatch(/^(ENV|ARG)\s+\w*(SIGNING|PRIVATE)\w*/im);
    // langkah tanda tangan sesudah build web (manifest harus ada dulu)
    expect(dockerfile.indexOf('sign-ui-manifest.ts')).toBeGreaterThan(
      dockerfile.indexOf('RUN bun run build'),
    );
  });
});
