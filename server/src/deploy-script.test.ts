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
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

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
  "image ls"*)
    cat "$FAKE_STATE/images" 2>/dev/null
    [ -f "$FAKE_STATE/ls_fail" ] && exit 1
    exit 0 ;;
  "image rm"*)
    echo "rm rahasia-uji"; echo "rm err rahasia-uji" >&2
    [ -f "$FAKE_STATE/rm_fail" ] && exit 1
    exit 0 ;;
  "exec "*)
    echo "exec-env MYSQL_PWD=$MYSQL_PWD" >> "$FAKE_LOG_PRIVATE"
    case "$*" in
      *schema_migrations*)
        # pagar downgrade skema: isi berkas keadaan "applied" = migrasi yang tercatat di basis data
        echo "exec err rahasia-uji" >&2
        [ -f "$FAKE_STATE/applied_fail" ] && exit 1
        cat "$FAKE_STATE/applied" 2>/dev/null
        exit 0 ;;
    esac
    echo "exec rahasia-uji"; echo "exec err rahasia-uji" >&2
    [ -f "$FAKE_STATE/db_auth_fail" ] && exit 1
    exit 0 ;;
  "run "*)
    # docker run --rm --network none --entrypoint <ls|head> <repo>:<tag> ... : isi migrasi di dalam image
    echo "run err rahasia-uji" >&2
    img=$(echo "$*" | sed -n 's/.*qc-app:\\([^ ]*\\).*/\\1/p')
    case "$*" in
      *"--entrypoint ls "*)
        [ -f "$FAKE_STATE/image_ls_fail" ] && exit 1
        cat "$FAKE_STATE/image_migrations_$img" 2>/dev/null
        exit 0 ;;
      *"--entrypoint head "*)
        name=$(basename "$(echo "$*" | awk '{print $NF}')")
        [ -f "$FAKE_STATE/firstline_$name" ] || exit 1
        cat "$FAKE_STATE/firstline_$name"
        exit 0 ;;
    esac
    exit 0 ;;
  inspect*State.Running*)
    [ -f "$FAKE_STATE/no_db" ] && exit 1
    echo true; exit 0 ;;
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
case "$*" in
  *--resolve*)
    echo "curl nginx rahasia-uji"; echo "curl nginx err rahasia-uji" >&2
    [ -f "$FAKE_STATE/nginx_down" ] && exit 7
    if [ -f "$FAKE_STATE/nginx_fail_all" ] || grep -qx "$tag" "$FAKE_STATE/nginx_fail_tags" 2>/dev/null; then exit 22; fi
    exit 0 ;;
