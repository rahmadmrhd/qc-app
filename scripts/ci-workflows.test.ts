// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ekspresi GitHub Actions (`${{ }}`) memang ditulis literal di berkas yang diperiksa
// Penjaga keamanan workflow GitHub Actions tanpa GitHub: mengurai YAML dan menegakkan aturan yang tak boleh
// bergeser diam-diam (aksi dipatok SHA, tanpa StrictHostKeyChecking=no, exec hanya dari main, tanpa injeksi
// ekspresi di skrip, izin minimal). TIDAK menjalankan workflow: hasil nyata baru diketahui di GitHub (docs/ci-cd.md).
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT_DIR } from './paths';

interface Step {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  if?: string;
}
interface Job {
  needs?: string | string[];
  environment?: string;
  permissions?: Record<string, string>;
  steps?: Step[];
  env?: Record<string, string>;
}
interface Workflow {
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  concurrency?: { group: string; 'cancel-in-progress': boolean };
  jobs: Record<string, Job>;
}

const WORKFLOW_DIR = join(ROOT_DIR, '.github', 'workflows');
const read = (path: string) => readFileSync(join(ROOT_DIR, path), 'utf8').replace(/\r\n/g, '\n');
const parse = (text: string) => Bun.YAML.parse(text) as Workflow;

const workflowFiles = readdirSync(WORKFLOW_DIR).filter((name) => name.endsWith('.yml'));
const rawOf = (name: string) => read(`.github/workflows/${name}`);
/** Teks tanpa baris komentar: aturan ditegakkan pada kode, bukan pada penjelasan di komentar. */
const codeOf = (text: string) =>
  text
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
const MARIADB_ACTION = read('.github/actions/mariadb/action.yml');
const deployText = rawOf('deploy-server.yml');
const deploy = parse(deployText);

/** Semua nilai `uses:` dan isi `run:` dari satu workflow. */
function stepsOf(workflow: Workflow): Step[] {
  return Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);
}

describe('workflow: aturan umum (semua berkas)', () => {
  test('ada workflow yang diperiksa', () => {
    expect(workflowFiles).toContain('deploy-server.yml');
    expect(workflowFiles).toContain('test.yml');
  });

  test('semua aksi pihak ketiga dipatok ke SHA commit 40 heksa (atau aksi lokal ./)', () => {
    // deploy.yml (Apps Script lama) dikecualikan: dihapus di T34 (cutover), jadi tidak dipatok ulang.
    const texts = [
      ...workflowFiles.filter((name) => name !== 'deploy.yml').map(rawOf),
      MARIADB_ACTION,
    ].map(codeOf);
    for (const text of texts) {
      for (const match of text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
        const ref = match[1] as string;
        if (ref.startsWith('./')) continue;
        expect(ref, `aksi ${ref}`).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
      }
    }
  });

  test('tidak ada StrictHostKeyChecking=no atau known_hosts ke /dev/null', () => {
    for (const raw of [...workflowFiles.map(rawOf), MARIADB_ACTION]) {
      const text = codeOf(raw);
      expect(text).not.toMatch(/StrictHostKeyChecking[= ]+no/i);
      expect(text).not.toMatch(/UserKnownHostsFile[= ]+\/dev\/null/i);
      expect(text).not.toMatch(/ssh-keyscan[^\n]*>>?\s*[^\n]*known_hosts/i); // kunci host tak boleh dipercaya saat itu juga
    }
  });

  test('tiap workflow punya `permissions` tingkat atas', () => {
    for (const name of workflowFiles) expect(parse(rawOf(name)).permissions, name).toBeDefined();
  });

  test('workflow dengan pull_request_target tidak pernah merujuk head PR yang belum di-merge', () => {
    for (const name of workflowFiles) {
      const text = codeOf(rawOf(name));
      if (text.includes('pull_request_target')) {
        expect(text, name).not.toMatch(/pull_request\.head/);
      }
    }
  });
});

