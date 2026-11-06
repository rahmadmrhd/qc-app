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

/** Tidak dipasang di compose: login dev ditolak `loadConfig` di produksi; STATIC_DIR dan DB_POOL_SIZE memakai bawaan image/kode. */
const NOT_IN_COMPOSE = new Set(['DEV_LOGIN_EMAIL', 'STATIC_DIR', 'DB_POOL_SIZE']);
/** Tetap di compose/image (bukan pilihan operator di .env); DATABASE_URL disusun compose dari QC_DB_USER/QC_DB_PASSWORD/QC_DB_NAME. */
const NOT_IN_ENV_EXAMPLE = new Set([
  ...NOT_IN_COMPOSE,
  'HOST',
  'PORT',
  'NODE_ENV',
  'DATABASE_URL',
  'BACKUP_LOCAL_DIR', // tetap /var/backups/qc (volume qc-backups); bukan pilihan operator
]);

describe('deploy: variabel konfigurasi', () => {
  test('pembacaan config.ts terdeteksi (penjaga tes ini sendiri)', () => {
    const names = configVariables();
    for (const expected of ['DATABASE_URL', 'TRUSTED_PROXY', 'APP_ORIGIN', 'SYNC_API_TOKEN']) {
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
    const secretLike = ['SECRET', 'PASSWORD', 'TOKEN', 'SMTP_PASS', 'SESSION_SECRET'];
    for (const line of envExample.split('\n')) {
      const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
      if (!match || !secretLike.some((word) => (match[1] as string).includes(word))) continue;
      expect(match[2]).toMatch(/^(ganti[-\w]*|)$/);
    }
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

  test('pengguna non-root, HEALTHCHECK ke /api/ping, dengar 0.0.0.0 di kontainer', () => {
    expect(dockerfile).toMatch(/^USER bun$/m);
    expect(dockerfile).toContain('HEALTHCHECK');
    expect(dockerfile).toContain('/api/ping');
    expect(dockerfile).toContain('HOST=0.0.0.0');
  });

  test('tanpa rahasia di image: tidak ada ENV/ARG/COPY rahasia atau berkas .env', () => {
    expect(dockerfile).not.toMatch(/^(ENV|ARG)\s+\w*(SECRET|PASSWORD|TOKEN|KEY)\w*/im);
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
      'gas/*',
      'bridge/*',
    ]) {
      expect(lines).toContain(entry);
    }
    // package.json gas/bridge tetap masuk (bun.lock mencantumkan workspace-nya)
    expect(lines).toContain('!gas/package.json');
    expect(lines).toContain('!bridge/package.json');
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
