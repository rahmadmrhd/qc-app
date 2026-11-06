// biome-ignore-all lint/suspicious/noTemplateCurlyInString: payload jahat (`${HOME}`) sengaja ditulis literal
// Tes `deploy/deploy.sh` tanpa Docker dan tanpa VPS: skrip dijalankan dengan `docker` dan `curl` PALSU di PATH
// (mencatat panggilan dan meniru keadaan) pada folder sementara. Menguji validasi ketat SSH_ORIGINAL_COMMAND
// (input jahat tidak boleh sampai ke docker maupun berkas), pemulihan ke tag sebelumnya, kunci, pembatasan --only,
// dan bahwa keluaran docker compose (yang dapat memuat potongan rahasia) tak pernah sampai ke pemanggil.
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
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Tiap tes memulai proses bash (lambat di Windows); rollback menjalankan beberapa subproses.
setDefaultTimeout(30_000);

const SCRIPT = join(import.meta.dir, '..', '..', 'deploy', 'deploy.sh').replaceAll('\\', '/');
const posix = (path: string) => path.replaceAll('\\', '/');
// Tag permintaan = SHA commit penuh (40 heksa huruf kecil); tag SEBELUMNYA di .env boleh bentuk lain (mis. local-<sha>).
const SHA_NEW = 'a'.repeat(40);
const SHA_BAD = 'b'.repeat(40);
const SHA_OTHER = 'c'.repeat(40);

let base: string;
let bin: string;
let root: string;
let state: string;
let log: string;

