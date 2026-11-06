// biome-ignore-all lint/suspicious/noTemplateCurlyInString: payload jahat (`${HOME}`) sengaja ditulis literal
// Tes `deploy/deploy.sh` tanpa Docker dan tanpa VPS: skrip dijalankan dengan `docker` dan `curl` PALSU di PATH
// (mencatat panggilan dan meniru keadaan) pada folder sementara. Menguji validasi ketat SSH_ORIGINAL_COMMAND
// (input jahat tidak boleh sampai ke docker maupun berkas), pemulihan ke tag sebelumnya, kunci, dan pembatasan --only.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Tiap tes memulai proses bash (lambat di Windows); rollback menjalankan beberapa subproses.
setDefaultTimeout(30_000);

const SCRIPT = join(import.meta.dir, '..', '..', 'deploy', 'deploy.sh').replaceAll('\\', '/');
const posix = (path: string) => path.replaceAll('\\', '/');

let base: string;
let bin: string;
let root: string;
let state: string;
let log: string;

const FAKE_DOCKER = `#!/bin/sh
# docker palsu: mencatat argumen; meniru compose pull/up dan inspect berdasarkan berkas keadaan.
echo "docker $*" >> "$FAKE_LOG"
case "$*" in
  *" pull "*) [ -f "$FAKE_STATE/pull_fail" ] && exit 1; exit 0 ;;
  *" up "*)
    [ -f "$FAKE_STATE/up_fail" ] && exit 1
    sed -n 's/^QC_IMAGE_TAG=//p' "$FAKE_ENV" > "$FAKE_STATE/running"
    exit 0 ;;
  inspect*)
    tag=$(cat "$FAKE_STATE/running" 2>/dev/null)
    case "$*" in
      *Config.Image*) echo "ghcr.io/x/qc-app:$tag" ;;
      *) if grep -qx "$tag" "$FAKE_STATE/unhealthy_tags" 2>/dev/null; then echo unhealthy; else echo healthy; fi ;;
    esac
    exit 0 ;;
esac
exit 0
`;

const FAKE_CURL = `#!/bin/sh
echo "curl $*" >> "$FAKE_LOG"
tag=$(cat "$FAKE_STATE/running" 2>/dev/null)
if grep -qx "$tag" "$FAKE_STATE/ping_fail_tags" 2>/dev/null; then exit 22; fi
exit 0
`;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'qc-deploy-test-'));
  bin = join(base, 'bin');
  mkdirSync(bin);
  for (const [name, body] of [
    ['docker', FAKE_DOCKER],
    ['curl', FAKE_CURL],
  ] as const) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

function envFile(extra = '', tag: string | null = 'tag-lama'): string {
  return `QC_ENV=dev\nAPP_PORT=8790\nMARIADB_ROOT_PASSWORD=rahasia-uji\n${tag === null ? '' : `QC_IMAGE_TAG=${tag}\n`}${extra}`;
}

beforeEach(() => {
  root = join(base, `root-${crypto.randomUUID().slice(0, 8)}`);
  state = join(root, '_state');
  log = join(root, '_calls.log');
  mkdirSync(join(root, 'dev'), { recursive: true });
  mkdirSync(join(root, 'exec'), { recursive: true });
  mkdirSync(state);
  writeFileSync(log, '');
  for (const name of ['dev', 'exec']) {
    writeFileSync(join(root, name, 'compose.yml'), 'services: {}\n');
    writeFileSync(
      join(root, name, '.env'),
      envFile()
        .replace('QC_ENV=dev', `QC_ENV=${name}`)
        .replace('8790', name === 'dev' ? '8790' : '8791'),
    );
  }
  writeFileSync(join(state, 'running'), 'tag-lama\n');
});

interface Run {
  code: number;
  out: string;
}