esac
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
  env.FAKE_LOG_PRIVATE = posix(join(root, '_private.log'));
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

  test('pull gagal tanpa tag sebelumnya: .env dipulihkan APA ADANYA (tanpa QC_IMAGE_TAG baru), kode 1, salinan sementara dihapus', async () => {
    const original = envFile('', null);
    writeFileSync(join(root, 'staging', '.env'), original);
    writeFileSync(join(state, 'pull_fail'), '1');
    const result = await run(`deploy staging ${SHA_NEW}`);
    expect(result.code).toBe(1);
    expect(readFileSync(join(root, 'staging', '.env'), 'utf8')).toBe(original);
    expect(readdirSync(join(root, 'staging')).filter((n) => n.startsWith('.env.'))).toEqual([]);
    expect(calls()).not.toContain(' up ');
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

describe('deploy.sh: preflight kredensial DB', () => {
  const SECRET = 'sandi-db-sentinel-9f3a';
  const withDb = (extra = '') =>
    writeFileSync(
      join(root, 'staging', '.env'),
      envFile(`QC_DB_USER=qc_dev
QC_DB_NAME=qc_dev
QC_DB_PASSWORD=${SECRET}
${extra}`),
    );

  test('DB berjalan + kredensial benar: lanjut; sandi hanya lewat env (-e MYSQL_PWD), tak ada di argumen/log/stdout', async () => {
    withDb();
    const result = await run(`deploy staging ${SHA_NEW}`);
    expect(result.code).toBe(0);
    const execLine = calls()
      .split(String.fromCharCode(10))
      .find((l) => l.startsWith('docker exec'));
    expect(execLine).toContain('-e MYSQL_PWD qc-staging-db mariadb');
    expect(execLine).toContain('-uqc_dev qc_dev');
    expect(calls()).not.toContain(SECRET);
    expect(result.out).not.toContain(SECRET);
    expect(readFileSync(join(root, 'staging', '.deploy.log'), 'utf8')).not.toContain(SECRET);
    // sandi memang sampai ke proses lewat lingkungan
    expect(readFileSync(join(root, '_private.log'), 'utf8')).toContain(`MYSQL_PWD=${SECRET}`);
    expect(result.out).not.toContain('rahasia-uji');
    expect(calls().indexOf('docker exec')).toBeLessThan(calls().indexOf(' pull '));
  });

  test('kredensial salah: kode 2, tag di .env tak berubah, tanpa pull/up, sandi tak bocor', async () => {
    withDb();
    writeFileSync(join(state, 'db_auth_fail'), '1');
    const before = readFileSync(join(root, 'staging', '.env'), 'utf8');
    const result = await run(`deploy staging ${SHA_NEW}`);
    expect(result.code).toBe(2);
    expect(result.out).toContain('kredensial DB di .env tidak cocok');
    expect(result.out).not.toContain(SECRET);
    expect(result.out).not.toContain('rahasia-uji');
    expect(readFileSync(join(root, 'staging', '.env'), 'utf8')).toBe(before);
    expect(calls()).not.toContain(' pull ');
    expect(calls()).not.toContain(' up ');
    expect(existsSync(join(root, 'staging', '.deploy.lock'))).toBe(false);
  });

  test('kontainer DB tidak ada: dilewati dan deploy lanjut', async () => {
    withDb();
    writeFileSync(join(state, 'no_db'), '1');
    const result = await run(`deploy staging ${SHA_NEW}`);
    expect(result.code).toBe(0);
    expect(result.out).toContain('preflight kredensial DB dilewati');
    expect(calls()).not.toContain('docker exec');
  });

  test('bawaan pengguna/skema qc_<lingkungan> bila QC_DB_USER/QC_DB_NAME kosong; nama tak valid ditolak (kode 2)', async () => {
    writeFileSync(join(root, 'staging', '.env'), envFile(`QC_DB_PASSWORD=x\n`));
    expect((await run(`deploy staging ${SHA_NEW}`)).code).toBe(0);
    expect(calls()).toContain('-uqc_staging qc_staging');
  });

  test('QC_DB_USER tak valid: kode 2 tanpa docker exec', async () => {
    writeFileSync(join(root, 'staging', '.env'), envFile(`QC_DB_USER=a b;x\nQC_DB_PASSWORD=x\n`));
    const result = await run(`deploy staging ${SHA_NEW}`);
    expect(result.code).toBe(2);
    expect(calls()).not.toContain('docker exec');
  });

  test('--dry-run menyebut preflight', async () => {
    expect((await run(`deploy staging ${SHA_NEW}`, ['--dry-run'])).out).toContain(
      'preflight kredensial DB',
    );
  });
});

describe('deploy.sh: pagar downgrade skema', () => {
  const ALLOW = ' allow-schema-downgrade';
  const NL = String.fromCharCode(10);
  const lines = (names: string[]) => (names.length > 0 ? `${names.join(NL)}${NL}` : '');
  const setApplied = (names: string[]) => writeFileSync(join(state, 'applied'), lines(names));
  const setImage = (tag: string, names: string[]) =>
    writeFileSync(join(state, `image_migrations_${tag}`), lines(names));
  const setFirstLine = (name: string, line: string) =>
    writeFileSync(join(state, `firstline_${name}`), `${line}${NL}`);
  const guardCalls = () =>
    calls()
      .split(NL)
      .filter((l) => /^docker run /.test(l));
  const envBefore = () => readFileSync(join(root, 'staging', '.env'), 'utf8');
  const noResidue = () => readdirSync(join(root, 'staging')).filter((n) => n.startsWith('.env.'));

  const M1 = '0001_baseline.sql';
  const M2 = '0002_tambah_kolom.sql';

  test('upgrade (image target punya semua migrasi tercatat) lolos tanpa kata izin', async () => {
    setApplied([M1]);
    setImage(SHA_NEW, [M1, M2]);
    const result = await run(`deploy staging ${SHA_NEW}`);
    expect(result.code).toBe(0);
    expect(calls()).toContain(' up -d');
  });

  test('migrasi sama persis lolos', async () => {
    setApplied([M1, M2]);
    setImage(SHA_NEW, [M1, M2]);
    expect((await run(`deploy staging ${SHA_NEW}`)).code).toBe(0);
  });

  test('downgrade tanpa kata izin: kode 6, .env identik, tanpa up -d, kunci dan salinan sementara bersih', async () => {
    setApplied([M1, M2]);
    setImage(SHA_NEW, [M1]);
    setFirstLine(M2, '-- tambah kolom');
    const before = envBefore();
    const result = await run(`deploy staging ${SHA_NEW}`);
    expect(result.code).toBe(6);
    expect(result.out).toContain(M2);
    expect(result.out).toContain('allow-schema-downgrade');
    expect(result.out).not.toContain('rahasia-uji');
    expect(envBefore()).toBe(before);
    expect(calls()).not.toContain(' up ');
    expect(existsSync(join(root, 'staging', '.deploy.lock'))).toBe(false);
    expect(noResidue()).toEqual([]);
  });

  test('downgrade dengan kata izin lolos dan log menyebut migrasi yang dilewati', async () => {
    setApplied([M1, M2]);
    setImage(SHA_NEW, [M1]);
    setFirstLine(M2, '-- tambah kolom');
    const result = await run(`deploy staging ${SHA_NEW}${ALLOW}`);
    expect(result.code).toBe(0);
    expect(result.out).toContain(M2);
    expect(tagIn('staging')).toBe(SHA_NEW);
    expect(calls()).toContain(' up -d');
    // migrasi dibaca dari image yang SEDANG berjalan (tag sebelumnya), bukan image target
    expect(guardCalls().some((l) => l.includes('qc-app:tag-lama') && l.includes(M2))).toBe(true);
  });

  test('migrasi berpenanda -- qc:contract ditolak walau ada kata izin', async () => {
    setApplied([M1, M2]);
    setImage(SHA_NEW, [M1]);
    setFirstLine(M2, '-- qc:contract');
    const before = envBefore();
    const result = await run(`deploy staging ${SHA_NEW}${ALLOW}`);
    expect(result.code).toBe(6);
    expect(envBefore()).toBe(before);
    expect(calls()).not.toContain(' up ');
  });

  test('berkas migrasi tak terbaca di image berjalan ditolak walau ada kata izin', async () => {
    setApplied([M1, M2]);
    setImage(SHA_NEW, [M1]);
    const result = await run(`deploy staging ${SHA_NEW}${ALLOW}`);
    expect(result.code).toBe(6);
    expect(calls()).not.toContain(' up ');
  });

  test('tanpa tag sebelumnya (PREV_TAG kosong): downgrade ditolak walau ada kata izin, .env persis semula', async () => {
    writeFileSync(join(root, 'staging', '.env'), envFile('', null));
    setApplied([M1, M2]);
    setImage(SHA_NEW, [M1]);
    setFirstLine(M2, '-- tambah kolom');
    const before = envBefore();
    const result = await run(`deploy staging ${SHA_NEW}${ALLOW}`);
    expect(result.code).toBe(6);
    expect(envBefore()).toBe(before);
    expect(noResidue()).toEqual([]);
  });

  test('schema_migrations gagal dibaca: kode 6 (gagal tertutup), kata izin tak melonggarkan', async () => {
    writeFileSync(join(state, 'applied_fail'), '1');
    setImage(SHA_NEW, [M1]);
    for (const tail of ['', ALLOW]) {
      const result = await run(`deploy staging ${SHA_NEW}${tail}`);
      expect(result.code, `ekor=${JSON.stringify(tail)}`).toBe(6);
    }
    expect(calls()).not.toContain(' up ');
  });

  test('daftar migrasi image target gagal dibaca: kode 6, kata izin tak melonggarkan', async () => {
    setApplied([M1]);
    writeFileSync(join(state, 'image_ls_fail'), '1');
    for (const tail of ['', ALLOW]) {
      const result = await run(`deploy staging ${SHA_NEW}${tail}`);
      expect(result.code, `ekor=${JSON.stringify(tail)}`).toBe(6);
    }
    expect(calls()).not.toContain(' up ');
  });

  test('kontainer DB tidak berjalan: pagar dilewati dan deploy lanjut tanpa docker run', async () => {
    writeFileSync(join(state, 'no_db'), '1');
    const result = await run(`deploy staging ${SHA_NEW}`);
    expect(result.code).toBe(0);
    expect(result.out).toContain('pagar downgrade skema dilewati');
    expect(guardCalls()).toEqual([]);
  });

  test('nama migrasi tercatat yang tak sah (bukan NNNN_nama.sql) ditolak walau ada kata izin, tanpa menjalankan nama itu', async () => {
    for (const bad of ['../x.sql', '0001_A.sql', 'x.sql', '0001_a.sql;id']) {
      setApplied([M1, bad]);
      setImage(SHA_NEW, [M1]);
      const result = await run(`deploy staging ${SHA_NEW}${ALLOW}`);
      expect(result.code, bad).toBe(6);
      expect(guardCalls().some((l) => l.includes(bad))).toBe(false);
    }
  });

  test('perintah dengan kata izin sah diterima; bentuk lain ditolak kode 2 tanpa efek', async () => {
    const dry = await run(`deploy production ${SHA_NEW}${ALLOW}`, ['--dry-run']);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain(`tag=${SHA_NEW}`);
    expect(`deploy production ${SHA_NEW}${ALLOW}`.length).toBe(81);
    const bad = [
      `deploy staging ${SHA_NEW}${ALLOW}${ALLOW}`,
      `deploy staging ${SHA_NEW} ALLOW-SCHEMA-DOWNGRADE`,
      `deploy staging ${SHA_NEW} allow-schema-downgrade-x`,
      `deploy staging ${SHA_NEW} force`,
      `deploy staging ${SHA_NEW}  allow-schema-downgrade`,
      `deploy staging ${SHA_NEW} allow-schema-downgrade `,
      `deploy staging ${SHA_NEW}${ALLOW}${'x'.repeat(16)}`,
    ];
    for (const request of bad) {
      const result = await run(request, ['--dry-run']);
      expect(result.code, request).toBe(2);
    }
    expect(calls()).toBe('');
  });

  test('kata sandi DB tak muncul di argumen docker (kecuali -e MYSQL_PWD tanpa nilai), log, maupun stdout', async () => {
    const SECRET = 'sandi-db-sentinel-9f3a';
    writeFileSync(
      join(root, 'staging', '.env'),
      envFile(`QC_DB_USER=qc_dev\nQC_DB_NAME=qc_dev\nQC_DB_PASSWORD=${SECRET}\n`),
    );
    setApplied([M1, M2]);
    setImage(SHA_NEW, [M1]);
    setFirstLine(M2, '-- tambah kolom');
    const result = await run(`deploy staging ${SHA_NEW}${ALLOW}`);
    expect(result.code).toBe(0);
    expect(calls()).not.toContain(SECRET);
    expect(result.out).not.toContain(SECRET);
    expect(readFileSync(join(root, 'staging', '.deploy.log'), 'utf8')).not.toContain(SECRET);
    const execLines = calls()
      .split(NL)
      .filter((l) => l.startsWith('docker exec'));
    expect(execLines.length).toBeGreaterThanOrEqual(2); // preflight + pembacaan schema_migrations
    for (const line of execLines) expect(line).toContain('-e MYSQL_PWD qc-staging-db mariadb');
  });

  test('--dry-run menyebut pagar downgrade skema', async () => {
    expect((await run(`deploy staging ${SHA_NEW}`, ['--dry-run'])).out).toContain(
      'pagar downgrade skema',
    );
  });

  test('pengembalian otomatis (versi baru tak sehat) tidak memanggil pagar lagi', async () => {
    setApplied([M1]);
    setImage(SHA_NEW, [M1, M2]);
    setImage(SHA_BAD, [M1, M2]);
    writeFileSync(join(state, 'unhealthy_tags'), `${SHA_BAD}${NL}`);
    const result = await run(`deploy staging ${SHA_BAD}`);
    expect(result.code).toBe(1);
    expect(guardCalls().filter((l) => l.includes('--entrypoint ls')).length).toBe(1);
  });
});

describe('deploy.sh: uji lewat nginx dari dalam VPS', () => {
  const withOrigin = (origin: string) =>
    writeFileSync(join(root, 'staging', '.env'), envFile(`APP_ORIGIN=${origin}\n`));
  const nginxCalls = () =>
    calls()
      .split('\n')
      .filter((l) => l.includes('--resolve'));

  test('lulus: curl memakai --resolve host:443:127.0.0.1 dan -k, setelah ping lokal; keluaran ke log', async () => {
    withOrigin('https://qc-dev.rhd.my.id');
    const result = await run(`deploy staging ${SHA_NEW}`);
    expect(result.code).toBe(0);
    const [line] = nginxCalls();
    expect(line).toContain('--resolve qc-dev.rhd.my.id:443:127.0.0.1');
    expect(line).toContain(' -k ');
    expect(line).toContain('https://qc-dev.rhd.my.id/api/ping');
    expect(calls().indexOf('http://127.0.0.1:8790/api/ping')).toBeLessThan(
      calls().indexOf('--resolve'),
    );
    expect(result.out).not.toContain('rahasia-uji');
    expect(readFileSync(join(root, 'staging', '.deploy.log'), 'utf8')).toContain(
      'curl nginx rahasia-uji',
    );
  });

  test('nginx menjawab bukan 2xx (curl exit 22, mis. 502): rollback, bukan kode 5, tanpa pembersihan image, rollback tak memanggil uji nginx', async () => {
    withOrigin('https://qc-dev.rhd.my.id');
    writeFileSync(
      join(state, 'images'),
      `${SHA_NEW}\n${'d'.repeat(40)}\n${'e'.repeat(40)}\n${'f'.repeat(40)}\n${'1'.repeat(40)}\n`,
    );
    writeFileSync(join(state, 'nginx_fail_tags'), `${SHA_BAD}\n`);
    const result = await run(`deploy staging ${SHA_BAD}`);
    expect(result.code).toBe(1);
    expect(result.out).toContain('uji lewat nginx gagal');
    expect(tagIn('staging')).toBe('tag-lama');
    expect(readFileSync(join(state, 'running'), 'utf8').trim()).toBe('tag-lama');
    expect(nginxCalls().length).toBe(5); // hanya percobaan deploy; rollback memakai sehat + ping lokal saja
    expect(calls()).not.toContain('image rm');
  });

  test('nginx tidak terjangkau (curl exit 7): kode 5, TANPA rollback, versi baru tetap aktif, tanpa pembersihan image', async () => {
    withOrigin('https://qc-dev.rhd.my.id');
    writeFileSync(
      join(state, 'images'),
      `${SHA_BAD}
${'d'.repeat(40)}
${'e'.repeat(40)}
${'f'.repeat(40)}
${'1'.repeat(40)}
`,
    );
    writeFileSync(join(state, 'nginx_down'), '1');
    const result = await run(`deploy staging ${SHA_BAD}`);
    expect(result.code).toBe(5);
    expect(result.out).toContain('nginx tidak terjangkau');
    expect(result.out).toContain('tidak dikembalikan');
    expect(result.out).not.toContain('rahasia-uji');
    expect(tagIn('staging')).toBe(SHA_BAD);
    expect(readFileSync(join(state, 'running'), 'utf8').trim()).toBe(SHA_BAD);
    expect((calls().match(/ up -d/g) ?? []).length).toBe(1);
    expect(calls()).not.toContain('image rm');
    expect(calls()).not.toContain('image ls');
    expect(existsSync(join(root, 'staging', '.deploy.lock'))).toBe(false);
  });

  test('gagal terus (juga setelah rollback): rollback tetap tidak mensyaratkan nginx, kode 1', async () => {
    withOrigin('https://qc-dev.rhd.my.id');
    writeFileSync(join(state, 'nginx_fail_all'), '1');
    const result = await run(`deploy staging ${SHA_BAD}`);
    expect(result.code).toBe(1);
    expect(tagIn('staging')).toBe('tag-lama');
  });

  for (const origin of [
    'http://localhost:3000',
    'https://x.example.com/path',
    'https://x.example.com:8443',
    '',
  ]) {
    test(`APP_ORIGIN ${JSON.stringify(origin)} tak valid/bukan https: dilewati dan sukses`, async () => {
      withOrigin(origin);
      writeFileSync(join(state, 'nginx_fail_all'), '1');
      const result = await run(`deploy staging ${SHA_NEW}`);
      expect(result.code).toBe(0);
      expect(result.out).toContain('uji lewat nginx dilewati');
      expect(nginxCalls()).toEqual([]);
    });
  }

  test('--dry-run menyebut uji nginx', async () => {
    const result = await run(`deploy staging ${SHA_NEW}`, ['--dry-run']);
    expect(result.out).toContain('lewat nginx');
  });
});

describe('deploy.sh: pembersihan image lama', () => {
  const sha = (ch: string) => ch.repeat(40);
  const [D, E, F, G, H] = ['d', 'e', 'f', '1', '2'].map(sha) as [
    string,
    string,
    string,
    string,
    string,
  ];
  // terurut dari yang terbaru dibuat (seperti `docker image ls`)
  const setImages = (...tags: string[]) =>
    writeFileSync(join(state, 'images'), `${tags.join('\n')}\n`);
  const removed = () => [...calls().matchAll(/^docker image rm (\S+)$/gm)].map((m) => m[1]);
  const REPO = 'ghcr.io/rahmadmrhd/qc-app';

  test('simpan 3 tag terbaru, tag lingkungan lain, tag baru; hapus sisanya satu per satu; tag tak valid dibiarkan', async () => {
    writeFileSync(
      join(root, 'production', '.env'),
      envFile().replace('QC_ENV=staging', 'QC_ENV=production').replace('tag-lama', G),
    );
    setImages(SHA_NEW, D, E, F, G, 'latest', H, 'tag-lama', 'local-abc1234');
    const result = await run(`deploy staging ${SHA_NEW}`);
    expect(result.code).toBe(0);
    // rank: SHA_NEW, D, E dipertahankan (3 terbaru); G dipakai production; 'tag-lama' (PREV) bukan tag valid
    expect(removed()).toEqual([`${REPO}:${F}`, `${REPO}:${H}`, `${REPO}:local-abc1234`]);
    expect(calls()).not.toMatch(/docker (system|image prune|volume prune)/);
    expect(calls()).not.toMatch(/image rm -f/);
    expect(result.out).toContain('dihapus=3');
    expect(result.out).not.toContain('rahasia-uji');
    expect(readFileSync(join(root, 'staging', '.deploy.log'), 'utf8')).toContain('rm rahasia-uji');
  });

  test('tag sebelumnya (PREV_TAG valid) dan tag kontainer berjalan dipertahankan', async () => {
    writeFileSync(join(root, 'staging', '.env'), envFile('', H));
    writeFileSync(join(state, 'running'), `${H}\n`);
    setImages(SHA_NEW, D, E, F, G, H);
    const result = await run(`deploy staging ${SHA_NEW}`);
    expect(result.code).toBe(0);
    expect(removed()).toEqual([`${REPO}:${F}`, `${REPO}:${G}`]);
  });

  test('QC_KEEP_IMAGES mengatur jumlah yang disimpan', async () => {
    writeFileSync(join(root, 'staging', '.env'), envFile('QC_KEEP_IMAGES=5\n'));
    setImages(SHA_NEW, D, E, F, G, H);
    expect((await run(`deploy staging ${SHA_NEW}`)).code).toBe(0);
    expect(removed()).toEqual([`${REPO}:${H}`]);
  });

  for (const bad of ['0', 'abc', '-1', '100', '']) {
    test(`QC_KEEP_IMAGES tak sah (${JSON.stringify(bad)}) memakai bawaan 3`, async () => {
      writeFileSync(join(root, 'staging', '.env'), envFile(`QC_KEEP_IMAGES=${bad}\n`));
      setImages(SHA_NEW, D, E, F, G, H);
      expect((await run(`deploy staging ${SHA_NEW}`)).code).toBe(0);
      expect(removed()).toEqual([`${REPO}:${F}`, `${REPO}:${G}`, `${REPO}:${H}`]);
    });
  }

  test('QC_IMAGE di .env menentukan repositori yang dibersihkan', async () => {
    writeFileSync(join(root, 'staging', '.env'), envFile('QC_IMAGE=ghcr.io/org/lain\n'));
    setImages(SHA_NEW, D, E, F);
    expect((await run(`deploy staging ${SHA_NEW}`)).code).toBe(0);
    expect(removed()).toEqual([`ghcr.io/org/lain:${F}`]);
    expect(calls()).toMatch(/docker image ls ghcr\.io\/org\/lain /);
  });

  test('kegagalan image rm atau image ls tidak mengubah kode keluar 0', async () => {
    setImages(SHA_NEW, D, E, F, G);
    writeFileSync(join(state, 'rm_fail'), '1');
    const rm = await run(`deploy staging ${SHA_NEW}`);
    expect(rm.code).toBe(0);
    expect(rm.out).toContain('DEPLOY_OK');
    expect(rm.out).toContain('gagal/dilewati=2');
    rmSync(join(state, 'rm_fail'));
    writeFileSync(join(state, 'ls_fail'), '1');
    const ls = await run(`deploy staging ${SHA_OTHER}`);
    expect(ls.code).toBe(0);
    expect(ls.out).toContain('DEPLOY_OK');
  });

  test('tidak dijalankan saat deploy gagal atau dikembalikan', async () => {
    setImages(SHA_BAD, D, E, F, G, H);
    writeFileSync(join(state, 'unhealthy_tags'), `${SHA_BAD}\n`);
    expect((await run(`deploy staging ${SHA_BAD}`)).code).toBe(1);
    rmSync(join(state, 'unhealthy_tags'));
    writeFileSync(join(state, 'ping_fail_tags'), `${SHA_BAD}\n`);
    expect((await run(`deploy staging ${SHA_BAD}`)).code).toBe(1);
    rmSync(join(state, 'ping_fail_tags'));
    writeFileSync(join(state, 'pull_fail'), '1');
    expect((await run(`deploy staging ${SHA_BAD}`)).code).toBe(1);
    rmSync(join(state, 'pull_fail'));
    writeFileSync(join(state, 'up_fail'), '1');
    expect((await run(`deploy staging ${SHA_BAD}`)).code).toBe(4);
    expect(calls()).not.toContain('image rm');
    expect(calls()).not.toContain('image ls');
  });

  test('--dry-run mencetak rencana pembersihan tanpa menyentuh docker', async () => {
    const result = await run(`deploy staging ${SHA_NEW}`, ['--dry-run']);
    expect(result.code).toBe(0);
    expect(result.out).toContain('rencana pembersihan');
    expect(calls()).toBe('');
  });
});

describe('deploy.sh: folder instalasi', () => {
  test('ROOT = folder tempat skrip berada, tak bergantung pada HOME atau direktori kerja', async () => {
    const install = mkdtempSync(join(tmpdir(), 'qc-deploy-root-'));
    const elsewhere = mkdtempSync(join(tmpdir(), 'qc-deploy-cwd-'));
    try {
      writeFileSync(join(install, 'deploy.sh'), readFileSync(SCRIPT, 'utf8'));
      const proc = Bun.spawn(['bash', posix(join(install, 'deploy.sh')), '--dry-run'], {
        cwd: elsewhere,
        env: {
          ...process.env,
          HOME: posix(elsewhere),
          SSH_ORIGINAL_COMMAND: `deploy staging ${SHA_NEW}`,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const out = `${await new Response(proc.stdout).text()}${await new Response(proc.stderr).text()}`;
      expect(await proc.exited).toBe(0);
      const reported = /root=(.*)$/m.exec(out)?.[1]?.trim() ?? '';
      expect(reported.endsWith(basename(install))).toBe(true);
      expect(reported).not.toContain('/root/apps/qc-app');
    } finally {
      rmSync(install, { recursive: true, force: true });
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});
