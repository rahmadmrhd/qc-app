// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ekspresi GitHub Actions (`${{ }}`) memang ditulis literal di berkas yang diperiksa
// Penjaga keamanan workflow GitHub Actions tanpa GitHub: mengurai YAML dan menegakkan aturan yang tak boleh
// bergeser diam-diam (aksi dipatok SHA, tanpa StrictHostKeyChecking=no, production hanya dari main, tanpa injeksi
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
  if?: string;
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
  test('ada workflow yang diperiksa; deploy GAS lama (deploy.yml) sudah dihapus saat cutover', () => {
    expect(workflowFiles).not.toContain('deploy.yml');
    expect(workflowFiles).toContain('deploy-server.yml');
    expect(workflowFiles).toContain('test.yml');
  });

  test('semua aksi pihak ketiga dipatok ke SHA commit 40 heksa (atau aksi lokal ./)', () => {
    const texts = [...workflowFiles.map(rawOf), MARIADB_ACTION].map(codeOf);
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
        expect(text, name).not.toMatch(/head_ref|\.head\.(sha|ref|repo|label)|refs\/pull\//);
      }
    }
  });
});

describe('deploy-server.yml: keamanan', () => {
  test('pemicu: PR di-merge ke dev/main (pull_request_target closed) dan dispatch; tanpa push dan tanpa pull_request biasa', () => {
    const on = deploy.on as {
      pull_request_target: { types: string[]; branches: string[] };
    };
    expect(Object.keys(on).sort()).toEqual(['pull_request_target', 'workflow_dispatch']);
    // keputusan pemilik 2026-11-06 (spek §11/§13.2): push langsung ke main/dev tidak men-deploy
    expect(on.pull_request_target.types).toEqual(['closed']);
    expect([...on.pull_request_target.branches].sort()).toEqual(['dev', 'main']);
    // `pull_request` (tanpa _target) menjalankan kode PR; `pull_request_target` dikunci pada merged (di bawah)
    expect(codeOf(deployText)).not.toMatch(/^\s*pull_request:/m);
  });

  test('cache build GHA ditulis hanya oleh workflow_dispatch (token pull_request_target ditolak menulis cache)', () => {
    expect(deployText).toMatch(/cache-to: ${{ github.event_name == 'workflow_dispatch' && /);
    expect(deployText).toContain('cache-from: type=gha,scope=qc-app');
  });

  test('pull_request_target: job meta hanya jalan bila PR merged; semua job lain bergantung padanya', () => {
    const metaIf = deploy.jobs.meta?.if ?? '';
    expect(metaIf).toContain("github.event_name != 'pull_request_target'");
    expect(metaIf).toContain('github.event.pull_request.merged == true');
    for (const [name, job] of Object.entries(deploy.jobs)) {
      if (name === 'meta') continue;
      expect([job.needs ?? []].flat(), name).toContain('meta');
    }
    // PR yang ditutup tanpa merge tidak menggantikan run deploy yang menunggu di antrean per environment
    expect(deploy.concurrency?.group).toContain('github.event.pull_request.merged != true');
  });

  test('checkout (fork PR tak mendapat kode/rahasia): hanya commit dari job meta (merge_commit_sha), tidak pernah head PR', () => {
    const checkouts = Object.values(deploy.jobs)
      .flatMap((job) => job.steps ?? [])
      .filter((step) => step.uses?.startsWith('actions/checkout'));
    expect(checkouts.length).toBeGreaterThan(0);
    for (const step of checkouts) {
      expect(step.with?.ref, 'checkout harus memakai ref dari meta').toBe(
        '${{ needs.meta.outputs.sha }}',
      );
    }
    const metaEnv = (deploy.jobs.meta?.steps ?? []).find((s) => s.id === 'select')?.env ?? {};
    expect(metaEnv.PR_MERGE_SHA).toBe('${{ github.event.pull_request.merge_commit_sha }}');
    // tag image = commit yang dibangun (bukan github.sha, yang pada pull_request_target = ujung branch tujuan)
    expect(deploy.jobs.image?.steps?.some((s) => JSON.stringify(s).includes('github.sha'))).toBe(
      false,
    );
    expect(codeOf(deployText)).not.toMatch(/pull_request\.head|head_ref|\.head\.(sha|ref|repo)/);
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

  test('uji asap publik dari runner informatif (continue-on-error + ::warning::); Ringkasan tetap if success()', () => {
    const steps = stepsOf(deploy);
    const smoke = steps.find((step) => step.name?.startsWith('Uji asap'));
    expect(smoke).toBeDefined();
    expect((smoke as Record<string, unknown>)['continue-on-error']).toBe(true);
    expect(smoke?.run).toContain('::warning::');
    expect(smoke?.run).not.toContain('::error::');
    const summary = steps.find((step) => step.name === 'Ringkasan');
    expect((summary as Record<string, unknown>).if).toBe('success()');
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

  test('perintah SSH sesuai kontrak deploy.sh: `deploy <staging|production> <sha 40 heksa>` diterima, kunci --only dicocokkan', async () => {
    const deployStep = (deploy.jobs.deploy?.steps ?? []).find((s) => s.name === 'Deploy di VPS');
    expect(deployStep?.run).toContain('ssh qc-deploy "deploy $TARGET $TAG"');
    const sha = 'a'.repeat(40);
    for (const target of ['staging', 'production']) {
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

  const GITHUB_SHA = 'a'.repeat(40);
  const MERGE_SHA = 'b'.repeat(40);

  interface PrEnv {
    merged?: string;
    base?: string;
    mergeSha?: string;
  }

  async function select(
    event: string,
    ref: string,
    input = '',
    pr: PrEnv = {},
  ): Promise<{ code: number; target: string; sha: string }> {
    const out = join(dir, `${crypto.randomUUID()}.out`);
    writeFileSync(out, '');
    const proc = Bun.spawn(['bash', '-c', script], {
      env: {
        ...process.env,
        EVENT_NAME: event,
        REF: ref,
        SHA: GITHUB_SHA,
        INPUT_TARGET: input,
        PR_MERGED: pr.merged ?? '',
        PR_BASE_REF: pr.base ?? '',
        PR_MERGE_SHA: pr.mergeSha ?? '',
        GITHUB_OUTPUT: out.replaceAll('\\', '/'),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const code = await proc.exited;
    const output = readFileSync(out, 'utf8');
    return {
      code,
      target: /target=(\w+)/.exec(output)?.[1] ?? '',
      sha: /sha=(\w+)/.exec(output)?.[1] ?? '',
    };
  }

  test('skrip ditemukan', () => {
    expect(script).toContain('GITHUB_OUTPUT');
  });

  test('push (tanpa PR) ditolak untuk semua ref, termasuk branch kerja lama', async () => {
    for (const ref of [
      'refs/heads/feat/migrasi-cloudflare',
      'refs/heads/main',
      'refs/heads/dev',
      'refs/heads/feat/lain',
      'refs/tags/v1',
    ]) {
      expect((await select('push', ref)).code, ref).toBe(1);
    }
  });

  test('pull_request_target: hanya PR merged; main -> production dan dev -> staging, yang dibangun = merge_commit_sha', async () => {
    const merged = { merged: 'true', mergeSha: MERGE_SHA };
    expect(
      await select('pull_request_target', 'refs/heads/main', '', { ...merged, base: 'main' }),
    ).toEqual({ code: 0, target: 'production', sha: MERGE_SHA });
    expect(
      await select('pull_request_target', 'refs/heads/dev', '', { ...merged, base: 'dev' }),
    ).toEqual({ code: 0, target: 'staging', sha: MERGE_SHA });
  });

  test('pull_request_target: PR belum merged, merge sha tak sah, branch tujuan tak cocok/tak dikenal ditolak', async () => {
    const ok = { merged: 'true', mergeSha: MERGE_SHA, base: 'main' };
    for (const merged of ['', 'false', 'True', '1']) {
      expect(
        (await select('pull_request_target', 'refs/heads/main', '', { ...ok, merged })).code,
        `merged=${merged}`,
      ).toBe(1);
    }
    for (const mergeSha of [
      '',
      'null',
      'g'.repeat(40),
      'a'.repeat(39),
      'A'.repeat(40),
      `${MERGE_SHA}\n`,
    ]) {
      expect(
        (await select('pull_request_target', 'refs/heads/main', '', { ...ok, mergeSha })).code,
        `mergeSha=${mergeSha}`,
      ).toBe(1);
    }
    // ref run harus sama dengan branch tujuan PR, dan hanya main/dev
    expect((await select('pull_request_target', 'refs/heads/dev', '', ok)).code).toBe(1);
    expect(
      (await select('pull_request_target', 'refs/heads/feat/x', '', { ...ok, base: 'feat/x' }))
        .code,
    ).toBe(1);
    expect(
      (await select('pull_request_target', 'refs/pull/1/merge', '', { ...ok, base: '' })).code,
    ).toBe(1);
  });

  test('dispatch: production HANYA dari main; staging dari main/dev; ref lain dan target aneh ditolak', async () => {
    expect(await select('workflow_dispatch', 'refs/heads/main', 'production')).toEqual({
      code: 0,
      target: 'production',
      sha: GITHUB_SHA,
    });
    expect(await select('workflow_dispatch', 'refs/heads/main', 'staging')).toEqual({
      code: 0,
      target: 'staging',
      sha: GITHUB_SHA,
    });
    expect(await select('workflow_dispatch', 'refs/heads/dev', 'staging')).toEqual({
      code: 0,
      target: 'staging',
      sha: GITHUB_SHA,
    });
    expect(
      (await select('workflow_dispatch', 'refs/heads/feat/migrasi-cloudflare', 'staging')).code,
    ).toBe(1);
    for (const ref of [
      'refs/heads/dev',
      'refs/heads/feat/migrasi-cloudflare',
      'refs/heads/feat/lain',
      'refs/tags/v1',
    ]) {
      expect(
        (await select('workflow_dispatch', ref, 'production')).code,
        `production dari ${ref}`,
      ).toBe(1);
    }
    expect((await select('workflow_dispatch', 'refs/heads/feat/lain', 'staging')).code).toBe(1);
    for (const bad of [
      '',
      'prod',
      'DEV',
      'dev',
      'exec',
      'staging;id',
      'staging production',
      '$(id)',
    ]) {
      expect((await select('workflow_dispatch', 'refs/heads/main', bad)).code, bad).toBe(1);
    }
  });

  test('pemicu lain (pull_request, schedule) ditolak; pull_request_target tanpa data PR yang sah juga ditolak', async () => {
    for (const event of ['pull_request', 'pull_request_target', 'schedule', '']) {
      expect((await select(event, 'refs/heads/main', 'production')).code, event).toBe(1);
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