const FAKE_DOCKER = `#!/bin/sh
# docker palsu: mencatat argumen; meniru compose pull/up dan inspect berdasarkan berkas keadaan.
echo "docker $*" >> "$FAKE_LOG"
# Semua subperintah compose menulis "rahasia-uji" ke stdout DAN stderr (meniru galat urai yang memuat nilai .env).
case "$*" in
  *" config "*)
    echo "config-env QC_IMAGE_TAG=$QC_IMAGE_TAG" >> "$FAKE_LOG"
    echo "config rahasia-uji"; echo "config err rahasia-uji" >&2
    [ -f "$FAKE_STATE/config_fail" ] && exit 1
    exit 0 ;;
  *" pull "*)
    echo "pull rahasia-uji"; echo "pull err rahasia-uji" >&2
    [ -f "$FAKE_STATE/pull_fail" ] && exit 1
    exit 0 ;;
  *" up "*)
    echo "up rahasia-uji"; echo "up err rahasia-uji" >&2
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
  return `QC_ENV=staging\nAPP_PORT=8790\nMARIADB_ROOT_PASSWORD=rahasia-uji\n${tag === null ? '' : `QC_IMAGE_TAG=${tag}\n`}${extra}`;
}

beforeEach(() => {
  root = join(base, `root-${crypto.randomUUID().slice(0, 8)}`);
  state = join(root, '_state');
  log = join(root, '_calls.log');
  mkdirSync(join(root, 'staging'), { recursive: true });
  mkdirSync(join(root, 'production'), { recursive: true });
  mkdirSync(state);
  writeFileSync(log, '');
  for (const name of ['staging', 'production']) {
    writeFileSync(join(root, name, 'compose.yml'), 'services: {}\n');
    writeFileSync(
      join(root, name, '.env'),
      envFile()
        .replace('QC_ENV=staging', `QC_ENV=${name}`)
        .replace('8790', name === 'staging' ? '8790' : '8791'),
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
  env.FAKE_ENV = posix(join(root, 'staging', '.env'));
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
const tagIn = (name: 'staging' | 'production') =>
  /^QC_IMAGE_TAG=(.*)$/m.exec(readFileSync(join(root, name, '.env'), 'utf8'))?.[1];

describe('deploy.sh: validasi input (tidak ada yang berjalan)', () => {
  const MALICIOUS: Array<[string, string | undefined]> = [
    ['perintah tak diset', undefined],
    ['perintah kosong', ''],
    ['bukan perintah deploy', 'bash -c id'],
    ['lingkungan tak dikenal', 'deploy prod abc123'],
    ['lingkungan kapital', 'deploy DEV abc123'],
    ['kata kerja kapital', 'DEPLOY staging abc123'],
    ['tanpa tag', 'deploy staging'],
    ['tag kosong (spasi ekor)', 'deploy staging '],
    ['spasi ganda', 'deploy  staging abc123'],
    ['argumen berlebih', 'deploy staging abc123 extra'],
    ['titik koma', 'deploy staging abc;rm -rf /'],
    ['substitusi $()', 'deploy staging $(id)'],
    ['backtick', 'deploy staging `id`'],
    ['ekspansi ${}', 'deploy staging ${HOME}'],
    ['variabel IFS', 'deploy staging a$IFS$9b'],
    ['pipe', 'deploy staging a|b'],
    ['ampersand', 'deploy staging a&&id'],
    ['pengalihan', 'deploy staging a>/tmp/x'],
    ['kutip tunggal', "deploy staging a'b"],
    ['kutip ganda', 'deploy staging a"b'],
    ['garis miring (path)', 'deploy staging ../../etc/passwd'],
    ['backslash', 'deploy staging a\\b'],
    ['newline di tengah', 'deploy staging abc\nrm -rf /'],
    ['newline di ujung', 'deploy staging abc\n'],
    ['carriage return', 'deploy staging abc\r'],
    ['spasi tak-pecah (NBSP)', 'deploy staging abc def'],
    ['tag diawali minus', 'deploy staging -rf'],
    ['tag diawali titik', 'deploy staging .hidden'],
    ['tag 65 karakter', `deploy staging ${'a'.repeat(65)}`],
    ['perintah sangat panjang', `deploy staging ${'a'.repeat(500)}`],
    ['lingkungan dengan lebih dari satu nama', 'deploy staging,production abc123'],
    ['tag bernama (latest)', 'deploy staging latest'],
    ['tag versi (v1.2.3)', 'deploy staging v1.2.3'],
    ['tag bentuk local-<sha>', 'deploy staging local-0123abc'],
    ['SHA pendek (7 heksa)', 'deploy staging 0123abc'],
    ['SHA 39 heksa', `deploy staging ${'a'.repeat(39)}`],
    ['SHA 41 heksa', `deploy staging ${'a'.repeat(41)}`],
    ['SHA huruf kapital', `deploy staging ${'A'.repeat(40)}`],
    ['40 karakter bukan heksa', `deploy staging ${'g'.repeat(40)}`],
  ];

  for (const [label, request] of MALICIOUS) {
    test(`ditolak (kode 2), tanpa docker/curl, tanpa menyentuh .env, tanpa mencetak input: ${label}`, async () => {
      const before = readFileSync(join(root, 'staging', '.env'), 'utf8');
      const result = await run(request);
      expect(result.code).toBe(2);
      expect(calls()).toBe('');
      expect(readFileSync(join(root, 'staging', '.env'), 'utf8')).toBe(before);
      expect(existsSync(join(root, 'staging', '.deploy.lock'))).toBe(false);
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
      // 40 karakter persis: hanya karakter itu yang membuatnya tidak sah
      const result = await run(`deploy staging ${'a'.repeat(20)}${char}${'a'.repeat(19)}`, [
        '--dry-run',
      ]);
      expect(result.code, `karakter ${JSON.stringify(char)}`).toBe(2);
    }
    expect(calls()).toBe('');
  });

  test('format sah diterima: hanya SHA commit 40 heksa huruf kecil', async () => {
    for (const tag of [SHA_NEW, '0123456789abcdef'.repeat(2) + '01234567', 'f'.repeat(40)]) {
      const result = await run(`deploy staging ${tag}`, ['--dry-run']);
      expect(result.code).toBe(0);
      expect(result.out).toContain(`tag=${tag}`);
    }
    expect(calls()).toBe('');
  });

  test('argumen skrip tak dikenal / --only salah ditolak', async () => {
    expect((await run(`deploy staging ${SHA_NEW}`, ['--aneh'])).code).toBe(2);
    expect((await run(`deploy staging ${SHA_NEW}`, ['--only', 'prod'])).code).toBe(2);
    expect((await run(`deploy staging ${SHA_NEW}`, ['--wait-seconds', 'x'])).code).toBe(2);
    expect(calls()).toBe('');
  });

  test('--only membatasi lingkungan: kunci staging tidak boleh men-deploy production dan sebaliknya', async () => {
    const wrong = await run(`deploy production ${SHA_NEW}`, ['--only', 'staging']);
    expect(wrong.code).toBe(2);
    expect(wrong.out).toContain('tidak diizinkan');
    expect((await run(`deploy staging ${SHA_NEW}`, ['--only', 'production'])).code).toBe(2);
    expect(calls()).toBe('');
    expect(tagIn('production')).toBe('tag-lama');
    const ok = await run(`deploy staging ${SHA_NEW}`, ['--only', 'staging', '--dry-run']);
    expect(ok.code).toBe(0);
  });
});

describe('deploy.sh: konfigurasi lingkungan', () => {
  test('folder, compose.yml, .env hilang atau QC_ENV/APP_PORT/QC_NAME tak valid: kode 2, tanpa docker', async () => {
    rmSync(join(root, 'staging', 'compose.yml'));
    expect((await run(`deploy staging ${SHA_NEW}`)).code).toBe(2);
    writeFileSync(join(root, 'staging', 'compose.yml'), 'services: {}\n');

    writeFileSync(
      join(root, 'staging', '.env'),
      envFile().replace('QC_ENV=staging', 'QC_ENV=production'),
    );
    expect((await run(`deploy staging ${SHA_NEW}`)).code).toBe(2);

    writeFileSync(join(root, 'staging', '.env'), envFile().replace('8790', '80; id'));
    expect((await run(`deploy staging ${SHA_NEW}`)).code).toBe(2);

    writeFileSync(join(root, 'staging', '.env'), envFile('QC_NAME=Qc Bad;id\n'));
    expect((await run(`deploy staging ${SHA_NEW}`)).code).toBe(2);
    expect(calls()).toBe('');
  });

  test('deploy lain berjalan (kunci ada): kode 3, tidak ada perubahan; kunci milik orang lain tak dihapus', async () => {
    mkdirSync(join(root, 'staging', '.deploy.lock'));
    const result = await run(`deploy staging ${SHA_NEW}`);
    expect(result.code).toBe(3);
    expect(calls()).toBe('');
    expect(tagIn('staging')).toBe('tag-lama');
    expect(existsSync(join(root, 'staging', '.deploy.lock'))).toBe(true);
  });

  test('nilai .env berkutip (ganda/tunggal) dibaca seperti compose: QC_ENV, APP_PORT, QC_NAME diterima', async () => {
    writeFileSync(
      join(root, 'staging', '.env'),
      `QC_ENV="staging"\nAPP_PORT='8790'\nQC_NAME="qc-staging"\nQC_IMAGE_TAG=tag-lama\n`,
    );
    const result = await run(`deploy staging ${SHA_NEW}`);
    expect(result.code).toBe(0);
    expect(calls()).toContain('qc-staging-app');
    expect(calls()).toContain('http://127.0.0.1:8790/api/ping');
  });

  test('kutip yang tak cocok tidak dibuang: QC_ENV="staging tetap ditolak (kode 2)', async () => {
    writeFileSync(
      join(root, 'staging', '.env'),
      `QC_ENV="staging\nAPP_PORT=8790\nQC_IMAGE_TAG=tag-lama\n`,
    );
    expect((await run(`deploy staging ${SHA_NEW}`)).code).toBe(2);
    expect(calls()).toBe('');
  });

  test('QC_IMAGE selain ghcr.io/... ditolak (kode 2) sebelum apa pun berubah; ghcr.io atau tanpa QC_IMAGE diterima', async () => {
    for (const image of ['qc-app', 'docker.io/x/qc-app', '"qc-app"', 'ghcr.io', 'ghcr.io/']) {
      writeFileSync(join(root, 'staging', '.env'), envFile(`QC_IMAGE=${image}\n`));
      const before = readFileSync(join(root, 'staging', '.env'), 'utf8');
      const result = await run(`deploy staging ${SHA_NEW}`);
      expect(result.code, image).toBe(2);
      expect(result.out, image).toContain('QC_IMAGE');
      expect(readFileSync(join(root, 'staging', '.env'), 'utf8')).toBe(before);
    }
    expect(calls()).toBe('');
    for (const image of ['ghcr.io/rahmadmrhd/qc-app', '"ghcr.io/rahmadmrhd/qc-app"']) {
      writeFileSync(join(root, 'staging', '.env'), envFile(`QC_IMAGE=${image}\n`));
      expect((await run(`deploy staging ${SHA_NEW}`)).code, image).toBe(0);
    }
    writeFileSync(join(root, 'staging', '.env'), envFile('# QC_IMAGE=qc-app\n'));
    expect((await run(`deploy staging ${SHA_BAD}`)).code).toBe(0);
  });
});