describe('deploy-server.yml: keamanan', () => {
  test('pemicu: push ke main/dev/feat/migrasi-cloudflare dan workflow_dispatch; tanpa pull_request(_target)', () => {
    const triggers = Object.keys(deploy.on ?? {});
    expect(triggers.sort()).toEqual(['push', 'workflow_dispatch']);
    const push = (deploy.on as { push: { branches: string[] } }).push;
    expect([...push.branches].sort()).toEqual(['dev', 'feat/migrasi-cloudflare', 'main']);
    expect(codeOf(deployText)).not.toContain('pull_request');
  });

  test('izin minimal: contents read tingkat atas; hanya job image menulis packages; job deploy tanpa izin', () => {
    expect(deploy.permissions).toEqual({ contents: 'read' });
    for (const [name, job] of Object.entries(deploy.jobs)) {
      const write = Object.entries(job.permissions ?? {}).filter(([, level]) => level === 'write');
      if (name === 'image') expect(write).toEqual([['packages', 'write']]);
      else expect(write, name).toEqual([]);
    }
    expect(deploy.jobs.deploy?.permissions).toEqual({});
  });

  test('skrip `run` tanpa interpolasi ${{ }} (tidak ada injeksi ekspresi); nilai lewat env', () => {
    for (const step of stepsOf(deploy)) {
      if (step.run) expect(step.run, step.name).not.toContain('${{');
    }
  });

  test('job deploy: environment dari job meta, tanpa checkout, rahasia hanya di sini, antrean serial tanpa membatalkan', () => {
    const job = deploy.jobs.deploy as Job;
    expect(job.environment).toBe('${{ needs.meta.outputs.target }}');
    expect((job.steps ?? []).some((step) => step.uses?.startsWith('actions/checkout'))).toBe(false);
    for (const [name, other] of Object.entries(deploy.jobs)) {
      if (name === 'deploy') continue;
      expect(JSON.stringify(other), name).not.toMatch(/secrets\.DEPLOY_/);
    }
    expect(deploy.concurrency?.['cancel-in-progress']).toBe(false);
    expect(deploy.concurrency?.group).toContain('deploy-server-');
  });

  test('checkout tanpa menyimpan kredensial git di runner', () => {
    for (const step of stepsOf(deploy)) {
      if (step.uses?.startsWith('actions/checkout')) {
        expect(step.with?.['persist-credentials'], step.name ?? 'checkout').toBe(false);
      }
    }
  });

  test('perintah SSH sesuai kontrak deploy.sh: `deploy <dev|exec> <sha 40 heksa>` diterima, kunci --only dicocokkan', async () => {
    const deployStep = (deploy.jobs.deploy?.steps ?? []).find((s) => s.name === 'Deploy di VPS');
    expect(deployStep?.run).toContain('ssh qc-deploy "deploy $TARGET $TAG"');
    const sha = 'a'.repeat(40);
    for (const target of ['dev', 'exec']) {
      const proc = Bun.spawn(
        [
          'bash',
          join(ROOT_DIR, 'deploy', 'deploy.sh').replaceAll('\\', '/'),
          '--only',
          target,
          '--dry-run',
        ],
        {
          env: { ...process.env, SSH_ORIGINAL_COMMAND: `deploy ${target} ${sha}` },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      expect(await proc.exited, target).toBe(0);
    }
  });

  test('nama image di workflow sama dengan bawaan compose (ghcr.io/rahmadmrhd/qc-app)', () => {
    expect(deployText).toContain('ghcr.io/${GITHUB_REPOSITORY_OWNER,,}/qc-app');
    expect(read('deploy/compose.yml')).toContain('ghcr.io/rahmadmrhd/qc-app');
  });

  test('secret/variabel yang dipakai workflow semuanya tercatat di docs/ci-cd.md', () => {
    const doc = read('docs/ci-cd.md');
    const used = new Set<string>();
    for (const match of deployText.matchAll(/\b(?:secrets|vars)\.([A-Z_]+)/g)) {
      if (match[1] !== 'GITHUB_TOKEN') used.add(match[1] as string);
    }
    expect([...used].sort()).toEqual([
      'APP_URL',
      'DEPLOY_HOST',
      'DEPLOY_HOST_KEY',
      'DEPLOY_PORT',
      'DEPLOY_SSH_KEY',
      'DEPLOY_USER',
    ]);
    for (const name of used) expect(doc, name).toContain(name);
  });
});

describe('deploy-server.yml: pemilihan environment (menjalankan skrip job `meta`)', () => {
  const script = (deploy.jobs.meta?.steps ?? []).find((s) => s.id === 'select')?.run ?? '';
  const dir = mkdtempSync(join(tmpdir(), 'qc-ci-select-'));

  async function select(
    event: string,
    ref: string,
    input = '',
  ): Promise<{ code: number; target: string }> {
    const out = join(dir, `${crypto.randomUUID()}.out`);
    writeFileSync(out, '');
    const proc = Bun.spawn(['bash', '-c', script], {
      env: {
        ...process.env,
        EVENT_NAME: event,
        REF: ref,
        INPUT_TARGET: input,
        GITHUB_OUTPUT: out.replaceAll('\\', '/'),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const code = await proc.exited;
    return { code, target: /target=(\w+)/.exec(readFileSync(out, 'utf8'))?.[1] ?? '' };
  }

  test('skrip ditemukan', () => {
    expect(script).toContain('GITHUB_OUTPUT');
  });

  test('push: main -> exec; dev dan feat/migrasi-cloudflare -> dev; branch/tag lain ditolak', async () => {
    expect(await select('push', 'refs/heads/main')).toEqual({ code: 0, target: 'exec' });
    expect(await select('push', 'refs/heads/dev')).toEqual({ code: 0, target: 'dev' });
    expect(await select('push', 'refs/heads/feat/migrasi-cloudflare')).toEqual({
      code: 0,
      target: 'dev',
    });
    for (const ref of [
      'refs/heads/feat/lain',
      'refs/heads/main2',
      'refs/tags/v1',
      'refs/pull/1/merge',
      'refs/heads/dev/x',
    ]) {
      expect((await select('push', ref)).code, ref).toBe(1);
    }
  });

  test('dispatch: exec HANYA dari main; dev dari main/dev/feat; ref lain dan target aneh ditolak', async () => {
    expect(await select('workflow_dispatch', 'refs/heads/main', 'exec')).toEqual({
      code: 0,
      target: 'exec',
    });
    expect(await select('workflow_dispatch', 'refs/heads/main', 'dev')).toEqual({
      code: 0,
      target: 'dev',
    });
    expect(await select('workflow_dispatch', 'refs/heads/dev', 'dev')).toEqual({
      code: 0,
      target: 'dev',
    });
    expect(await select('workflow_dispatch', 'refs/heads/feat/migrasi-cloudflare', 'dev')).toEqual({
      code: 0,
      target: 'dev',
    });
    for (const ref of [
      'refs/heads/dev',
      'refs/heads/feat/migrasi-cloudflare',
      'refs/heads/feat/lain',
      'refs/tags/v1',
    ]) {
      expect((await select('workflow_dispatch', ref, 'exec')).code, `exec dari ${ref}`).toBe(1);
    }
    expect((await select('workflow_dispatch', 'refs/heads/feat/lain', 'dev')).code).toBe(1);
    for (const bad of ['', 'prod', 'DEV', 'dev;id', 'dev exec', '$(id)']) {
      expect((await select('workflow_dispatch', 'refs/heads/main', bad)).code, bad).toBe(1);
    }
  });

  test('pemicu lain (pull_request, schedule) ditolak', async () => {
    for (const event of ['pull_request', 'pull_request_target', 'schedule', '']) {
      expect((await select(event, 'refs/heads/main', 'exec')).code, event).toBe(1);
    }
  });

  test('bersihkan', () => {
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('test.yml dan aksi MariaDB', () => {
  const test_ = parse(rawOf('test.yml'));

  test('test.yml memakai aksi MariaDB bersama, bun dipatok, QC_TEST_DB_URL ke root:ci-only, tanpa tunnel', () => {
    const text = rawOf('test.yml');
    expect(text).toContain('uses: ./.github/actions/mariadb');
    expect(text).toContain('QC_TEST_DB_URL: mysql://root:ci-only@127.0.0.1:3306/');
    expect(text).toMatch(/bun-version: 1\.\d+\.\d+/);
    expect(text).not.toContain('bun-version: latest');
    expect(text).not.toContain('db:tunnel');
    expect(test_.on).toEqual({ pull_request: { types: ['opened', 'reopened', 'synchronize'] } });
  });

  test('aksi MariaDB memakai konfigurasi VPS (qc.cnf) dan image 11.8 yang sama dengan compose', () => {
    expect(MARIADB_ACTION).toContain('deploy/mariadb/qc.cnf:/etc/mysql/conf.d/qc.cnf:ro');
    expect(MARIADB_ACTION).toContain('mariadb:11.8');
    expect(read('deploy/compose.yml')).toContain('image: mariadb:11.8');
  });

  test('versi bun di workflow sama dengan Dockerfile', () => {
    const dockerVersion = /^ARG BUN_VERSION=(\S+)$/m.exec(read('Dockerfile'))?.[1];
    for (const text of [rawOf('test.yml'), deployText]) {
      expect(text).toContain(`bun-version: ${dockerVersion}`);
    }
  });
});
