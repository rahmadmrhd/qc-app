// biome-ignore-all lint/suspicious/noTemplateCurlyInString: interpolasi compose (`${VAR}`) memang ditulis literal di berkas yang diperiksa
// Penjaga berkas penyebaran (tanpa Docker, tanpa DB): `docker` tidak ada di mesin pengembang, jadi tes ini hanya
// memeriksa KONSISTENSI statis Dockerfile, .dockerignore, compose.yml, dan .env.example dengan `config.ts`.
// Build image dan jalannya kontainer diverifikasi di Actions (T28) dan VPS dev (T27), bukan di sini.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_REQUEST_BODY_BYTES } from './http/body';

const ROOT = join(import.meta.dir, '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n');

const dockerfile = read('Dockerfile');
const dockerignore = read('.dockerignore');
const composeText = read('deploy/compose.yml');
const envExample = read('deploy/.env.example');
const configSource = read('server/src/config.ts');

interface ComposeFile {
  networks: { default: { ipam: { config: Array<{ subnet: string }> } } };
  services: Record<string, Record<string, unknown>>;
}
const compose = Bun.YAML.parse(composeText) as ComposeFile;

/** Semua variabel lingkungan yang dibaca `loadConfig` (`get('NAMA')` dan daftar `REQUIRED`). */
function configVariables(): string[] {
  const names = new Set<string>();
  for (const match of configSource.matchAll(/get\('([A-Z][A-Z0-9_]*)'\)/g)) {
    names.add(match[1] as string);
  }
  const required = /const REQUIRED = \[([^\]]*)\]/.exec(configSource)?.[1] ?? '';
  for (const match of required.matchAll(/'([A-Z][A-Z0-9_]*)'/g)) names.add(match[1] as string);
  return [...names].sort();
}

/**
 * Tidak dipasang di compose: login dev ditolak `loadConfig` di produksi; STATIC_DIR memakai bawaan image;
 * GIT_SHA diisi image sendiri lewat build-arg Dockerfile (bukan pilihan operator). DB_POOL_SIZE kini dipasang
 * (2026-11-23, keputusan pemilik: ukuran pool dapat diatur lewat .env).
 */
const NOT_IN_COMPOSE = new Set(['DEV_LOGIN_EMAIL', 'STATIC_DIR', 'GIT_SHA']);
/** Tetap di compose/image (bukan pilihan operator di .env); DATABASE_URL disusun compose dari QC_DB_USER/QC_DB_PASSWORD/QC_DB_NAME. */
const NOT_IN_ENV_EXAMPLE = new Set([
  ...NOT_IN_COMPOSE,
  'HOST',
  'PORT',
  'NODE_ENV',
  'DATABASE_URL',
  'BACKUP_LOCAL_DIR', // tetap /var/backups/qc (volume qc-backups); bukan pilihan operator
  'PROOF_STAGING_DIR', // tetap /var/lib/qc/proofs (volume qc-proofs); bukan pilihan operator
]);