async function run(
  request: string | undefined,
  args: string[] = [],
  extraEnv: Record<string, string> = {},
): Promise<Run> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'SSH_ORIGINAL_COMMAND') env[key] = value;
  }
  env.PATH = `${posix(bin)}${process.platform === 'win32' ? ';' : ':'}${env.PATH ?? ''}`;
  env.FAKE_LOG = posix(log);
  env.FAKE_STATE = posix(state);
  env.FAKE_ENV = posix(join(root, 'dev', '.env'));
  if (request !== undefined) env.SSH_ORIGINAL_COMMAND = request;
  Object.assign(env, extraEnv);
  const proc = Bun.spawn(
    ['bash', SCRIPT, '--root', posix(root), '--wait-seconds', '2', '--poll-seconds', '0', ...args],
    { env, stdout: 'pipe', stderr: 'pipe' },
  );
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, out: stdout + stderr };
}

const calls = () => readFileSync(log, 'utf8');
const tagIn = (name: 'dev' | 'exec') =>
  /^QC_IMAGE_TAG=(.*)$/m.exec(readFileSync(join(root, name, '.env'), 'utf8'))?.[1];

describe('deploy.sh: validasi input (tidak ada yang berjalan)', () => {
  const MALICIOUS: Array<[string, string | undefined]> = [
    ['perintah tak diset', undefined],
    ['perintah kosong', ''],
    ['bukan perintah deploy', 'bash -c id'],
    ['lingkungan tak dikenal', 'deploy prod abc123'],
    ['lingkungan kapital', 'deploy DEV abc123'],
    ['kata kerja kapital', 'DEPLOY dev abc123'],
    ['tanpa tag', 'deploy dev'],
    ['tag kosong (spasi ekor)', 'deploy dev '],
    ['spasi ganda', 'deploy  dev abc123'],
    ['argumen berlebih', 'deploy dev abc123 extra'],
    ['titik koma', 'deploy dev abc;rm -rf /'],
    ['substitusi $()', 'deploy dev $(id)'],
    ['backtick', 'deploy dev `id`'],
    ['ekspansi ${}', 'deploy dev ${HOME}'],
    ['variabel IFS', 'deploy dev a$IFS$9b'],
    ['pipe', 'deploy dev a|b'],
    ['ampersand', 'deploy dev a&&id'],
    ['pengalihan', 'deploy dev a>/tmp/x'],
    ['kutip tunggal', "deploy dev a'b"],
    ['kutip ganda', 'deploy dev a"b'],
    ['garis miring (path)', 'deploy dev ../../etc/passwd'],
    ['backslash', 'deploy dev a\\b'],
    ['newline di tengah', 'deploy dev abc\nrm -rf /'],
    ['newline di ujung', 'deploy dev abc\n'],
    ['carriage return', 'deploy dev abc\r'],
    ['spasi tak-pecah (NBSP)', 'deploy dev abc def'],
    ['tag diawali minus', 'deploy dev -rf'],
    ['tag diawali titik', 'deploy dev .hidden'],
    ['tag 65 karakter', `deploy dev ${'a'.repeat(65)}`],
    ['perintah sangat panjang', `deploy dev ${'a'.repeat(500)}`],
    ['lingkungan dengan lebih dari satu nama', 'deploy dev,exec abc123'],
  ];

  for (const [label, request] of MALICIOUS) {
    test(`ditolak (kode 2), tanpa docker/curl, tanpa menyentuh .env, tanpa mencetak input: ${label}`, async () => {
      const before = readFileSync(join(root, 'dev', '.env'), 'utf8');
      const result = await run(request);
      expect(result.code).toBe(2);
      expect(calls()).toBe('');
      expect(readFileSync(join(root, 'dev', '.env'), 'utf8')).toBe(before);
      expect(existsSync(join(root, 'dev', '.deploy.lock'))).toBe(false);
      // input tak pernah digaungkan (tanpa injeksi log)
      for (const fragment of ['rm -rf', '$(id)', '`id`', 'passwd', 'bash -c', 'abc123']) {
        expect(result.out).not.toContain(fragment);
      }
    }, 20_000);
  }

  test('setiap metakarakter shell/aneh SENDIRIAN di dalam tag menolak perintah (tanpa efek)', async () => {
    const chars = ['\\', ';', '$', '`', '|', '&', '>', '<', '(', ')', '*', '?', '!', '#', '~'];
    chars.push('{', '}', '[', ']', '=', ':', ',', '%', '@', '+', '^', "'", '"', ' ', '\t', '/');
    for (const char of chars) {
      const result = await run(`deploy dev ab${char}cd`, ['--dry-run']);
      expect(result.code, `karakter ${JSON.stringify(char)}`).toBe(2);
    }
    expect(calls()).toBe('');
  });

  test('format sah diterima: tag dengan titik, minus, garis bawah, angka, dan 64 karakter', async () => {
    for (const tag of ['sha-0123abcd', 'v1.2.3_rc-1', '0123456789abcdef', 'A'.repeat(64), '_x']) {
      const result = await run(`deploy dev ${tag}`, ['--dry-run']);
      expect(result.code).toBe(0);
      expect(result.out).toContain(`tag=${tag}`);
    }
    expect(calls()).toBe('');
  });

  test('argumen skrip tak dikenal / --only salah ditolak', async () => {
    expect((await run('deploy dev abc', ['--aneh'])).code).toBe(2);
    expect((await run('deploy dev abc', ['--only', 'prod'])).code).toBe(2);
    expect((await run('deploy dev abc', ['--wait-seconds', 'x'])).code).toBe(2);
    expect(calls()).toBe('');
  });

  test('--only membatasi lingkungan: kunci dev tidak boleh men-deploy exec dan sebaliknya', async () => {
    const wrong = await run('deploy exec abc123', ['--only', 'dev']);
    expect(wrong.code).toBe(2);
    expect(wrong.out).toContain('tidak diizinkan');
    expect((await run('deploy dev abc123', ['--only', 'exec'])).code).toBe(2);
    expect(calls()).toBe('');
    expect(tagIn('exec')).toBe('tag-lama');
    const ok = await run('deploy dev abc123', ['--only', 'dev', '--dry-run']);
    expect(ok.code).toBe(0);
  });
});

