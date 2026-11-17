// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ekspresi GitHub Actions (`${{ }}`) memang ditulis literal di berkas yang diperiksa
// Penjaga keamanan workflow GitHub Actions tanpa GitHub: mengurai YAML dan menegakkan aturan yang tak boleh
// bergeser diam-diam (aksi dipatok SHA, tanpa StrictHostKeyChecking=no, production hanya dari main, tanpa injeksi
// ekspresi di skrip, izin minimal). TIDAK menjalankan workflow: hasil nyata baru diketahui di GitHub (docs/ci-cd.md).
import { describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
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
  name?: string;
  if?: string;
  needs?: string | string[];
  environment?: string;
  permissions?: Record<string, string>;
  steps?: Step[];
  env?: Record<string, string>;
  /** Job pemanggil workflow yang dapat dipanggil (`workflow_call`). */
  uses?: string;
  with?: Record<string, unknown>;
  outputs?: Record<string, string>;
  strategy?: { 'fail-fast'?: boolean; matrix?: Record<string, unknown> };
  'runs-on'?: string;
  defaults?: { run?: { shell?: string } };
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
const SETUP_ACTION = read('.github/actions/setup/action.yml');
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
    const texts = [...workflowFiles.map(rawOf), MARIADB_ACTION, SETUP_ACTION].map(codeOf);
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

  test('cache lapisan image lewat registry GHCR: ditulis job image untuk SEMUA event, tag per environment, tanpa cache GHA', () => {
    // Token pull_request_target ditolak menulis cache GHA, tetapi job image berizin packages: write sehingga boleh
    // menulis cache registry pada event apa pun; dengan begitu lapisan web-build dipakai ulang saat hanya server berubah.
    const build = (deploy.jobs.image?.steps ?? []).find((step) =>
      step.uses?.startsWith('docker/build-push-action'),
    );
    expect(String(build?.with?.['cache-to'])).toBe(
      'type=registry,ref=${{ steps.name.outputs.image }}:buildcache-${{ needs.meta.outputs.target }},mode=max,image-manifest=true,oci-mediatypes=true',
    );
    // Kebijakan baca cache ditentukan langkah `cache` (production tanpa cache; lihat tes di bawah).
    expect(build?.with?.['cache-from']).toBe('${{ steps.cache.outputs.cache_from }}');
    expect(build?.with?.['no-cache']).toBe('${{ steps.cache.outputs.no_cache }}');
    expect(codeOf(deployText)).not.toContain('type=gha');
    // cache-to tak bergantung pada jenis event (tak boleh tertukar menjadi "hanya dispatch" lagi)
    expect(String(build?.with?.['cache-to'])).not.toContain('github.event_name');
  });

  describe('kebijakan cache: production TANPA cache (keputusan pemilik 2026-11-17)', () => {
    // Cache registry dapat ditimpa penulis branch di repo ini (peracunan lapisan): production tak boleh memakainya,
    // dan tak cukup hanya tahap web-build karena lapisan RUN lain (bun install, apk add) juga dieksekusi di runtime.
    const step = (deploy.jobs.image?.steps ?? []).find((s) => s.id === 'cache');
    const script = step?.run ?? '';
    const dir = mkdtempSync(join(tmpdir(), 'qc-ci-cache-'));

    async function policy(target: string): Promise<{ code: number; output: string }> {
      const out = join(dir, `${crypto.randomUUID()}.out`);
      writeFileSync(out, '');
      const proc = Bun.spawn(['bash', '-c', script], {
        env: {
          ...process.env,
          TARGET: target,
          IMAGE: 'ghcr.io/pemilik/qc-app',
          GITHUB_OUTPUT: out.replaceAll('\\', '/'),
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const code = await proc.exited;
      return { code, output: readFileSync(out, 'utf8') };
    }

    test('langkah cache ada, memakai env (bukan ${{ }} di run), dan berjalan sebelum build', () => {
      expect(step).toBeDefined();
      expect(script).not.toContain('${{');
      expect(step?.env?.TARGET).toBe('${{ needs.meta.outputs.target }}');
      expect(step?.env?.IMAGE).toBe('${{ steps.name.outputs.image }}');
      const steps = deploy.jobs.image?.steps ?? [];
      const build = steps.findIndex((s) => s.uses?.startsWith('docker/build-push-action'));
      expect(steps.indexOf(step as Step)).toBeLessThan(build);
    });

    test('production: no_cache=true dan cache_from kosong', async () => {
      const result = await policy('production');
      expect(result.code).toBe(0);
      expect(result.output).toContain('no_cache=true');
      expect(result.output).toMatch(/cache_from=\n/);
      expect(result.output).not.toContain('type=registry');
    });

    test('staging: no_cache=false dan membaca kedua tag cache', async () => {
      const result = await policy('staging');
      expect(result.code).toBe(0);
      expect(result.output).toContain('no_cache=false');
      expect(result.output).toContain(
        'type=registry,ref=ghcr.io/pemilik/qc-app:buildcache-staging',
      );
      expect(result.output).toContain(
        'type=registry,ref=ghcr.io/pemilik/qc-app:buildcache-production',
      );
    });

    test('target tak dikenal ditolak (tidak diam-diam memakai cache)', async () => {
      for (const bad of ['', 'prod', 'staging;id', 'Production']) {
        expect((await policy(bad)).code, bad).toBe(1);
      }
    });

    test('bersihkan', () => {
      rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('job mark-deployed: penunjuk refs/deployed/<environment> (keputusan pemilik 2026-11-17)', () => {
    const job = deploy.jobs['mark-deployed'] as Job;
    const script = (job?.steps ?? []).find((s) => s.run)?.run ?? '';
    const dir = mkdtempSync(join(tmpdir(), 'qc-ci-mark-'));
    const SHA = 'c'.repeat(40);

    test('hanya sesudah deploy sukses; satu-satunya job dengan contents: write; tanpa checkout, aksi, dan rahasia', () => {
      expect(job).toBeDefined();
      expect([job.needs ?? []].flat().sort()).toEqual(['deploy', 'meta']);
      expect(job.if).toBe("needs.deploy.result == 'success'");
      expect(job.permissions).toEqual({ contents: 'write' });
      expect((job.steps ?? []).some((s) => s.uses)).toBe(false);
      expect(JSON.stringify(job)).not.toMatch(/secrets\.|UI_SIGNING_KEY|DEPLOY_/);
      expect(script).not.toContain('${{');
      expect(job.env).toEqual({
        GH_TOKEN: '${{ github.token }}',
        REPO: '${{ github.repository }}',
        TARGET: '${{ needs.meta.outputs.target }}',
        SHA: '${{ needs.meta.outputs.sha }}',
      });
    });

    async function mark(env: Record<string, string>, gh: string) {
      const bin = join(dir, `bin-${crypto.randomUUID()}`);
      mkdirSync(bin);
      const log = join(dir, `${crypto.randomUUID()}.log`);
      writeFileSync(log, '');
      writeFileSync(join(bin, 'gh'), `#!/usr/bin/env bash\necho "$*" >> "$LOG"\n${gh}\n`);
      chmodSync(join(bin, 'gh'), 0o755);
      const proc = Bun.spawn(['bash', '-c', script], {
        env: {
          ...process.env,
          PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
          LOG: log.replaceAll('\\', '/'),
          GH_TOKEN: 'token-palsu',
          REPO: 'pemilik/repo',
          TARGET: 'staging',
          SHA,
          ...env,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const code = await proc.exited;
      return {
        code,
        calls: readFileSync(log, 'utf8').split('\n').filter(Boolean),
        stdout: await new Response(proc.stdout).text(),
      };
    }

    test('ref sudah ada: memperbarui (PATCH, force) ke SHA yang di-deploy tanpa membuat baru', async () => {
      const result = await mark({}, 'exit 0');
      expect(result.code).toBe(0);
      expect(result.calls).toHaveLength(1);
      expect(result.calls[0]).toContain('-X PATCH');
      expect(result.calls[0]).toContain('repos/pemilik/repo/git/refs/deployed/staging');
      expect(result.calls[0]).toContain(`sha=${SHA}`);
      expect(result.calls[0]).toContain('force=true');
    });

    test('ref belum ada: PATCH gagal lalu dibuat (POST refs/deployed/production)', async () => {
      const result = await mark({ TARGET: 'production' }, 'case "$*" in *PATCH*) exit 1 ;; esac');
      expect(result.code).toBe(0);
      expect(result.calls).toHaveLength(2);
      expect(result.calls[1]).toContain('-X POST');
      expect(result.calls[1]).toContain('repos/pemilik/repo/git/refs');
      expect(result.calls[1]).toContain('ref=refs/deployed/production');
      expect(result.calls[1]).toContain(`sha=${SHA}`);
    });

    test('keduanya gagal: peringatan, bukan kegagalan job (deploy sudah sukses; akibatnya hanya membangun lebih banyak)', async () => {
      const result = await mark({}, 'exit 1');
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('::warning::');
    });

    test('TARGET atau SHA tak sah ditolak sebelum memanggil gh', async () => {
      for (const env of [
        { TARGET: 'staging;id' },
        { TARGET: '' },
        { TARGET: 'dev' },
        { SHA: 'abc' },
        { SHA: 'C'.repeat(40) },
        { SHA: `${'c'.repeat(39)}\n` },
      ]) {
        const result = await mark(env, 'exit 0');
        expect(result.code, JSON.stringify(env)).toBe(1);
        expect(result.calls, JSON.stringify(env)).toEqual([]);
      }
    });

    test('bersihkan', () => {
      rmSync(dir, { recursive: true, force: true });
    });
  });

  test('ci selektif: job ci memanggil ci.yml dengan commit dari meta dan nomor PR; image dan deploy bersyarat', () => {
    expect(deploy.jobs.check).toBeUndefined();
    const ci = deploy.jobs.ci as Job;
    expect(ci.uses).toBe('./.github/workflows/ci.yml');
    expect(ci.needs).toBe('meta');
    // Keputusan pemilik 2026-11-17: pada PR di-merge, perubahan dihitung SEJAK DEPLOY TERAKHIR environment itu
    // (refs/deployed/<env>), bukan dari berkas PR pemicu: PR yang dibuang antrean concurrency atau berlabel
    // skip-deploy tak membuat kodenya tertinggal. Dispatch = kosong = semua dijalankan.
    expect(ci.with).toEqual({
      ref: '${{ needs.meta.outputs.sha }}',
      'since-deploy':
        "${{ github.event_name == 'pull_request_target' && needs.meta.outputs.target || '' }}",
    });
    expect(codeOf(deployText)).not.toContain('secrets: inherit');
    // packages: read wajib walau ci memakainya hanya untuk uji bangun PR (validasi izin workflow dipanggil)
    expect(ci.permissions).toEqual({
      contents: 'read',
      'pull-requests': 'read',
      packages: 'read',
    });
    const image = deploy.jobs.image as Job;
    expect([image.needs ?? []].flat().sort()).toEqual(['ci', 'meta']);
    expect(image.if).toBe("needs.ci.outputs.image == 'true'");
    const dep = deploy.jobs.deploy as Job;
    expect([dep.needs ?? []].flat().sort()).toEqual(['ci', 'image', 'meta']);
    expect(dep.if).toBe("needs.image.result == 'success'");
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

  test('label skip-deploy: PR berlabel itu melewati deploy (meta dilewati) dan tak menggantikan run yang menunggu', () => {
    const skip = "contains(github.event.pull_request.labels.*.name, 'skip-deploy')";
    expect(deploy.jobs.meta?.if ?? '').toContain(`!${skip}`);
    expect(deploy.concurrency?.group).toContain(skip);
    // label tak boleh memengaruhi dispatch manual: kondisinya hanya untuk pull_request_target
    expect(deploy.jobs.meta?.if ?? '').toContain("github.event_name != 'pull_request_target' ||");
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
      else if (name === 'mark-deployed') expect(write).toEqual([['contents', 'write']]);
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
      'UI_PUBLIC_KEY_PEM',
      'UI_SIGNING_KEY',
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
      await select('pull_request_target', 'refs/heads/main', '', { ...merged, base: 'dev' }),
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
    // run pull_request_target hanya sah dari branch default main (REF), dan branch tujuan (PR_BASE_REF) hanya main/dev
    for (const ref of ['refs/heads/dev', 'refs/heads/feat/x', 'refs/pull/1/merge']) {
      expect((await select('pull_request_target', ref, '', ok)).code, ref).toBe(1);
    }
    for (const base of ['feat/x', 'main2', 'refs/heads/main', 'Main']) {
      expect(
        (await select('pull_request_target', 'refs/heads/main', '', { ...ok, base })).code,
        `base=${base}`,
      ).toBe(1);
    }
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

describe('deploy-server.yml: kunci tanda tangan manifest UI desktop', () => {
  const image = deploy.jobs.image as Job;
  const imageSteps = image.steps ?? [];
  const prepare = imageSteps.find((step) => step.id === 'ui-key');

  test('job image memakai environment target deploy (staging/production, tempat secret dan Variable pemilik) dan hanya ia yang membaca UI_SIGNING_KEY', () => {
    // Keputusan penempatan pemilik 2026-11-16: kunci ada di environment yang sama dengan target deploy, bukan
    // environment terpisah `ui-signing`; yang membatasi akses adalah aturan branch environment itu.
    expect(image.environment).toBe('${{ needs.meta.outputs.target }}');
    expect(deployText).not.toMatch(/environment:\s*ui-signing/);
    for (const [name, job] of Object.entries(deploy.jobs)) {
      if (name === 'image') continue;
      expect(JSON.stringify(job), name).not.toMatch(
        /UI_SIGNING_KEY|ui_signing_key|UI_PUBLIC_KEY_PEM/,
      );
    }
    // Satu-satunya pembaca secret: env langkah persiapan (nilai tak pernah di `run` atau input aksi).
    expect(codeOf(deployText).match(/secrets\.UI_SIGNING_KEY/g)).toHaveLength(1);
    expect(prepare?.env?.UI_SIGNING_KEY).toBe('${{ secrets.UI_SIGNING_KEY }}');
  });

  test('LARANGAN: workflow lain (test.yml dan seterusnya, yang berjalan pada pull_request) tak menyebut kunci tanda tangan', () => {
    for (const name of workflowFiles) {
      if (name === 'deploy-server.yml') continue;
      expect(rawOf(name), name).not.toMatch(/UI_SIGNING_KEY|ui_signing_key|ui-signing/i);
    }
  });

  test('kunci privat ke build lewat secret-files dari langkah persiapan (bukan `secrets:`), kunci publik lewat build-args, berkas dihapus di akhir', () => {
    const build = imageSteps.find((step) => step.uses?.startsWith('docker/build-push-action'));
    expect(build?.with?.['secret-files']).toBe('${{ steps.ui-key.outputs.secret_files }}');
    expect(build?.with).not.toHaveProperty('secrets');
    // Kunci publik masuk build-args lewat output langkah persiapan (sudah dinormalkan satu baris), bukan `vars.` mentah.
    expect(String(build?.with?.['build-args'])).toContain(
      'UI_PUBLIC_KEY_PEM=${{ steps.ui-key.outputs.public_key }}',
    );
    expect(prepare?.env?.UI_PUBLIC_KEY_PEM).toBe('${{ vars.UI_PUBLIC_KEY_PEM }}');
    expect(imageSteps.indexOf(prepare as Step)).toBeLessThan(imageSteps.indexOf(build as Step));
    const cleanup = imageSteps.at(-1);
    expect(cleanup?.if).toBe('always()');
    expect(cleanup?.run).toContain('ui_signing_key.pem');
  });

  describe('skrip langkah "Siapkan kunci tanda tangan UI"', () => {
    const script = prepare?.run ?? '';
    const dir = mkdtempSync(join(tmpdir(), 'qc-ci-uikey-'));
    const unix = (path: string) => path.replaceAll('\\', '/');
    const ONE_LINE = 'MCowBQYDK2VwAyEAabcdefghijklmnopqrstuvwxyz0123456789ABCDEFG=';

    async function run(signingKey: string, publicKey: string) {
      const out = join(dir, `${crypto.randomUUID()}.out`);
      writeFileSync(out, '');
      const proc = Bun.spawn(['bash', '-c', script], {
        env: {
          ...process.env,
          UI_SIGNING_KEY: signingKey,
          UI_PUBLIC_KEY_PEM: publicKey,
          KEY_DIR: unix(dir),
          GITHUB_OUTPUT: unix(out),
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const code = await proc.exited;
      return {
        code,
        stdout: await new Response(proc.stdout).text(),
        output: readFileSync(out, 'utf8'),
      };
    }

    test('skrip ditemukan', () => {
      expect(script).toContain('GITHUB_OUTPUT');
    });

    test('keduanya kosong: lolos dengan peringatan dan tanpa secret-files (rollout aman, perilaku lama)', async () => {
      const result = await run('', '');
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('::warning::');
      expect(result.output).toBe('secret_files=\npublic_key=\n');
    });

    test('hanya salah satu terisi: GAGAL (konfigurasi setengah jadi)', async () => {
      for (const [signingKey, publicKey] of [
        ['rahasia', ''],
        ['', ONE_LINE],
      ] as const) {
        const result = await run(signingKey, publicKey);
        expect(result.code).toBe(1);
        expect(result.stdout).toContain('::error::');
        expect(result.output).toBe('');
      }
    });

    test('kunci publik dinormalkan jadi satu baris: PEM berbaris banyak (LF dan CRLF), PEM satu baris, `\\n` harfiah, dan base64 polos', async () => {
      const body = `${ONE_LINE.slice(0, 30)}\n${ONE_LINE.slice(30)}`;
      const header = '-----BEGIN PUBLIC KEY-----';
      const footer = '-----END PUBLIC KEY-----';
      const variants = [
        `${header}\n${body}\n${footer}`,
        `${header}\r\n${body.replace('\n', '\r\n')}\r\n${footer}\r\n`,
        `${header} ${ONE_LINE} ${footer}`,
        `${header}\\n${ONE_LINE}\\n${footer}`,
        ONE_LINE,
        `  ${ONE_LINE}\n`,
      ];
      for (const variant of variants) {
        const result = await run('rahasia', variant);
        expect(result.code, JSON.stringify(variant)).toBe(0);
        expect(result.output, JSON.stringify(variant)).toContain(`public_key=${ONE_LINE}\n`);
        rmSync(join(dir, 'ui_signing_key.pem'), { force: true });
      }
    });

    test('kunci publik yang bukan isi base64 GAGAL, tidak mencetak isinya, dan tidak menulis berkas kunci', async () => {
      for (const bad of ['bukan kunci!', '<script>alert(1)</script>', '$(id)', 'abc;def']) {
        const result = await run('rahasia', bad);
        expect(result.code, bad).toBe(1);
        expect(result.stdout, bad).toContain('::error::');
        expect(result.stdout, bad).not.toContain(bad);
        expect(result.output, bad).toBe('');
        expect(existsSync(join(dir, 'ui_signing_key.pem')), bad).toBe(false);
      }
    });

    test('keduanya terisi: berkas kunci ditulis utuh (berbaris banyak) dan jalurnya diteruskan lewat output', async () => {
      const secret = '-----BEGIN PRIVATE KEY-----\nAAAA\nBBBB\n-----END PRIVATE KEY-----';
      const result = await run(secret, ONE_LINE);
      expect(result.code).toBe(0);
      expect(result.output).toBe(
        `secret_files=ui_signing_key=${unix(dir)}/ui_signing_key.pem\npublic_key=${ONE_LINE}\n`,
      );
      expect(readFileSync(join(dir, 'ui_signing_key.pem'), 'utf8')).toBe(`${secret}\n`);
      // isi kunci tak pernah dicetak ke log
      expect(result.stdout).not.toContain('AAAA');
      rmSync(join(dir, 'ui_signing_key.pem'));
    });

    test('bersihkan', () => {
      rmSync(dir, { recursive: true, force: true });
    });
  });
});

describe('test.yml dan aksi MariaDB', () => {
  const test_ = parse(rawOf('test.yml'));

  test('test.yml: pemicu pull_request; job ci memanggil ci.yml dengan nomor PR dan izin baca PR', () => {
    expect(test_.on).toEqual({ pull_request: { types: ['opened', 'reopened', 'synchronize'] } });
    const ciJob = test_.jobs.ci as Job;
    expect(ciJob.uses).toBe('./.github/workflows/ci.yml');
    expect(ciJob.with).toEqual({
      pr: '${{ github.event.pull_request.number }}',
      'build-image': true,
      'desktop-check': true,
    });
    // packages: read wajib walau hanya dipakai job image-check (GitHub memvalidasi izin job di workflow dipanggil)
    expect(ciJob.permissions).toEqual({
      contents: 'read',
      'pull-requests': 'read',
      packages: 'read',
    });
    // job image di test.yml dihapus: ia akan berjalan SERIAL setelah seluruh ci.yml (output workflow dipanggil)
    expect(Object.keys(test_.jobs).sort()).toEqual(['ci', 'test']);
  });

  test('MariaDB uji dan bun dipatok kini hidup di ci.yml/aksi setup (QC_TEST_DB_URL ke root:ci-only, tanpa tunnel)', () => {
    const text = rawOf('ci.yml');
    expect(text).toContain('uses: ./.github/actions/mariadb');
    expect(text).toContain('QC_TEST_DB_URL: mysql://root:ci-only@127.0.0.1:3306/');
    expect(SETUP_ACTION).toMatch(/bun-version: 1\.\d+\.\d+/);
    expect(SETUP_ACTION).not.toContain('bun-version: latest');
    expect(text).not.toContain('db:tunnel');
    // test.yml sendiri tak lagi menjalankan tes/ build: semuanya lewat ci.yml dan job image
    expect(rawOf('test.yml')).not.toContain('bun run check');
    expect(rawOf('test.yml')).not.toContain('bun run build');
  });

  test('ci.yml job image-check: bersyarat (input build-image dan keluaran image), tanpa dorong, tanpa menulis cache, hanya baca paket', () => {
    const ci_ = parse(rawOf('ci.yml'));
    const image = ci_.jobs['image-check'] as Job;
    expect(image.needs).toBe('changes');
    expect(image.if).toBe("inputs.build-image && needs.changes.outputs.image == 'true'");
    expect(image.permissions).toEqual({ contents: 'read', packages: 'read' });
    const build = (image.steps ?? []).find((step) =>
      step.uses?.startsWith('docker/build-push-action'),
    );
    expect(build?.with?.push).toBe(false);
    expect(build?.with).not.toHaveProperty('cache-to');
    expect(String(build?.with?.['cache-from'])).toContain(':buildcache-staging');
    expect(String(build?.with?.['cache-from'])).toContain(':buildcache-production');
    const login = (image.steps ?? []).find((step) => step.uses?.startsWith('docker/login-action'));
    expect(login?.with?.password).toBe('${{ github.token }}');
    // test.yml tak memakai rahasia sama sekali
    expect(rawOf('test.yml')).not.toMatch(/secrets\./);
  });

  describe('gerbang `test` (nama check wajib branch protection)', () => {
    const gate = test_.jobs.test as Job;
    const script = (gate?.steps ?? []).find((step) => step.run)?.run ?? '';

    test('job `test` ada di test.yml, selalu jalan, menunggu ci, tanpa checkout', () => {
      expect(gate).toBeDefined();
      expect(gate.if).toBe('always()');
      expect(gate.needs).toBe('ci');
      expect((gate.steps ?? []).some((step) => step.uses?.startsWith('actions/checkout'))).toBe(
        false,
      );
      expect(gate.env).toEqual({ CI_RESULT: '${{ needs.ci.result }}' });
      expect(script).not.toContain('${{');
    });

    async function runGate(ciResult: string): Promise<number> {
      const proc = Bun.spawn(['bash', '-c', script], {
        env: { ...process.env, CI_RESULT: ciResult },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      return await proc.exited;
    }

    test('success dan skipped lulus; failure, cancelled, kosong, dan nilai aneh gagal', async () => {
      for (const [ciResult, expected] of [
        ['success', 0],
        ['skipped', 0],
        ['failure', 1],
        ['cancelled', 1],
        ['', 1],
        ['tak-dikenal', 1],
      ] as const) {
        expect(await runGate(ciResult), ciResult || '(kosong)').toBe(expected);
      }
    });
  });

  test('aksi MariaDB memakai konfigurasi VPS (qc.cnf) dan image 11.8 yang sama dengan compose', () => {
    expect(MARIADB_ACTION).toContain('deploy/mariadb/qc.cnf:/etc/mysql/conf.d/qc.cnf:ro');
    expect(MARIADB_ACTION).toContain('mariadb:11.8');
    expect(read('deploy/compose.yml')).toContain('image: mariadb:11.8');
  });

  test('versi bun di workflow sama dengan Dockerfile', () => {
    const dockerVersion = /^ARG BUN_VERSION=(\S+)$/m.exec(read('Dockerfile'))?.[1];
    // Semua berkas yang memasang bun (aksi setup bersama, ci.yml, dan workflow yang masih memasangnya sendiri).
    const withBun = [SETUP_ACTION, rawOf('ci.yml'), rawOf('test.yml'), deployText].filter((text) =>
      text.includes('oven-sh/setup-bun'),
    );
    expect(withBun.length).toBeGreaterThanOrEqual(2);
    for (const text of withBun) {
      expect(text).toContain(`bun-version: ${dockerVersion}`);
    }
  });
});

describe('ci.yml dan aksi setup (workflow yang dapat dipanggil)', () => {
  const ciText = rawOf('ci.yml');
  const ci = parse(ciText);
  const jobs = ci.jobs;
  const stepsOfJob = (name: string) => jobs[name]?.steps ?? [];

  test('pemicu hanya workflow_call dengan input ref, pr, build-image; izin tingkat atas contents read; output image', () => {
    const on = ci.on as {
      workflow_call: {
        inputs: Record<string, unknown>;
        outputs: Record<string, { value: string }>;
      };
    };
    expect(Object.keys(ci.on ?? {})).toEqual(['workflow_call']);
    expect(Object.keys(on.workflow_call.inputs).sort()).toEqual([
      'build-image',
      'desktop-check',
      'pr',
      'ref',
      'since-deploy',
    ]);
    expect(on.workflow_call.outputs.image?.value).toBe('${{ jobs.changes.outputs.image }}');
    expect(ci.permissions).toEqual({ contents: 'read' });
  });

  test('hanya job changes yang membaca PR (pull-requests: read); tak ada izin write', () => {
    for (const [name, job] of Object.entries(jobs)) {
      const levels = Object.entries(job.permissions ?? {});
      expect(
        levels.filter(([, level]) => level === 'write'),
        name,
      ).toEqual([]);
      if (name === 'changes') {
        expect(job.permissions).toEqual({ contents: 'read', 'pull-requests': 'read' });
      } else {
        expect(Object.keys(job.permissions ?? {}), name).not.toContain('pull-requests');
      }
    }
  });

  test('semua job selain changes bergantung pada changes', () => {
    for (const [name, job] of Object.entries(jobs)) {
      if (name === 'changes') continue;
      expect([job.needs ?? []].flat(), name).toContain('changes');
    }
  });

  test('checkout memakai ref dari input dan tanpa menyimpan kredensial', () => {
    const checkouts = Object.values(jobs)
      .flatMap((job) => job.steps ?? [])
      .filter((step) => step.uses?.startsWith('actions/checkout'));
    expect(checkouts.length).toBeGreaterThan(0);
    for (const step of checkouts) {
      expect(step.with?.ref).toBe('${{ inputs.ref }}');
      expect(step.with?.['persist-credentials']).toBe(false);
    }
  });

  test('tanpa rahasia: tak ada secrets.* dan tak ada kunci tanda tangan UI', () => {
    expect(codeOf(ciText)).not.toMatch(/secrets\./);
    expect(ciText).not.toMatch(/UI_SIGNING_KEY|ui_signing_key|UI_PUBLIC_KEY_PEM/);
    expect(codeOf(ciText)).not.toMatch(/pull_request\.head|head_ref|refs\/pull\//);
  });

  test('skrip run tanpa interpolasi ${{ }}', () => {
    for (const step of Object.values(jobs).flatMap((job) => job.steps ?? [])) {
      if (step.run) expect(step.run, step.name).not.toContain('${{');
    }
  });

  test('matrix server: 8 shard, fail-fast mati, MariaDB lokal, QC_TEST_SHARD dari matrix', () => {
    const server = jobs.server as Job;
    expect(server.strategy?.['fail-fast']).toBe(false);
    expect(server.strategy?.matrix?.shard).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(server.env?.QC_TEST_SHARD).toBe('${{ matrix.shard }}/8');
    expect(server.env?.QC_TEST_DB_URL).toBe('mysql://root:ci-only@127.0.0.1:3306/');
    expect(server.if).toContain("needs.changes.outputs.server_tests == 'true'");
    const uses = stepsOfJob('server').map((step) => step.uses);
    expect(uses).toContain('./.github/actions/mariadb');
    expect(uses).toContain('./.github/actions/setup');
    expect(stepsOfJob('server').some((step) => step.run === 'bun run --cwd server test')).toBe(
      true,
    );
    // Electron tak diunduh untuk job server/web (seperti Dockerfile)
    const setup = stepsOfJob('server').find((step) => step.uses === './.github/actions/setup');
    expect(setup?.with?.filter).toBe('!@qc/desktop');
  });

  test('job dipilih menurut keluaran changes: lint/scripts (code), web, desktop', () => {
    expect(jobs.lint?.if).toContain("needs.changes.outputs.code == 'true'");
    expect(jobs.scripts?.if).toContain("needs.changes.outputs.code == 'true'");
    expect(jobs.web?.if).toContain("needs.changes.outputs.web_tests == 'true'");
    expect(jobs.desktop?.if).toContain("needs.changes.outputs.desktop_tests == 'true'");
    expect(jobs.desktop?.if).toContain("needs.changes.outputs.desktop_pack == 'true'");
    // Pemeriksaan desktop hanya di PR (test.yml): deploy tak boleh tertahan gagalnya unduhan Electron/kemas desktop
    // (keputusan pemilik 2026-11-17: hanya uji build; pengemasan installer menunggu workflow rilis).
    expect(jobs.desktop?.if).toContain('inputs.desktop-check');
  });

  test('keluaran job changes memetakan ketujuh kunci ci-changes', () => {
    const outputs = jobs.changes?.outputs ?? {};
    for (const key of [
      'code',
      'server_tests',
      'web_tests',
      'shared_tests',
      'desktop_tests',
      'desktop_pack',
      'image',
    ]) {
      expect(outputs[key], key).toBe(`\${{ steps.detect.outputs.${key} }}`);
    }
  });

  test('job desktop: Windows, kemas x64 dan arm64, verifikasi keduanya, CRLF dimatikan sebelum checkout', () => {
    const desktop = jobs.desktop as Job;
    expect(desktop['runs-on']).toBe('windows-latest');
    expect(desktop.defaults?.run?.shell).toBe('bash');
    const runs = stepsOfJob('desktop')
      .map((step) => step.run ?? '')
      .join('\n');
    expect(runs).toContain('bun run --cwd desktop pack:all');
    expect(runs).toContain('verify-pack --arch x64');
    expect(runs).toContain('verify-pack --arch arm64');
    expect(runs).toContain('bun run build:web');
    const steps = stepsOfJob('desktop');
    const crlf = steps.findIndex((step) => (step.run ?? '').includes('core.autocrlf false'));
    const checkout = steps.findIndex((step) => step.uses?.startsWith('actions/checkout'));
    expect(crlf).toBeGreaterThanOrEqual(0);
    expect(crlf).toBeLessThan(checkout);
  });

  test('aksi setup: setup-bun, cache bun per bun.lock, filter lewat env (bukan ${{ }} di run)', () => {
    const action = Bun.YAML.parse(SETUP_ACTION) as {
      inputs: { filter: { default: string } };
      runs: { using: string; steps: Step[] };
    };
    expect(action.runs.using).toBe('composite');
    expect(action.inputs.filter.default).toBe('');
    expect(SETUP_ACTION).toContain('~/.bun/install/cache');
    expect(SETUP_ACTION).toContain("hashFiles('bun.lock')");
    const install = action.runs.steps.find((step) => step.run?.includes('bun install'));
    expect(install?.run).toContain('--frozen-lockfile');
    expect(install?.run).not.toContain('${{');
    expect(install?.env?.FILTER).toBe('${{ inputs.filter }}');
    expect(codeOf(SETUP_ACTION)).not.toMatch(/secrets\./);
  });

  describe('skrip langkah Deteksi (dengan `gh` palsu)', () => {
    const script = stepsOfJob('changes').find((step) => step.id === 'detect')?.run ?? '';
    const dir = mkdtempSync(join(tmpdir(), 'qc-ci-detect-'));
    const unix = (path: string) => path.replaceAll('\\', '/');

    async function detect(
      pr: string,
      gh: string,
      extra: Record<string, string> = {},
    ): Promise<{ code: number; output: Record<string, string>; stdout: string; stderr: string }> {
      const bin = join(dir, `bin-${crypto.randomUUID()}`);
      mkdirSync(bin);
      writeFileSync(join(bin, 'gh'), `#!/usr/bin/env bash\n${gh}\n`);
      chmodSync(join(bin, 'gh'), 0o755);
      const out = join(dir, `${crypto.randomUUID()}.out`);
      writeFileSync(out, '');
      const proc = Bun.spawn(['bash', '-c', script], {
        cwd: ROOT_DIR,
        env: {
          ...process.env,
          PATH: `${bin}${delimiter}${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
          GH_TOKEN: 'token-palsu',
          REPO: 'pemilik/repo',
          PR: pr,
          SINCE: '',
          HEAD_SHA: '',
          GITHUB_OUTPUT: unix(out),
          ...extra,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const code = await proc.exited;
      const output = Object.fromEntries(
        readFileSync(out, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => line.split('=') as [string, string]),
      );
      return {
        code,
        output,
        stdout: await new Response(proc.stdout).text(),
        stderr: await new Response(proc.stderr).text(),
      };
    }

    test('skrip ditemukan dan memakai previous_filename (rename) serta ci-changes.ts', () => {
      expect(script).toContain('previous_filename');
      expect(script).toContain('scripts/ci-changes.ts');
    });

    test('daftar berkas PR dari gh diklasifikasi: desktop + server -> image dan desktop_pack true', async () => {
      const result = await detect('12', 'printf "desktop/a.ts\\nserver/a.ts\\n"');
      expect(result.code).toBe(0);
      expect(result.output.image).toBe('true');
      expect(result.output.desktop_pack).toBe('true');
      expect(result.output.web_tests).toBe('false');
    });

    test('PR hanya docs: semua false', async () => {
      const result = await detect('12', 'printf "docs/a.md\\n"');
      expect(result.code).toBe(0);
      expect(Object.values(result.output).every((value) => value === 'false')).toBe(true);
    });

    test('gh gagal: semua true (fail-safe) dengan peringatan', async () => {
      const result = await detect('12', 'exit 1');
      expect(result.code).toBe(0);
      expect(Object.values(result.output).every((value) => value === 'true')).toBe(true);
      expect(result.stdout).toContain('::warning::');
    });

    test('tanpa nomor PR (dispatch) atau nomor tak sah: gh tak dipanggil dan semua true', async () => {
      for (const pr of ['', 'abc', '12; id']) {
        const result = await detect(pr, 'echo "gh dipanggil" >&2; exit 99');
        expect(result.code, pr).toBe(0);
        expect(result.stderr, pr).not.toContain('gh dipanggil');
        expect(
          Object.values(result.output).every((value) => value === 'true'),
          pr,
        ).toBe(true);
      }
    });

    describe('since-deploy: perubahan sejak deploy terakhir environment (refs/deployed/<env>)', () => {
      const BASE = 'a'.repeat(40);
      const HEAD = 'b'.repeat(40);
      /** `gh` palsu: ref deploy -> BASE; compare BASE...HEAD -> daftar berkas; selain itu galat (menandai pemakaian salah). */
      const ghOk = (files: string) =>
        [
          'case "$*" in',
          `  *git/ref/deployed/staging*) echo ${BASE} ;;`,
          `  *compare/${BASE}...${HEAD}*) printf '${files}' ;;`,
          '  *) echo "gh tak terduga: $*" >&2; exit 9 ;;',
          'esac',
        ].join('\n');
      const since = { SINCE: 'staging', HEAD_SHA: HEAD };

      test('desktop saja sejak deploy terakhir: image false (deploy dilewati), desktop_pack true', async () => {
        const result = await detect('', ghOk('desktop/a.ts\\n'), since);
        expect(result.code).toBe(0);
        expect(result.stderr).not.toContain('gh tak terduga');
        expect(result.output.image).toBe('false');
        expect(result.output.desktop_pack).toBe('true');
      });

      test('kode server dari PR yang tertinggal tetap terdeteksi walau PR terakhir hanya desktop', async () => {
        const result = await detect('', ghOk('server/src/a.ts\\ndesktop/b.ts\\n'), since);
        expect(result.output.image).toBe('true');
        expect(result.output.server_tests).toBe('true');
      });

      test('since menang atas nomor PR (deploy tak memakai berkas PR pemicu)', async () => {
        const result = await detect('12', ghOk('desktop/a.ts\\n'), since);
        expect(result.stderr).not.toContain('gh tak terduga');
        expect(result.output.image).toBe('false');
      });

      test('ref deploy belum ada (404) atau compare gagal: semua true dengan peringatan (aman: deploy)', async () => {
        const noRef = await detect('', 'case "$*" in *git/ref/*) exit 1 ;; esac', since);
        expect(noRef.code).toBe(0);
        expect(noRef.stdout).toContain('::warning::');
        expect(Object.values(noRef.output).every((value) => value === 'true')).toBe(true);
        const noCompare = await detect(
          '',
          `case "$*" in *git/ref/*) echo ${BASE} ;; *) exit 1 ;; esac`,
          since,
        );
        expect(noCompare.stdout).toContain('::warning::');
        expect(Object.values(noCompare.output).every((value) => value === 'true')).toBe(true);
      });

      test('SHA dasar atau kepala tak sah, atau since di luar staging/production: gh tak dipanggil, semua true', async () => {
        for (const extra of [
          { SINCE: 'staging', HEAD_SHA: 'bukan-sha' },
          { SINCE: 'staging', HEAD_SHA: '' },
          { SINCE: 'staging;id', HEAD_SHA: HEAD },
          { SINCE: 'dev', HEAD_SHA: HEAD },
        ]) {
          const result = await detect('', 'echo "gh dipanggil" >&2; exit 99', extra);
          expect(result.stderr, JSON.stringify(extra)).not.toContain('gh dipanggil');
          expect(
            Object.values(result.output).every((value) => value === 'true'),
            JSON.stringify(extra),
          ).toBe(true);
        }
        const badBase = await detect('', 'echo "bukan-sha"', since);
        expect(Object.values(badBase.output).every((value) => value === 'true')).toBe(true);
      });

      test('skrip memakai compare API dan ref deploy, tanpa ${{', () => {
        expect(script).toContain('compare/');
        expect(script).toContain('git/ref/deployed/');
        expect(script).not.toContain('${{');
      });
    });

    test('bersihkan', () => {
      rmSync(dir, { recursive: true, force: true });
    });
  });
});