describe('deploy.sh: alur deploy dan pemulihan', () => {
  test('sukses: tag baru ditulis (izin .env terjaga), config, pull, up -d, inspect, ping; kunci dilepas', async () => {
    const result = await run(`deploy staging ${SHA_NEW}`);
    expect(result.code).toBe(0);
    expect(result.out).toContain(`DEPLOY_OK env=staging tag=${SHA_NEW}`);
    expect(tagIn('staging')).toBe(SHA_NEW);
    expect(tagIn('production')).toBe('tag-lama'); // lingkungan lain tak tersentuh
    const text = calls();
    expect(text).toMatch(/docker compose .* config --quiet/);
    expect(text).toMatch(/docker compose .* pull qc-app/);
    expect(text).toMatch(/docker compose .* up -d/);
    expect(text).toContain('curl -fsS --max-time 5 -o /dev/null http://127.0.0.1:8790/api/ping');
    expect(text.indexOf(' config ')).toBeLessThan(text.indexOf(' pull '));
    expect(text.indexOf(' pull ')).toBeLessThan(text.indexOf(' up '));
    expect(existsSync(join(root, 'staging', '.deploy.lock'))).toBe(false);
    // rahasia .env tidak dicetak
    expect(result.out).not.toContain('rahasia-uji');
    // isi .env lain tetap (hanya baris tag yang berubah)
    expect(readFileSync(join(root, 'staging', '.env'), 'utf8')).toContain(
      'MARIADB_ROOT_PASSWORD=rahasia-uji',
    );
  });

  test('keluaran docker compose (stdout dan stderr) tak pernah sampai ke pemanggil; masuk log khusus root yang ditimpa tiap deploy', async () => {
    const result = await run(`deploy staging ${SHA_NEW}`);
    expect(result.code).toBe(0);
    expect(result.out).not.toContain('rahasia-uji');
    const logPath = join(root, 'staging', '.deploy.log');
    const content = readFileSync(logPath, 'utf8');
    expect(content).toContain('pull rahasia-uji');
    expect(content).toContain('up err rahasia-uji');
    if (process.platform !== 'win32') expect(statSync(logPath).mode & 0o777).toBe(0o600);
    // deploy berikutnya menimpa (bukan menambah)
    await run(`deploy staging ${SHA_OTHER}`);
    expect(readFileSync(logPath, 'utf8').split('pull rahasia-uji').length - 1).toBe(1);
  });

  test('keluaran compose tak bocor pada jalur gagal (pull gagal, up gagal, tidak sehat + pengembalian)', async () => {
    writeFileSync(join(state, 'pull_fail'), '1');
    const pullFail = await run(`deploy staging ${SHA_BAD}`);
    expect(pullFail.code).toBe(1);
    expect(pullFail.out).not.toContain('rahasia-uji');
    rmSync(join(state, 'pull_fail'));

    writeFileSync(join(state, 'up_fail'), '1');
    const upFail = await run(`deploy staging ${SHA_BAD}`);
    expect(upFail.code).toBe(4);
    expect(upFail.out).not.toContain('rahasia-uji');
    rmSync(join(state, 'up_fail'));

    writeFileSync(join(state, 'unhealthy_tags'), `${SHA_BAD}\n`);
    const unhealthy = await run(`deploy staging ${SHA_BAD}`);
    expect(unhealthy.code).toBe(1);
    expect(unhealthy.out).not.toContain('rahasia-uji');
    expect(unhealthy.out).toContain('.deploy.log'); // petunjuk lokasi log di VPS
  });

  test('.env/compose.yml rusak (compose config gagal): kode 2, tanpa pull/up, .env utuh, tanpa mencetak galat docker', async () => {
    writeFileSync(join(state, 'config_fail'), '1');
    const before = readFileSync(join(root, 'staging', '.env'), 'utf8');
    const result = await run(`deploy staging ${SHA_NEW}`);
    expect(result.code).toBe(2);
    expect(result.out).not.toContain('rahasia-uji');
    expect(result.out).toContain('tidak valid');
    const text = calls();
    expect(text).toContain(' config ');
    expect(text).not.toContain(' pull ');
    expect(text).not.toContain(' up ');
    expect(readFileSync(join(root, 'staging', '.env'), 'utf8')).toBe(before);
    expect(readFileSync(join(state, 'running'), 'utf8').trim()).toBe('tag-lama');
    expect(existsSync(join(root, 'staging', '.deploy.lock'))).toBe(false);
  });

  test('compose config diberi QC_IMAGE_TAG baru lewat lingkungan proses (deploy pertama tanpa tag di .env tetap valid)', async () => {
    writeFileSync(join(root, 'staging', '.env'), envFile('', null));
    const result = await run(`deploy staging ${SHA_NEW}`);
    expect(result.code).toBe(0);
    expect(calls()).toContain(`config-env QC_IMAGE_TAG=${SHA_NEW}`);
  });

  test('kontainer tidak sehat: kembali ke tag sebelumnya (kode 1), .env dikembalikan, kunci dilepas', async () => {
    writeFileSync(join(state, 'unhealthy_tags'), `${SHA_BAD}\n`);
    const result = await run(`deploy staging ${SHA_BAD}`);
    expect(result.code).toBe(1);
    expect(result.out).toContain('dikembalikan ke tag-lama');
    expect(tagIn('staging')).toBe('tag-lama');
    expect(readFileSync(join(state, 'running'), 'utf8').trim()).toBe('tag-lama');
    expect((calls().match(/ up -d/g) ?? []).length).toBe(2);
    expect(existsSync(join(root, 'staging', '.deploy.lock'))).toBe(false);
  });

  test('/api/ping gagal pada tag baru: kembali ke tag sebelumnya (kode 1)', async () => {
    writeFileSync(join(state, 'ping_fail_tags'), `${SHA_BAD}\n`);
    const result = await run(`deploy staging ${SHA_BAD}`);
    expect(result.code).toBe(1);
    expect(tagIn('staging')).toBe('tag-lama');
    expect(readFileSync(join(state, 'running'), 'utf8').trim()).toBe('tag-lama');
  });

  test('up -d gagal: kembali ke tag sebelumnya; bila up -d terus gagal, kode 4', async () => {
    writeFileSync(join(state, 'up_fail'), '1');
    const result = await run(`deploy staging ${SHA_NEW}`);
    expect(result.code).toBe(4);
    expect(result.out).toContain('pengembalian');
    expect(tagIn('staging')).toBe('tag-lama');
  });

  test('pull gagal: tidak ada up -d, tag di .env dikembalikan, kode 1', async () => {
    writeFileSync(join(state, 'pull_fail'), '1');
    const result = await run(`deploy staging ${SHA_OTHER}`);
    expect(result.code).toBe(1);
    expect(calls()).not.toContain(' up ');
    expect(tagIn('staging')).toBe('tag-lama');
  });

  test('tanpa tag sebelumnya dan gagal: kode 4 (tidak ada yang bisa dikembalikan), pesan jelas', async () => {
    writeFileSync(join(root, 'staging', '.env'), envFile('', null));
    writeFileSync(join(state, 'unhealthy_tags'), `${SHA_BAD}\n`);
    const result = await run(`deploy staging ${SHA_BAD}`);
    expect(result.code).toBe(4);
    expect(result.out).toContain('tidak ada tag sebelumnya');
  });

  test('QC_IMAGE_TAG belum ada di .env: ditambahkan', async () => {
    writeFileSync(join(root, 'staging', '.env'), envFile('', null));
    const result = await run(`deploy staging ${SHA_NEW}`);
    expect(result.code).toBe(0);
    expect(tagIn('staging')).toBe(SHA_NEW);
  });

  test('tag sebelumnya bentuk local-<sha> (image lokal lama) tetap dapat dikembalikan', async () => {
    writeFileSync(join(root, 'staging', '.env'), envFile('', 'local-0123abc'));
    writeFileSync(join(state, 'running'), 'local-0123abc\n');
    writeFileSync(join(state, 'unhealthy_tags'), `${SHA_BAD}\n`);
    const result = await run(`deploy staging ${SHA_BAD}`);
    expect(result.code).toBe(1);
    expect(tagIn('staging')).toBe('local-0123abc');
  });

  test('QC_IMAGE_TAG berkutip di .env: tag sebelumnya tetap dikenali, pengembalian berfungsi (bukan kode 4)', async () => {
    const quoted = (q: string) =>
      envFile().replace('QC_IMAGE_TAG=tag-lama', `QC_IMAGE_TAG=${q}tag-lama${q}`);
    writeFileSync(join(state, 'unhealthy_tags'), `${SHA_BAD}\n`);
    for (const q of ['"', "'"]) {
      writeFileSync(join(root, 'staging', '.env'), quoted(q));
      writeFileSync(join(state, 'running'), 'tag-lama\n');
      const result = await run(`deploy staging ${SHA_BAD}`);
      expect(result.code, `kutip ${q}`).toBe(1);
      expect(result.out).toContain('dikembalikan ke tag-lama');
      expect(tagIn('staging')).toBe('tag-lama');
      expect(readFileSync(join(state, 'running'), 'utf8').trim()).toBe('tag-lama');
    }
  });

  test('QC_NAME dipakai untuk nama kontainer yang diperiksa (staging memakai qc-staging)', async () => {
    writeFileSync(join(root, 'staging', '.env'), envFile('QC_NAME=qc-staging\n'));
    const result = await run(`deploy staging ${SHA_NEW}`);
    expect(result.code).toBe(0);
    expect(calls()).toContain('qc-staging-app');
    expect(calls()).not.toContain('qc-dev-app');
  });

  test('tanpa QC_NAME, nama kontainer bawaan qc-<lingkungan> (staging: qc-staging)', async () => {
    const result = await run(`deploy staging ${SHA_NEW}`);
    expect(result.code).toBe(0);
    expect(calls()).toContain('qc-staging-app');
  });
});