describe('deploy.sh: konfigurasi lingkungan', () => {
  test('folder, compose.yml, .env hilang atau QC_ENV/APP_PORT/QC_NAME tak valid: kode 2, tanpa docker', async () => {
    rmSync(join(root, 'dev', 'compose.yml'));
    expect((await run('deploy dev abc123')).code).toBe(2);
    writeFileSync(join(root, 'dev', 'compose.yml'), 'services: {}\n');

    writeFileSync(join(root, 'dev', '.env'), envFile().replace('QC_ENV=dev', 'QC_ENV=exec'));
    expect((await run('deploy dev abc123')).code).toBe(2);

    writeFileSync(join(root, 'dev', '.env'), envFile().replace('8790', '80; id'));
    expect((await run('deploy dev abc123')).code).toBe(2);

    writeFileSync(join(root, 'dev', '.env'), envFile('QC_NAME=Qc Bad;id\n'));
    expect((await run('deploy dev abc123')).code).toBe(2);
    expect(calls()).toBe('');
  });

  test('deploy lain berjalan (kunci ada): kode 3, tidak ada perubahan; kunci milik orang lain tak dihapus', async () => {
    mkdirSync(join(root, 'dev', '.deploy.lock'));
    const result = await run('deploy dev abc123');
    expect(result.code).toBe(3);
    expect(calls()).toBe('');
    expect(tagIn('dev')).toBe('tag-lama');
    expect(existsSync(join(root, 'dev', '.deploy.lock'))).toBe(true);
  });
});