describe('deploy: variabel konfigurasi', () => {
  test('pembacaan config.ts terdeteksi (penjaga tes ini sendiri)', () => {
    const names = configVariables();
    for (const expected of ['DATABASE_URL', 'TRUSTED_PROXY', 'APP_ORIGIN', 'SESSION_SECRET']) {
      expect(names).toContain(expected);
    }
  });

  test('setiap variabel config.ts diteruskan oleh qc-app di compose.yml', () => {
    const environment = (compose.services['qc-app']?.environment ?? {}) as Record<string, unknown>;
    const missing = configVariables().filter(
      (name) => !NOT_IN_COMPOSE.has(name) && !(name in environment),
    );
    expect(missing).toEqual([]);
  });

  test('setiap variabel config.ts yang dipilih operator ada di deploy/.env.example', () => {
    const lines = envExample.split('\n').map((line) => line.replace(/^#\s*/, ''));
    const missing = configVariables().filter(
      (name) => !NOT_IN_ENV_EXAMPLE.has(name) && !lines.some((line) => line.startsWith(`${name}=`)),
    );
    expect(missing).toEqual([]);
  });

  test('variabel Google/SMTP/ALERT yang dijanjikan rencana ada di compose dan .env.example', () => {
    const environment = (compose.services['qc-app']?.environment ?? {}) as Record<string, unknown>;
    for (const name of [
      'GOOGLE_SA_KEY_FILE',
      'GOOGLE_ROOT_FOLDER_ID',
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_SECURE',
      'SMTP_USER',
      'SMTP_PASS',
      'SMTP_FROM',
      'ALERT_TO',
    ]) {
      expect(name in environment).toBe(true);
      expect(envExample).toContain(`${name}=`);
    }
  });

  test('.env.example tanpa rahasia nyata: semua nilai berupa penanda ganti-*, contoh, atau kosong', () => {
    // 'PRIVATE_KEY' menjaring VAPID_PRIVATE_KEY tanpa ikut menjaring VAPID_PUBLIC_KEY (kunci publik memang boleh terisi).
    const secretLike = [
      'SECRET',
      'PASSWORD',
      'TOKEN',
      'SMTP_PASS',
      'SESSION_SECRET',
      'PRIVATE_KEY',
    ];
    for (const line of envExample.split('\n')) {
      const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
      if (!match || !secretLike.some((word) => (match[1] as string).includes(word))) continue;
      expect(match[2]).toMatch(/^(ganti[-\w]*|)$/);
    }
  });

  test('server/.env.example (pengembangan lokal): nilai rahasia hanya penanda ganti-*, dev-*, atau kosong', () => {
    const serverExample = read('server/.env.example');
    const secretLike = ['SECRET', 'PASSWORD', 'TOKEN', 'SMTP_PASS', 'PRIVATE_KEY'];
    for (const line of serverExample.split('\n')) {
      const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
      if (!match || !secretLike.some((word) => (match[1] as string).includes(word))) continue;
      expect(match[2]).toMatch(/^(ganti[-\w]*|dev-[-\w]*|)$/);
    }
  });

  test('compose memetakan tiap variabel VAPID ke variabel .env bernama sama (tanpa salah ketik yang membocorkan kunci privat)', () => {
    const environment = (compose.services['qc-app']?.environment ?? {}) as Record<string, string>;
    for (const name of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) {
      expect(String(environment[name])).toBe(`\${${name}:-}`);
    }
  });
});

describe('deploy: compose.yml qc-db membuat skema dan pengguna aplikasi', () => {
  const dbEnv = (compose.services['qc-db']?.environment ?? {}) as Record<string, string>;
  const appUrl = String(
    ((compose.services['qc-app']?.environment ?? {}) as Record<string, unknown>).DATABASE_URL,
  );
  test('DATABASE_URL = mysql://<MARIADB_USER>:<MARIADB_PASSWORD>@qc-db:3306/<MARIADB_DATABASE> (ekspresi persis sama)', () => {
    expect(dbEnv.MARIADB_USER).toBeString();
    expect(dbEnv.MARIADB_PASSWORD).toBeString();
    expect(dbEnv.MARIADB_DATABASE).toBeString();
    expect(appUrl).toBe(
      `mysql://${dbEnv.MARIADB_USER}:${dbEnv.MARIADB_PASSWORD}@qc-db:3306/${dbEnv.MARIADB_DATABASE}`,
    );
  });

  test('variabel yang dipakai (QC_DB_USER/PASSWORD/NAME) tercantum di .env.example', () => {
    const lines = envExample.split('\n').map((line) => line.replace(/^#\s*/, ''));
    for (const name of ['QC_DB_USER', 'QC_DB_PASSWORD', 'QC_DB_NAME']) {
      expect(
        lines.some((line) => line.startsWith(`${name}=`)),
        name,
      ).toBe(true);
    }
  });

  test('kolasi skema yang dibuat entrypoint = collation-server di qc.cnf (utf8mb4_nopad_bin), dan qc.cnf dipasang', () => {
    const cnf = read('deploy/mariadb/qc.cnf');
    expect(cnf).toMatch(/^collation-server=utf8mb4_nopad_bin$/m);
    expect(cnf).toMatch(/^character-set-server=utf8mb4$/m);
    expect(compose.services['qc-db']?.volumes).toContain(
      './mariadb/qc.cnf:/etc/mysql/conf.d/qc.cnf:ro',
    );
  });

  test('memori qc-db dapat diatur per lingkungan lewat .env, bawaan 512m/256M/32M (keputusan pemilik 2026-11-24)', () => {
    // Batas kontainer, buffer pool, dan cache Aria berasal dari variabel .env dengan bawaan VPS bersama.
    expect(compose.services['qc-db']?.mem_limit).toBe('${QC_DB_MEM_LIMIT:-512m}');
    // Dua variabel mariadbd dipasang lewat flag `command` (menang atas qc.cnf, tak bergantung izin baca qc.cnf).
    expect(compose.services['qc-db']?.command).toEqual([
      '--innodb-buffer-pool-size=${QC_DB_BUFFER_POOL:-256M}',
      '--aria-pagecache-buffer-size=${QC_DB_ARIA_CACHE:-32M}',
    ]);
    const lines = envExample.split('\n').map((line) => line.replace(/^#\s*/, ''));
    for (const name of ['QC_DB_MEM_LIMIT', 'QC_DB_BUFFER_POOL', 'QC_DB_ARIA_CACHE']) {
      expect(
        lines.some((line) => line.startsWith(`${name}=`)),
        name,
      ).toBe(true);
    }
  });

  test('qc.cnf tidak memuat ukuran cache memori (satu sumber: compose.yml), agar nilai .env tak dibayangi', () => {
    const cnf = read('deploy/mariadb/qc.cnf');
    expect(cnf).not.toMatch(/^innodb_buffer_pool_size=/m);
    expect(cnf).not.toMatch(/^aria_pagecache_buffer_size=/m);
    expect(cnf).toMatch(/^max_connections=40$/m);
  });
});

describe('deploy: compose.yml qc-app', () => {
  const app = compose.services['qc-app'] as Record<string, unknown>;

  test('port hanya ke loopback host, memori dibatasi, bergantung pada qc-db yang sehat', () => {
    expect(app.ports).toEqual(['127.0.0.1:${APP_PORT:?APP_PORT wajib diisi}:8788']);
    expect(app.mem_limit).toBe('256m');
    expect(app.restart).toBe('unless-stopped');
    expect(app.depends_on).toEqual({ 'qc-db': { condition: 'service_healthy' } });
  });

  test('image bertag variabel (bukan latest), tanpa env_file (rahasia qc-db tak ikut)', () => {
    expect(String(app.image)).toMatch(/:\$\{QC_IMAGE_TAG:\?/);
    expect(String(app.image)).not.toContain('latest');
    expect(app.env_file).toBeUndefined();
  });

  test('kunci Google dipasang baca-saja, tidak otomatis membuat direktori, ke /run/secrets/google-sa.json', () => {
    expect(app.volumes).toEqual([
      'qc-backups:/var/backups/qc',
      'qc-proofs:/var/lib/qc/proofs',
      {
        type: 'bind',
        source: '${QC_SECRETS_DIR:-./secrets}/google-sa.json',
        target: '/run/secrets/google-sa.json',
        read_only: true,
        bind: { create_host_path: false },
      },
    ]);
    const environment = app.environment as Record<string, string>;
    expect(environment.GOOGLE_SA_KEY_FILE).toContain('/run/secrets/google-sa.json');
  });

  test('cadangan (T30): volume qc-backups terdaftar, folder dump di image dimiliki bun dan klien MariaDB terpasang sebelum USER', () => {
    expect(Object.keys((compose as unknown as { volumes: object }).volumes)).toContain(
      'qc-backups',
    );
    const environment = app.environment as Record<string, string>;
    expect(environment.BACKUP_LOCAL_DIR).toBe('/var/backups/qc');
    const beforeUser = dockerfile.slice(0, dockerfile.indexOf('USER bun'));
    expect(beforeUser).toContain('apk add --no-cache mariadb-client');
    expect(beforeUser).toContain('mkdir -p /var/backups/qc');
    expect(beforeUser).toContain('chown bun:bun /var/backups/qc');
  });

  test('foto bukti QC: volume qc-proofs terdaftar, folder sementara di image dimiliki bun, PROOF_STAGING_DIR tetap ke volume itu', () => {
    expect(Object.keys((compose as unknown as { volumes: object }).volumes)).toContain('qc-proofs');
    const environment = app.environment as Record<string, string>;
    expect(environment.PROOF_STAGING_DIR).toBe('/var/lib/qc/proofs');
    expect('PROOF_STAGING_MAX_BYTES' in environment).toBe(true);
    expect(envExample).toContain('PROOF_STAGING_MAX_BYTES=');
    const beforeUser = dockerfile.slice(0, dockerfile.indexOf('USER bun'));
    expect(beforeUser).toContain('mkdir -p /var/lib/qc/proofs');
    expect(beforeUser).toContain('chown bun:bun /var/lib/qc/proofs');
  });

  test('CLI pemulihan (T31) ikut di image agar dapat dijalankan lewat docker exec', () => {
    expect(dockerfile).toContain('COPY scripts/restore-backup.ts scripts/restore-backup.ts');
  });

  test('subnet jaringan dipatok dari variabel (I5) dan tidak memakai kolam otomatis Docker', () => {
    const [config] = compose.networks.default.ipam.config;
    expect(config?.subnet).toMatch(/^\$\{QC_SUBNET:\?/);
    expect(envExample).toMatch(/^QC_SUBNET=10\.77\.10\.0\/24$/m);
  });

  test('contoh TRUSTED_PROXY memuat loopback dan subnet compose yang sama dengan QC_SUBNET', () => {
    const subnet = /^QC_SUBNET=(\S+)$/m.exec(envExample)?.[1];
    const proxy = /^TRUSTED_PROXY=(\S+)$/m.exec(envExample)?.[1];
    expect(subnet).toBeDefined();
    expect(proxy?.split(',')).toEqual(['127.0.0.1/32', '::1/128', subnet as string]);
  });

  test('nama proyek dan kontainer memakai QC_NAME (staging qc-staging dan production qc-production, tak bertabrakan dengan stack dev lama qc-dev)', () => {
    expect((compose as unknown as { name: string }).name).toMatch(/^\$\{QC_NAME:-qc-\$\{QC_ENV:\?/);
    expect(app.container_name).toBe('${QC_NAME:-qc-${QC_ENV}}-app');
    expect(compose.services['qc-db']?.container_name).toBe('${QC_NAME:-qc-${QC_ENV}}-db');
    expect(envExample).toMatch(/^# QC_NAME=qc-staging$/m);
  });

  test('contoh .env staging: lingkungan staging, skema/pengguna DB qc_dev diisi eksplisit (bukan diturunkan dari QC_ENV)', () => {
    expect(envExample).toMatch(/^QC_ENV=staging$/m);
    expect(envExample).toMatch(/^QC_DB_USER=qc_dev$/m);
    expect(envExample).toMatch(/^QC_DB_NAME=qc_dev$/m);
  });

  test('qc-db tidak berubah bentuknya: port hanya 127.0.0.1', () => {
    expect(compose.services['qc-db']?.ports).toEqual([
      '127.0.0.1:${DB_PORT:?DB_PORT wajib diisi}:3306',
    ]);
  });
});

describe('deploy: Dockerfile dan .dockerignore', () => {
  test('dasar oven/bun dengan versi dipatok (bukan latest), tahap build web dan dependensi produksi', () => {
    expect(dockerfile).toMatch(/^ARG BUN_VERSION=\d+\.\d+\.\d+$/m);
    expect(dockerfile).toContain('FROM oven/bun:${BUN_VERSION}-alpine');
    expect(dockerfile).not.toMatch(/:latest/);
    expect(dockerfile).toContain('bun run build');
    expect(dockerfile).toContain('bun install --frozen-lockfile --production --filter @qc/server');
  });

  test('migrasi dan hasil build web ikut image; start lewat main.ts (migrasi sebelum listen)', () => {
    expect(dockerfile).toContain('COPY server/migrations server/migrations');
    expect(dockerfile).toContain('COPY --from=web-build /app/server/dist server/dist');
    expect(dockerfile).toContain('ENTRYPOINT ["bun", "src/main.ts"]');
  });

  test('CHANGELOG server ikut image: dikecualikan dari **/*.md di .dockerignore dan disalin Dockerfile', () => {
    const lines = dockerignore.split('\n').map((line) => line.trim());
    expect(lines.indexOf('!server/CHANGELOG.md')).toBeGreaterThan(lines.indexOf('**/*.md'));
    expect(dockerfile).toContain('COPY server/CHANGELOG.md server/CHANGELOG.md');
  });

  test('SHA build: ARG GIT_SHA (bawaan unknown) diteruskan ke ENV GIT_SHA di tahap runtime, bukan di tahap build web', () => {
    expect(dockerfile).toMatch(/^ARG GIT_SHA=unknown$/m);
    expect(dockerfile).toMatch(/^ENV GIT_SHA=\$GIT_SHA$/m);
    const runtime = dockerfile.slice(dockerfile.indexOf('FROM base AS runtime'));
    expect(runtime).toMatch(/^ARG GIT_SHA=unknown$/m);
    expect(dockerfile.slice(0, dockerfile.indexOf('FROM base AS runtime'))).not.toContain(
      'GIT_SHA',
    );
  });

  test('pengguna non-root, HEALTHCHECK ke /api/ping, dengar 0.0.0.0 di kontainer', () => {
    expect(dockerfile).toMatch(/^USER bun$/m);
    expect(dockerfile).toContain('HEALTHCHECK');
    expect(dockerfile).toContain('/api/ping');
    expect(dockerfile).toContain('HOST=0.0.0.0');
  });

  test('tanpa rahasia di image: tidak ada ENV/ARG/COPY rahasia atau berkas .env', () => {
    // Satu-satunya pengecualian: `ARG UI_PUBLIC_KEY_PEM` = kunci PUBLIK tanda tangan UI desktop (bukan rahasia; kunci
    // privat hanya lewat secret BuildKit, dijaga `scripts/ui-manifest.test.ts` dan `scripts/ci-workflows.test.ts`).
    expect(dockerfile).not.toMatch(
      /^(ENV|ARG)\s+(?!UI_PUBLIC_KEY_PEM=)\w*(SECRET|PASSWORD|TOKEN|KEY)\w*/im,
    );
    expect(dockerfile).not.toMatch(/^ENV\s+UI_PUBLIC_KEY_PEM/im);
    expect(dockerfile).not.toMatch(/COPY[^\n]*\.env/);
    expect(dockerfile).not.toMatch(/google-sa/);
  });

  test('.dockerignore menyingkirkan rahasia, repositori, dokumentasi, dan aplikasi lama', () => {
    const lines = dockerignore.split('\n').map((line) => line.trim());
    for (const entry of [
      '.env',
      '.env.*',
      '**/.env',
      '**/node_modules',
      '.git',
      '.superpowers',
      'docs',
      'deploy',
      '**/*.key',
      '**/*.pem',
      '**/*-sa.json',
      '**/secrets',
    ]) {
      expect(lines).toContain(entry);
    }
    // gas/ dan bridge/ sudah dipensiunkan (T35): tak ada lagi pengecualian untuk keduanya
    expect(lines.some((line) => line.includes('gas/') || line.includes('bridge/'))).toBe(false);
  });
});

describe('deploy: nginx/qc.conf.example', () => {
  const nginx = read('deploy/nginx/qc.conf.example');
  const code = nginx
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
  const servers443 = code.split(/\nserver \{/).filter((block) => block.includes('listen 443'));

  /** "11m" -> byte (satuan nginx: k, m = pangkat 1024). */
  function nginxBytes(size: string): number {
    const match = /^(\d+)([km]?)$/i.exec(size);
    if (!match) throw new Error(`ukuran nginx tak dikenal: ${size}`);
    const unit = (match[2] ?? '').toLowerCase();
    const factor = unit === 'm' ? 1024 * 1024 : unit === 'k' ? 1024 : 1;
    return Number(match[1]) * factor;
  }

  test('dua blok TLS: staging qc-dev.rhd.my.id dan production qc.rhd.my.id, masing-masing dengan redirect 80', () => {
    expect(servers443).toHaveLength(2);
    expect(code).toContain('server_name qc-dev.rhd.my.id;');
    expect(code).toContain('server_name qc.rhd.my.id;');
    expect(code.match(/return 301 https:\/\/\$host\$request_uri;/g)).toHaveLength(2);
    expect(code).not.toContain('qc.dev.rhd.my.id');
  });

  test('proxy ke 127.0.0.1 pada port APP_PORT yang berbeda per lingkungan (bukan 8787 yang dilarang)', () => {
    const ports = [...code.matchAll(/proxy_pass http:\/\/127\.0\.0\.1:(\d+);/g)].map((m) => m[1]);
    expect(ports).toEqual(['8790', '8791']);
    expect(ports).not.toContain('8787');
    expect(envExample).toMatch(/^APP_PORT=8790$/m);
  });

  test('client_max_body_size >= batas badan terbesar server (MAX_REQUEST_BODY_BYTES) di kedua blok', () => {
    const sizes = [...code.matchAll(/client_max_body_size (\S+);/g)].map((m) => m[1] as string);
    expect(sizes).toHaveLength(2);
    for (const size of sizes) {
      expect(nginxBytes(size)).toBeGreaterThanOrEqual(MAX_REQUEST_BODY_BYTES);
      expect(nginxBytes(size)).toBeGreaterThanOrEqual(10 * 1024 * 1024 + 64 * 1024); // 10 MiB + overhead (T30a)
    }
  });

  test('real_ip Cloudflare di tiap blok; CF-Connecting-IP dari klien ditimpa $remote_addr', () => {
    for (const block of servers443) {
      expect(block).toContain('real_ip_header CF-Connecting-IP;');
      expect(block).toContain('real_ip_recursive off;');
      expect((block.match(/set_real_ip_from /g) ?? []).length).toBeGreaterThanOrEqual(20);
      expect(block).toContain('set_real_ip_from 173.245.48.0/20;');
      expect(block).toContain('set_real_ip_from 2400:cb00::/32;');
      expect(block).toContain('proxy_set_header CF-Connecting-IP $remote_addr;');
      expect(block).toContain('proxy_connect_timeout');
      expect(block).toContain('proxy_read_timeout');
    }
    expect(code).not.toMatch(/set_real_ip_from (0\.0\.0\.0\/0|::\/0)/);
  });

  test('log akses menyamarkan token tautan laporan (jalur dan Referer) di kedua blok TLS (S3)', () => {
    expect(code).toMatch(/map \$request_uri \$qc_log_uri \{/);
    expect(code).toContain('~^/laporan/');
    expect(code).toContain('~^/api/public/serial-reports/');
    // Tautan dashboard publik (2026-11-23): halaman klien dan API publiknya memuat token di jalur URL.
    expect(code).toContain('~^/dashboard-publik/');
    expect(code).toContain('~^/api/public/dashboards/');
    expect(code).toMatch(/~\/dashboard-publik\/\s+"\[disamarkan\]"/);
    expect(code).toContain('map $http_referer $qc_log_referer {');
    expect(code).toMatch(/log_format qc_masked [^;]*\$qc_log_uri[^;]*\$qc_log_referer/s);
    expect(code).not.toMatch(/log_format qc_masked [^;]*\$request_uri/s);
    expect(code).not.toMatch(/log_format qc_masked [^;]*\$request[ "]/s);
    for (const block of servers443) {
      expect(block).toContain('access_log /var/log/nginx/qc-access.log qc_masked;');
    }
  });

  test('sertifikat berupa placeholder yang membuat nginx -t gagal bila belum diganti; tanpa jalur nyata', () => {
    expect(code.match(/ssl_certificate\s+ISI_JALUR_SERTIFIKAT_ORIGIN_DI_SINI\.pem;/g)).toHaveLength(
      2,
    );
    expect(code.match(/ssl_certificate_key\s+ISI_JALUR_KUNCI_PRIVAT_DI_SINI\.key;/g)).toHaveLength(
      2,
    );
    expect(nginx).not.toMatch(/\/etc\/(ssl|letsencrypt|nginx\/ssl)/);
  });
});