describe('deploy.sh: alur deploy dan pemulihan', () => {
  test('sukses: tag baru ditulis (izin .env terjaga), pull, up -d, inspect, ping; kunci dilepas', async () => {
    const result = await run('deploy dev sha-baru');
    expect(result.code).toBe(0);
    expect(result.out).toContain('DEPLOY_OK env=dev tag=sha-baru');
    expect(tagIn('dev')).toBe('sha-baru');
    expect(tagIn('exec')).toBe('tag-lama'); // lingkungan lain tak tersentuh
    const text = calls();
    expect(text).toMatch(/docker compose .* pull qc-app/);
    expect(text).toMatch(/docker compose .* up -d/);
    expect(text).toContain('curl -fsS --max-time 5 -o /dev/null http://127.0.0.1:8790/api/ping');
    expect(text.indexOf(' pull ')).toBeLessThan(text.indexOf(' up '));
    expect(existsSync(join(root, 'dev', '.deploy.lock'))).toBe(false);
    // rahasia .env tidak dicetak
    expect(result.out).not.toContain('rahasia-uji');
    // isi .env lain tetap (hanya baris tag yang berubah)
    expect(readFileSync(join(root, 'dev', '.env'), 'utf8')).toContain(
      'MARIADB_ROOT_PASSWORD=rahasia-uji',
    );
  });

  test('kontainer tidak sehat: kembali ke tag sebelumnya (kode 1), .env dikembalikan, kunci dilepas', async () => {
    writeFileSync(join(state, 'unhealthy_tags'), 'sha-rusak\n');
    const result = await run('deploy dev sha-rusak');
    expect(result.code).toBe(1);
    expect(result.out).toContain('dikembalikan ke tag-lama');
    expect(tagIn('dev')).toBe('tag-lama');
    expect(readFileSync(join(state, 'running'), 'utf8').trim()).toBe('tag-lama');
    expect((calls().match(/ up -d/g) ?? []).length).toBe(2);
    expect(existsSync(join(root, 'dev', '.deploy.lock'))).toBe(false);
  });

  test('/api/ping gagal pada tag baru: kembali ke tag sebelumnya (kode 1)', async () => {
    writeFileSync(join(state, 'ping_fail_tags'), 'sha-ping-rusak\n');
    const result = await run('deploy dev sha-ping-rusak');
    expect(result.code).toBe(1);
    expect(tagIn('dev')).toBe('tag-lama');
    expect(readFileSync(join(state, 'running'), 'utf8').trim()).toBe('tag-lama');
  });

  test('up -d gagal: kembali ke tag sebelumnya; bila up -d terus gagal, kode 4', async () => {
    writeFileSync(join(state, 'up_fail'), '1');
    const result = await run('deploy dev sha-baru');
    expect(result.code).toBe(4);
    expect(result.out).toContain('pengembalian');
    expect(tagIn('dev')).toBe('tag-lama');
  });

  test('pull gagal: tidak ada up -d, tag di .env dikembalikan, kode 1', async () => {
    writeFileSync(join(state, 'pull_fail'), '1');
    const result = await run('deploy dev sha-tak-ada');
    expect(result.code).toBe(1);
    expect(calls()).not.toContain(' up ');
    expect(tagIn('dev')).toBe('tag-lama');
  });

  test('tanpa tag sebelumnya dan gagal: kode 4 (tidak ada yang bisa dikembalikan), pesan jelas', async () => {
    writeFileSync(join(root, 'dev', '.env'), envFile('', null));
    writeFileSync(join(state, 'unhealthy_tags'), 'sha-rusak\n');
    const result = await run('deploy dev sha-rusak');
    expect(result.code).toBe(4);
    expect(result.out).toContain('tidak ada tag sebelumnya');
  });

  test('QC_IMAGE_TAG belum ada di .env: ditambahkan', async () => {
    writeFileSync(join(root, 'dev', '.env'), envFile('', null));
    const result = await run('deploy dev sha-pertama');
    expect(result.code).toBe(0);
    expect(tagIn('dev')).toBe('sha-pertama');
  });

  test('QC_NAME dipakai untuk nama kontainer yang diperiksa (staging memakai qc-staging)', async () => {
    writeFileSync(join(root, 'dev', '.env'), envFile('QC_NAME=qc-staging\n'));
    const result = await run('deploy dev sha-baru');
    expect(result.code).toBe(0);
    expect(calls()).toContain('qc-staging-app');
    expect(calls()).not.toContain('qc-dev-app');
  });
});
