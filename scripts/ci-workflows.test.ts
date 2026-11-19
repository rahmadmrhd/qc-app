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
// Build image dan deploy ke VPS dipindah ke workflow yang dapat dipanggil (rencana rilis 2): deploy-server.yml (PR/dispatch),
// release.yml, dan deploy-tag.yml memakai langkah keamanan yang SAMA tanpa salinan.
const imageText = rawOf('server-image.yml');
const imageWf = parse(imageText);
const deployerText = rawOf('server-deploy.yml');
const deployer = parse(deployerText);
/** Ketiga berkas yang bersama-sama menggantikan deploy-server.yml lama. */
const serverPipelineTexts = [deployText, imageText, deployerText];
const serverPipeline = [deploy, imageWf, deployer];

/** Ekspresi cabang rilis di kelompok concurrency release.yml (server-v, gabungan-, desktop-v); satu-satunya pemakai `head.ref` event. */
const RELEASE_HEAD_REF_EXPR =
  /startsWith\(github\.event\.pull_request\.head\.ref, 'release\/(?:server-v|desktop-v|gabungan-)'\)/g;
/** Workflow rilis yang membaca data PR lewat API untuk pagar identitas (bukan kode head PR). */
const RELEASE_WORKFLOWS = ['release.yml'];

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
      let text = codeOf(rawOf(name));
      // Satu-satunya pengecualian: ekspresi KELOMPOK concurrency release.yml, yang hanya membedakan cabang rilis (`release/server-v…`,
      // `release/desktop-v…`, `release/gabungan-…`) dari merge lain ke main (agar merge biasa tak membatalkan run rilis yang
      // menunggu). Hanya dibaca sebagai teks ekspresi: tak ada checkout, `run`, atau output yang memakainya (dijaga tes release.yml).
      if (name === 'release.yml') text = text.replace(RELEASE_HEAD_REF_EXPR, '');
      if (text.includes('pull_request_target')) {
        expect(text, name).not.toMatch(/pull_request\.head/);
        // release.yml membaca data PR (cabang, repositori asal) lewat API untuk pagar identitas; itu
        // data, bukan kode yang dijalankan. Yang dijaga di sana: tak ada field `pull_request.head` dari event (di atas), tak
        // ada checkout selain github.sha/sha hasil meta, dan tak ada `refs/pull/` (tes khusus tiap workflow di bawah).
        if (RELEASE_WORKFLOWS.includes(name)) expect(text, name).not.toMatch(/refs\/pull\//);
        else expect(text, name).not.toMatch(/head_ref|\.head\.(sha|ref|repo|label)|refs\/pull\//);
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
    const build = (imageWf.jobs.image?.steps ?? []).find((step) =>
      step.uses?.startsWith('docker/build-push-action'),
    );
    expect(String(build?.with?.['cache-to'])).toBe(
      'type=registry,ref=${{ steps.name.outputs.image }}:buildcache-${{ inputs.target }},mode=max,image-manifest=true,oci-mediatypes=true',
    );
    // Kebijakan baca cache ditentukan langkah `cache` (production tanpa cache; lihat tes di bawah).
    expect(build?.with?.['cache-from']).toBe('${{ steps.cache.outputs.cache_from }}');
    expect(build?.with?.['no-cache']).toBe('${{ steps.cache.outputs.no_cache }}');
    for (const text of serverPipelineTexts) expect(codeOf(text)).not.toContain('type=gha');
    // cache-to tak bergantung pada jenis event (tak boleh tertukar menjadi "hanya dispatch" lagi)
    expect(String(build?.with?.['cache-to'])).not.toContain('github.event_name');
  });

  describe('kebijakan cache: production TANPA cache (keputusan pemilik 2026-11-17)', () => {
    // Cache registry dapat ditimpa penulis branch di repo ini (peracunan lapisan): production tak boleh memakainya,
    // dan tak cukup hanya tahap web-build karena lapisan RUN lain (bun install, apk add) juga dieksekusi di runtime.
    const step = (imageWf.jobs.image?.steps ?? []).find((s) => s.id === 'cache');
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
      expect(step?.env?.TARGET).toBe('${{ inputs.target }}');
      expect(step?.env?.IMAGE).toBe('${{ steps.name.outputs.image }}');
      const steps = imageWf.jobs.image?.steps ?? [];
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
    const job = deployer.jobs['mark-deployed'] as Job;
    const script = (job?.steps ?? []).find((s) => s.run)?.run ?? '';
    const dir = mkdtempSync(join(tmpdir(), 'qc-ci-mark-'));
    const SHA = 'c'.repeat(40);

    test('hanya sesudah deploy sukses; satu-satunya job dengan contents: write; tanpa checkout, aksi, dan rahasia', () => {
      expect(job).toBeDefined();
      expect([job.needs ?? []].flat()).toEqual(['deploy']);
      expect(job.if).toBe("needs.deploy.result == 'success'");
      expect(job.permissions).toEqual({ contents: 'write' });
      expect((job.steps ?? []).some((s) => s.uses)).toBe(false);
      expect(JSON.stringify(job)).not.toMatch(/secrets\.|UI_SIGNING_KEY|DEPLOY_/);
      expect(script).not.toContain('${{');
      expect(job.env).toEqual({
        GH_TOKEN: '${{ github.token }}',
        REPO: '${{ github.repository }}',
        TARGET: '${{ inputs.target }}',
        SHA: '${{ inputs.sha }}',
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
      const invalid: Record<string, string>[] = [
        { TARGET: 'staging;id' },
        { TARGET: '' },
        { TARGET: 'dev' },
        { SHA: 'abc' },
        { SHA: 'C'.repeat(40) },
        { SHA: `${'c'.repeat(39)}\n` },
      ];
      for (const env of invalid) {
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
    // Rahasia environment (kunci UI, SSH) dibaca job terpanggil lewat `environment:`-nya sendiri; pemanggil tak meneruskan
    // rahasia apa pun (`secrets: inherit` akan membuka rahasia repositori ke workflow terpanggil tanpa perlu).
    for (const text of serverPipelineTexts) expect(codeOf(text)).not.toContain('secrets: inherit');
    // packages: read wajib walau ci memakainya hanya untuk uji bangun PR (validasi izin workflow dipanggil)
    expect(ci.permissions).toEqual({
      contents: 'read',
      'pull-requests': 'read',
      packages: 'read',
    });
    // image dan deploy hanya memanggil workflow bersama (tanpa langkah sendiri).
    const image = deploy.jobs.image as Job;
    expect([image.needs ?? []].flat().sort()).toEqual(['ci', 'meta']);
    expect(image.if).toBe("needs.ci.outputs.image == 'true'");
    expect(image.uses).toBe('./.github/workflows/server-image.yml');
    expect(image.steps).toBeUndefined();
    expect(image.with).toEqual({
      target: '${{ needs.meta.outputs.target }}',
      sha: '${{ needs.meta.outputs.sha }}',
    });
    const dep = deploy.jobs.deploy as Job;
    expect([dep.needs ?? []].flat().sort()).toEqual(['ci', 'image', 'meta']);
    expect(dep.if).toBe("needs.image.result == 'success'");
    expect(dep.uses).toBe('./.github/workflows/server-deploy.yml');
    expect(dep.steps).toBeUndefined();
    expect(dep.with).toEqual({
      target: '${{ needs.meta.outputs.target }}',
      sha: '${{ needs.meta.outputs.sha }}',
    });
    expect(deploy.jobs['mark-deployed']).toBeUndefined();
  });

  test('server-image.yml dan server-deploy.yml: hanya workflow_call, inputs bertipe, dan environment dari input target', () => {
    for (const wf of [imageWf, deployer]) {
      expect(Object.keys(wf.on ?? {})).toEqual(['workflow_call']);
      const inputs = (wf.on as { workflow_call: { inputs: Record<string, { type: string }> } })
        .workflow_call.inputs;
      expect(inputs.target?.type).toBe('string');
      expect(inputs.sha?.type).toBe('string');
      expect(wf.permissions).toEqual({ contents: 'read' });
    }
    const imageInputs = (
      imageWf.on as {
        workflow_call: { inputs: Record<string, { type: string; default?: string }> };
      }
    ).workflow_call.inputs;
    expect(imageInputs['extra-tags']?.default).toBe('');
    const deployInputs = (
      deployer.on as {
        workflow_call: { inputs: Record<string, { type: string; default?: boolean }> };
      }
    ).workflow_call.inputs;
    expect(deployInputs['allow-schema-downgrade']).toMatchObject({
      type: 'boolean',
      default: false,
    });
    expect(imageWf.jobs.image?.environment).toBe('${{ inputs.target }}');
    expect(deployer.jobs.deploy?.environment).toBe('${{ inputs.target }}');
    expect(imageWf.jobs.image?.outputs).toEqual({ tag: '${{ inputs.sha }}' });
  });

  test('extra-tags divalidasi regex server-vX.Y.Z di langkah sendiri sebelum build, lewat env (bukan ${{ }} di run)', () => {
    const steps = imageWf.jobs.image?.steps ?? [];
    const validate = steps.find((s) => s.id === 'tags');
    expect(validate).toBeDefined();
    expect(validate?.env?.EXTRA_TAGS).toBe('${{ inputs.extra-tags }}');
    expect(validate?.run).not.toContain('${{');
    expect(validate?.run).toContain('^server-v[0-9]+\\.[0-9]+\\.[0-9]+$');
    const build = steps.find((s) => s.uses?.startsWith('docker/build-push-action'));
    expect(steps.indexOf(validate as Step)).toBeLessThan(steps.indexOf(build as Step));
    expect(String(build?.with?.tags)).toBe('${{ steps.tags.outputs.list }}');
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
    // deploy-server.yml sendiri tak men-checkout apa pun; satu-satunya checkout ada di server-image.yml dan memakai input `sha`
    // (yang diisi pemanggil dari output `meta`).
    expect(stepsOf(deploy).some((step) => step.uses?.startsWith('actions/checkout'))).toBe(false);
    expect(stepsOf(deployer).some((step) => step.uses?.startsWith('actions/checkout'))).toBe(false);
    const checkouts = stepsOf(imageWf).filter((step) => step.uses?.startsWith('actions/checkout'));
    expect(checkouts).toHaveLength(1);
    for (const step of checkouts) {
      expect(step.with?.ref, 'checkout harus memakai sha masukan').toBe('${{ inputs.sha }}');
    }
    const metaEnv = (deploy.jobs.meta?.steps ?? []).find((s) => s.id === 'select')?.env ?? {};
    expect(metaEnv.PR_MERGE_SHA).toBe('${{ github.event.pull_request.merge_commit_sha }}');
    // tag image = commit yang dibangun (bukan github.sha, yang pada pull_request_target = ujung branch tujuan)
    expect(imageWf.jobs.image?.steps?.some((s) => JSON.stringify(s).includes('github.sha'))).toBe(
      false,
    );
    for (const text of serverPipelineTexts) {
      expect(codeOf(text)).not.toMatch(/pull_request\.head|head_ref|\.head\.(sha|ref|repo)/);
    }
    // sha masukan divalidasi 40 heksa di workflow terpanggil sebelum dipakai (pemanggil lain, mis. dispatch, tak dipercaya)
    for (const wf of [imageWf, deployer]) {
      const validated = stepsOf(wf).some((s) => /\^\[0-9a-f\]\{40\}\$/.test(s.run ?? ''));
      expect(validated).toBe(true);
    }
  });

  test('izin minimal: contents read tingkat atas; hanya job image menulis packages; job deploy tanpa izin', () => {
    expect(deploy.permissions).toEqual({ contents: 'read' });
    // Pemanggil: izin job pemanggil adalah BATAS bagi job terpanggil, jadi `image` memberi packages: write dan `deploy`
    // memberi contents: write (hanya untuk mark-deployed di dalamnya).
    for (const [name, job] of Object.entries(deploy.jobs)) {
      const write = Object.entries(job.permissions ?? {}).filter(([, level]) => level === 'write');
      if (name === 'image') expect(write).toEqual([['packages', 'write']]);
      else if (name === 'deploy') expect(write).toEqual([['contents', 'write']]);
      else expect(write, name).toEqual([]);
    }
    // Terpanggil: hanya `image` menulis packages; `deploy` tanpa izin sama sekali; `mark-deployed` satu-satunya contents: write.
    for (const [name, job] of Object.entries(imageWf.jobs)) {
      const write = Object.entries(job.permissions ?? {}).filter(([, level]) => level === 'write');
      expect(write, name).toEqual([['packages', 'write']]);
    }
    expect(deployer.jobs.deploy?.permissions).toEqual({});
    expect(deployer.jobs['mark-deployed']?.permissions).toEqual({ contents: 'write' });
  });

  test('skrip `run` tanpa interpolasi ${{ }} (tidak ada injeksi ekspresi); nilai lewat env', () => {
    for (const wf of serverPipeline) {
      for (const step of stepsOf(wf)) {
        if (step.run) expect(step.run, step.name).not.toContain('${{');
      }
    }
  });

  test('uji asap publik dari runner informatif (continue-on-error + ::warning::); Ringkasan tetap if success()', () => {
    const steps = stepsOf(deployer);
    const smoke = steps.find((step) => step.name?.startsWith('Uji asap'));
    expect(smoke).toBeDefined();
    expect((smoke as Record<string, unknown>)['continue-on-error']).toBe(true);
    expect(smoke?.run).toContain('::warning::');
    expect(smoke?.run).not.toContain('::error::');
    const summary = steps.find((step) => step.name === 'Ringkasan');
    expect((summary as Record<string, unknown>).if).toBe('success()');
  });

  test('job deploy: environment dari job meta, tanpa checkout, rahasia hanya di sini, antrean serial tanpa membatalkan', () => {
    const job = deployer.jobs.deploy as Job;
    expect(job.environment).toBe('${{ inputs.target }}');
    expect((job.steps ?? []).some((step) => step.uses?.startsWith('actions/checkout'))).toBe(false);
    for (const [name, other] of Object.entries(deployer.jobs)) {
      if (name === 'deploy') continue;
      expect(JSON.stringify(other), name).not.toMatch(/secrets\.DEPLOY_/);
    }
    for (const text of [deployText, imageText]) expect(text).not.toMatch(/secrets\.DEPLOY_/);
    expect(deploy.concurrency?.['cancel-in-progress']).toBe(false);
    expect(deploy.concurrency?.group).toContain('deploy-server-');
  });

  test('checkout tanpa menyimpan kredensial git di runner', () => {
    for (const wf of serverPipeline) {
      for (const step of stepsOf(wf)) {
        if (step.uses?.startsWith('actions/checkout')) {
          expect(step.with?.['persist-credentials'], step.name ?? 'checkout').toBe(false);
        }
      }
    }
  });

  test('perintah SSH sesuai kontrak deploy.sh: `deploy <staging|production> <sha 40 heksa>` diterima, kunci --only dicocokkan', async () => {
    const deployStep = (deployer.jobs.deploy?.steps ?? []).find((s) => s.name === 'Deploy di VPS');
    // Pagar downgrade skema (rencana 3) menambah kata ` allow-schema-downgrade` hanya bila diminta eksplisit.
    expect(deployStep?.run).toContain('cmd="deploy $TARGET $TAG"');
    expect(deployStep?.run).toContain('ssh qc-deploy "$cmd"');
    expect(deployStep?.env?.ALLOW_DOWNGRADE).toBe('${{ inputs.allow-schema-downgrade }}');
    expect(deployStep?.run).toContain('^(true|false)$');
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
    expect(imageText).toContain('ghcr.io/${GITHUB_REPOSITORY_OWNER,,}/qc-app');
    expect(read('deploy/compose.yml')).toContain('ghcr.io/rahmadmrhd/qc-app');
  });

  test('secret/variabel yang dipakai workflow semuanya tercatat di docs/ci-cd.md', () => {
    const doc = read('docs/ci-cd.md');
    const used = new Set<string>();
    for (const text of serverPipelineTexts) {
      for (const match of text.matchAll(/\b(?:secrets|vars)\.([A-Z_]+)/g)) {
        if (match[1] !== 'GITHUB_TOKEN') used.add(match[1] as string);
      }
    }
    expect([...used].sort()).toEqual([
      'APP_URL',
      'DEPLOY_HOST',
      'DEPLOY_HOST_KEY',
      'DEPLOY_PORT',
      'DEPLOY_SSH_KEY',
      'DEPLOY_USER',
      'RELEASE_FLOW',
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
  const image = imageWf.jobs.image as Job;
  const imageSteps = image.steps ?? [];
  const prepare = imageSteps.find((step) => step.id === 'ui-key');

  test('job image memakai environment target deploy (staging/production, tempat secret dan Variable pemilik) dan hanya ia yang membaca UI_SIGNING_KEY', () => {
    // Keputusan penempatan pemilik 2026-11-16: kunci ada di environment yang sama dengan target deploy, bukan
    // environment terpisah `ui-signing`; yang membatasi akses adalah aturan branch environment itu.
    expect(image.environment).toBe('${{ inputs.target }}');
    for (const text of serverPipelineTexts) {
      expect(text).not.toMatch(/environment:\s*ui-signing/);
    }
    // Pemanggil dan workflow deploy tak boleh menyentuh kunci sama sekali.
    for (const wf of [deploy, deployer]) {
      for (const [name, job] of Object.entries(wf.jobs)) {
        expect(JSON.stringify(job), name).not.toMatch(
          /UI_SIGNING_KEY|ui_signing_key|UI_PUBLIC_KEY_PEM/,
        );
      }
    }
    // Satu-satunya pembaca secret: env langkah persiapan (nilai tak pernah di `run` atau input aksi).
    expect(codeOf(imageText).match(/secrets\.UI_SIGNING_KEY/g)).toHaveLength(1);
    expect(prepare?.env?.UI_SIGNING_KEY).toBe('${{ secrets.UI_SIGNING_KEY }}');
  });

  test('LARANGAN: workflow lain (test.yml dan seterusnya, yang berjalan pada pull_request) tak menyebut kunci tanda tangan', () => {
    for (const name of workflowFiles) {
      if (name === 'server-image.yml') continue; // satu-satunya workflow yang membangun image dan memakai kunci
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

  test('SHA commit yang dibangun diteruskan ke image sebagai build-arg GIT_SHA (dibaca /api/ping)', () => {
    const build = imageSteps.find((step) => step.uses?.startsWith('docker/build-push-action'));
    expect(String(build?.with?.['build-args'])).toContain('GIT_SHA=${{ inputs.sha }}');
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
    const withBun = [
      SETUP_ACTION,
      rawOf('ci.yml'),
      rawOf('test.yml'),
      rawOf('release.yml'),
      ...serverPipelineTexts,
    ].filter((text) => text.includes('oven-sh/setup-bun'));
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

  test('matrix web: 4 shard vitest (--shard=<i>/4), fail-fast mati, nilai shard lewat env (bukan ${{ }} di run)', () => {
    // Tes web ~7,6 menit dalam satu job (run PR 102): dibagi 4 job; vitest membagi berkas tes sendiri.
    const web = jobs.web as Job;
    expect(web.strategy?.['fail-fast']).toBe(false);
    expect(web.strategy?.matrix?.shard).toEqual([1, 2, 3, 4]);
    expect(web.name).toBe('web ${{ matrix.shard }}/4');
    expect(web.env?.WEB_TEST_SHARD).toBe('${{ matrix.shard }}/4');
    const run = stepsOfJob('web').find((step) => step.name === 'Tes web (shard)')?.run;
    expect(run).toBe('bun run --cwd web test --shard="$WEB_TEST_SHARD"');
    const setup = stepsOfJob('web').find((step) => step.uses === './.github/actions/setup');
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
      /**
       * `gh` palsu: ref deploy -> BASE; compare BASE...HEAD -> keluaran `--jq` skrip (baris 1 = status, baris 2 = jumlah
       * berkas, sisanya nama berkas); selain itu galat (menandai pemakaian salah). Hanya SATU panggilan compare tanpa
       * `--paginate`: daftar berkas hanya ada di halaman pertama dan maksimum 300 untuk seluruh perbandingan.
       */
      const ghOk = (files: string, status = 'ahead', count?: number) => {
        const n = count ?? files.split('\\n').filter(Boolean).length;
        return [
          'case "$*" in',
          `  *git/ref/deployed/staging*) echo ${BASE} ;;`,
          // ekspresi --jq skrip HARUS persis menghasilkan urutan status, jumlah, berkas (yang diurai skrip)
          `  *compare/${BASE}...${HEAD}*) case "$*" in *--paginate*) echo "paginate tak boleh" >&2; exit 8 ;; esac; case "$*" in *".status, ((.files // []) | length), ((.files // [])[] | .filename, (.previous_filename // empty))"*) ;; *) echo "ekspresi jq tak sesuai" >&2; exit 7 ;; esac; printf '${status}\\n${n}\\n${files}' ;;`,
          '  *) echo "gh tak terduga: $*" >&2; exit 9 ;;',
          'esac',
        ].join('\n');
      };
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

      test('dasar BUKAN leluhur commit ini (diverged/behind): semua true, tidak menghitung dari merge-base', async () => {
        // mis. refs/deployed/staging menunjuk commit main (dispatch staging dari main), lalu PR dev hanya-desktop di-merge
        for (const status of ['diverged', 'behind']) {
          const result = await detect('', ghOk('desktop/a.ts\\n', status), since);
          expect(result.stdout, status).toContain('::warning::');
          expect(
            Object.values(result.output).every((value) => value === 'true'),
            status,
          ).toBe(true);
        }
      });

      test('perbandingan identik tanpa berkas: semua true (tak ada yang dapat disimpulkan)', async () => {
        const result = await detect('', ghOk('', 'identical', 0), since);
        expect(Object.values(result.output).every((value) => value === 'true')).toBe(true);
      });

      test('300 berkas atau lebih (batas API compare, daftar terpotong): semua true; 299 masih dipakai', async () => {
        const many = (n: number) =>
          `${Array.from({ length: n }, (_, i) => `docs/f${i}.md`).join('\\n')}\\n`;
        const cut = await detect('', ghOk(many(300)), since);
        expect(cut.stdout).toContain('::warning::');
        expect(Object.values(cut.output).every((value) => value === 'true')).toBe(true);
        const ok = await detect('', ghOk(many(299)), since);
        expect(ok.stderr).not.toContain('paginate tak boleh');
        expect(Object.values(ok.output).every((value) => value === 'false')).toBe(true);
      });

      test('rename: jumlah berkas lebih kecil dari jumlah baris (nama lama ikut); 299 berkas + nama lama tidak dianggap terpotong', async () => {
        const many = `${Array.from({ length: 299 }, (_, i) => `docs/f${i}.md`).join('\\n')}\\ndocs/lama.md\\n`;
        const result = await detect('', ghOk(many, 'ahead', 299), since);
        expect(result.stdout).not.toContain('::warning::');
        expect(Object.values(result.output).every((value) => value === 'false')).toBe(true);
        // nama lama di folder server ikut memicu server walau nama barunya di docs
        const moved = await detect('', ghOk('docs/baru.md\\nserver/lama.ts\\n', 'ahead', 1), since);
        expect(moved.output.server_tests).toBe('true');
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

describe('changelog.yml: gerbang fragmen changelog di PR', () => {
  const text = rawOf('changelog.yml');
  const workflow = parse(text);
  const job = workflow.jobs.fragmen;
  const steps = job?.steps ?? [];

  test('pemicu: hanya pull_request (bukan pull_request_target); label dipasang/dilepas memicu ulang gerbang ini saja', () => {
    const on = workflow.on as { pull_request: { types: string[]; branches?: string[] } };
    expect(Object.keys(workflow.on ?? {})).toEqual(['pull_request']);
    expect([...on.pull_request.types].sort()).toEqual(
      ['labeled', 'opened', 'reopened', 'synchronize', 'unlabeled'].sort(),
    );
    // keputusan pemilik 2026-11-19: hanya PR ke `dev` (tempat fragmen menumpuk menjelang rilis), bukan PR ke cabang kerja
    expect(on.pull_request.branches).toEqual(['dev']);
    expect(codeOf(text)).not.toContain('pull_request_target');
    expect(workflow.concurrency?.['cancel-in-progress']).toBe(true);
    expect(workflow.concurrency?.group).toContain('github.event.pull_request.number');
  });

  test('izin minimal: baca isi dan berkas PR saja, tanpa rahasia', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(job?.permissions).toEqual({ contents: 'read', 'pull-requests': 'read' });
    expect(codeOf(text)).not.toMatch(/secrets\./);
  });

  test('checkout tanpa menyimpan kredensial; skrip run tanpa interpolasi ${{ }}; label lewat env', () => {
    const checkout = steps.find((step) => step.uses?.startsWith('actions/checkout'));
    expect(checkout?.with?.['persist-credentials']).toBe(false);
    for (const step of steps) if (step.run) expect(step.run, step.name).not.toContain('${{');
    const check = steps.find((step) => step.run?.includes('changelog-check'));
    expect(check?.env?.LABELS).toBe('${{ toJSON(github.event.pull_request.labels.*.name) }}');
  });

  test('token hanya di langkah yang memanggil API; langkah yang menjalankan kode dari checkout PR tanpa GH_TOKEN', () => {
    const fetchStep = steps.find((step) => step.run?.includes('gh api'));
    expect(fetchStep?.env?.GH_TOKEN).toBe('${{ github.token }}');
    expect(fetchStep?.env?.PR).toBe('${{ github.event.pull_request.number }}');
    expect(fetchStep?.run).not.toContain('bun run');
    const runners = steps.filter((step) => step.run?.includes('bun run'));
    expect(runners.length).toBeGreaterThan(0);
    for (const step of runners) {
      expect(step.env?.GH_TOKEN, step.name).toBeUndefined();
      expect(step.run, step.name).not.toContain('gh api');
    }
    expect(steps.indexOf(fetchStep as (typeof steps)[number])).toBeLessThan(
      steps.indexOf(runners[0] as (typeof steps)[number]),
    );
  });

  test('hanya berkas berstatus added dihitung sebagai fragmen baru; fragmen yang ada divalidasi untuk server dan desktop', () => {
    const script = steps.map((step) => step.run ?? '').join('\n');
    expect(script).toContain('select(.status == "added")');
    expect(script).not.toContain('!= "removed"');
    expect(script).toContain('bun run changelog validate server');
    expect(script).toContain('bun run changelog validate desktop');
  });

  test('docs/ci-cd.md menjelaskan gerbang dan label pelewat', () => {
    const doc = read('docs/ci-cd.md');
    expect(doc).toContain('changelog.yml');
    expect(doc).toContain('tanpa-changelog');
  });
});

describe('saklar mode rilis RELEASE_FLOW (keputusan pemilik 2026-11-18): deploy-server.yml dan komponen server release.yml tak pernah aktif bersamaan', () => {
  test('deploy-server.yml: merge ke main hanya men-deploy production bila RELEASE_FLOW BUKAN tag; staging dan dispatch tak terpengaruh', () => {
    const metaIf = deploy.jobs.meta?.if ?? '';
    expect(metaIf).toContain(
      "!(github.event_name == 'pull_request_target' && github.event.pull_request.base.ref == 'main' && vars.RELEASE_FLOW == 'tag')",
    );
    // run yang dilewati karena saklar tak boleh menggantikan run deploy yang menunggu di antrean production
    expect(deploy.concurrency?.group).toContain("vars.RELEASE_FLOW == 'tag'");
    // pemicu tetap memuat main (perilaku bawaan `langsung` tak berubah)
    const on = deploy.on as { pull_request_target: { branches: string[] } };
    expect([...on.pull_request_target.branches].sort()).toEqual(['dev', 'main']);
  });

  test('release.yml: saklar diputuskan skrip identitas (RELEASE_FLOW sebagai env, keluaran server_version kosong bila bukan tag); semua jalur server bergantung pada keluaran itu, jalur desktop tidak', () => {
    const release = parse(rawOf('release.yml'));
    const identity = (release.jobs.meta?.steps ?? []).find((s) => s.id === 'identity');
    expect(identity?.env?.RELEASE_FLOW).toBe('${{ vars.RELEASE_FLOW }}');
    expect(release.concurrency?.group).toContain("vars.RELEASE_FLOW == 'tag'");
    for (const name of ['guard', 'image', 'deploy', 'publish-server']) {
      expect(release.jobs[name]?.if ?? '', name).toContain(
        "needs.meta.outputs.server_version != ''",
      );
    }
    for (const name of ['build-desktop', 'publish-desktop']) {
      expect(release.jobs[name]?.if ?? '', name).toContain(
        "needs.meta.outputs.desktop_version != ''",
      );
      expect(release.jobs[name]?.if ?? '', name).not.toContain('RELEASE_FLOW');
    }
    // setiap job selain meta dan withdraw bergantung pada meta dan pada keluaran release
    for (const [name, job] of Object.entries(release.jobs)) {
      if (name === 'meta' || name === 'withdraw') continue;
      expect([job.needs ?? []].flat(), name).toContain('meta');
      expect(job.if ?? '', name).toContain("needs.meta.outputs.release == 'true'");
    }
  });
});

describe('release.yml: pipeline rilis server, desktop, atau gabungan dari PR rilis (rilis semver bagian 2, 4, dan rilis gabungan)', () => {
  const text = rawOf('release.yml');
  const release = parse(text);
  const jobs = release.jobs;
  const stepsOfJob = (name: string) => jobs[name]?.steps ?? [];
  const secretsOf = (name: string) =>
    [...JSON.stringify(jobs[name] ?? {}).matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]).sort();
  const writes = (name: string) =>
    Object.entries(jobs[name]?.permissions ?? {})
      .filter(([, level]) => level === 'write')
      .map(([scope]) => scope)
      .sort();

  test('pemicu: pull_request_target closed ke main dan workflow_dispatch (komponen, versi, tarik: semuanya opsional); tanpa push dan pull_request biasa', () => {
    const on = release.on as {
      pull_request_target: { types: string[]; branches: string[] };
      workflow_dispatch: { inputs: Record<string, { type: string; required: boolean }> };
    };
    expect(Object.keys(on).sort()).toEqual(['pull_request_target', 'workflow_dispatch']);
    expect(on.pull_request_target.types).toEqual(['closed']);
    expect(on.pull_request_target.branches).toEqual(['main']);
    expect(Object.keys(on.workflow_dispatch.inputs).sort()).toEqual(['komponen', 'tarik', 'versi']);
    for (const [name, input] of Object.entries(on.workflow_dispatch.inputs)) {
      expect(input.type, name).toBe('string');
      expect(input.required, name).toBe(false);
    }
    expect(codeOf(text)).not.toMatch(/^\s*pull_request:/m);
  });

  test('urutan job dan ketergantungan: satu meta, satu ci, jalur server (guard -> image -> deploy -> publish-server), jalur desktop (build-desktop -> publish-desktop), satu sync-dev, withdraw berdiri sendiri', () => {
    expect(Object.keys(jobs)).toEqual([
      'meta',
      'guard',
      'ci',
      'image',
      'deploy',
      'publish-server',
      'build-desktop',
      'publish-desktop',
      'sync-dev',
      'withdraw',
    ]);
    const needs = (name: string) => [jobs[name]?.needs ?? []].flat().sort();
    expect(needs('meta')).toEqual([]);
    expect(needs('guard')).toEqual(['meta']);
    expect(needs('ci')).toEqual(['guard', 'meta']);
    expect(needs('image')).toEqual(['ci', 'guard', 'meta']);
    expect(needs('deploy')).toEqual(['ci', 'guard', 'image', 'meta']);
    expect(needs('publish-server')).toEqual(['deploy', 'guard', 'meta']);
    expect(needs('build-desktop')).toEqual(['ci', 'meta']);
    // desktop baru diterbitkan setelah server production live (aplikasi baru tak sampai ke pengguna sebelum servernya)
    expect(needs('publish-desktop')).toEqual(['build-desktop', 'deploy', 'guard', 'meta']);
    expect(needs('sync-dev')).toEqual(['meta', 'publish-desktop', 'publish-server']);
    expect(needs('withdraw')).toEqual([]);
    expect(jobs.deploy?.if).toContain("needs.image.result == 'success'");
    expect(jobs['publish-server']?.if).toContain("needs.deploy.result == 'success'");
  });

  test('syarat job: meta untuk PR yang di-merge dan SEMUA dispatch selain penarikan murni (masukan salah kombinasi gagal keras di meta, bukan run hijau kosong); withdraw hanya untuk dispatch tarik murni', () => {
    expect(jobs.meta?.if).toContain("github.event_name == 'workflow_dispatch'");
    expect(jobs.meta?.if).toContain("inputs.tarik == ''");
    expect(jobs.meta?.if).toContain("inputs.komponen != ''");
    expect(jobs.meta?.if).toContain("inputs.versi != ''");
    expect(jobs.meta?.if).toContain('github.event.pull_request.merged == true');
    const resolve = stepsOfJob('meta').find((s) => s.id === 'resolve');
    expect(resolve?.env?.INPUT_TARIK).toBe('${{ inputs.tarik }}');
    expect(resolve?.run).toContain('Input tarik tidak boleh diisi bersama komponen atau versi.');
    expect(jobs.withdraw?.if).toContain("github.event_name == 'workflow_dispatch'");
    expect(jobs.withdraw?.if).toContain("inputs.tarik != ''");
    expect(jobs.withdraw?.if).toContain("inputs.versi == ''");
    expect(jobs.withdraw?.if).toContain("inputs.komponen == ''");
  });

  test('concurrency: server dan gabungan (saat tag) di kelompok production bersama deploy-server.yml, desktop di kelompok sendiri, sisanya kelompok lewati; tanpa membatalkan', () => {
    expect(release.concurrency?.['cancel-in-progress']).toBe(false);
    const group = release.concurrency?.group ?? '';
    expect(group).toContain("'deploy-server-production'");
    expect(group).toContain("'release-desktop'");
    expect(group).toContain("vars.RELEASE_FLOW == 'tag'");
    expect(group).toContain('github.event.pull_request.merged == true');
    expect(group).toContain("format('lewati-{0}', github.run_id)");
    // ekspresi cabang rilis hanya di kelompok concurrency (server-v, gabungan- untuk server dan desktop, desktop-v), bukan di run/env/if/checkout
    expect(codeOf(text).match(RELEASE_HEAD_REF_EXPR)).toHaveLength(4);
    expect(JSON.stringify({ ...release, concurrency: undefined })).not.toContain(
      'github.event.pull_request.head',
    );
  });

  test('izin: contents read tingkat atas; contents: write hanya publish-server, publish-desktop, dan batas deploy (mark-deployed); packages: write hanya image; sync-dev dan sisanya hanya baca', () => {
    expect(release.permissions).toEqual({ contents: 'read' });
    for (const name of ['meta', 'guard', 'ci', 'build-desktop', 'sync-dev', 'withdraw']) {
      expect(writes(name), name).toEqual([]);
    }
    expect(writes('image')).toEqual(['packages']);
    expect(writes('deploy')).toEqual(['contents']);
    expect(writes('publish-server')).toEqual(['contents']);
    expect(writes('publish-desktop')).toEqual(['contents']);
    // sync-dev menulis ke dev lewat deploy key (bypass ruleset dev*), bukan GITHUB_TOKEN: izin token bawaan cukup baca
    expect(jobs['sync-dev']?.permissions).toEqual({ contents: 'read' });
    expect(jobs.meta?.permissions).toEqual({ contents: 'read', 'pull-requests': 'read' });
  });

  test('environment desktop-release hanya pada build-desktop, publish-desktop, dan withdraw; jalur server, meta, ci, dan sync-dev tak memakainya', () => {
    for (const name of ['build-desktop', 'publish-desktop', 'withdraw']) {
      expect(jobs[name]?.environment, name).toBe('desktop-release');
    }
    for (const name of ['meta', 'guard', 'ci', 'publish-server', 'sync-dev']) {
      expect(jobs[name]?.environment, name).toBeUndefined();
    }
  });

  test('rahasia: jalur server dan meta tanpa rahasia; build-desktop hanya token katalog; publish-desktop hanya kunci penerbit Drive dan kunci tanda tangan rilis; withdraw hanya kunci Drive; tak pernah UI_SIGNING_KEY atau secrets: inherit', () => {
    for (const name of ['meta', 'guard', 'ci', 'image', 'deploy', 'publish-server', 'sync-dev']) {
      expect(secretsOf(name), name).toEqual([]);
    }
    expect(secretsOf('build-desktop')).toEqual(['DESKTOP_CATALOG_TOKEN']);
    expect(secretsOf('publish-desktop')).toEqual([
      'DESKTOP_DRIVE_PUBLISHER_KEY',
      'DESKTOP_RELEASE_SIGNING_KEY',
    ]);
    expect(secretsOf('withdraw')).toEqual(['DESKTOP_DRIVE_PUBLISHER_KEY']);
    expect(codeOf(text)).not.toContain('secrets: inherit');
    expect(codeOf(text)).not.toContain('UI_SIGNING_KEY');
    // kunci tanda tangan TIDAK ada di job build-desktop (yang menjalankan kode dependensi dan electron-builder)
    expect(JSON.stringify(jobs['build-desktop'])).not.toContain('SIGNING_KEY');
  });

  test('checkout: meta, guard, dan withdraw hanya github.sha (ujung main, menjalankan skrip); build-desktop dan publish-* hanya sha hasil meta; tak pernah head PR; kredensial tak disimpan; ci, image, deploy, sync-dev tanpa checkout', () => {
    for (const name of ['meta', 'guard', 'withdraw']) {
      const checkout = stepsOfJob(name).find((s) => s.uses?.startsWith('actions/checkout'));
      expect(checkout?.with?.ref, name).toBe('${{ github.sha }}');
      expect(checkout?.with?.['persist-credentials'], name).toBe(false);
    }
    for (const name of ['build-desktop', 'publish-server', 'publish-desktop']) {
      const checkout = stepsOfJob(name).find((s) => s.uses?.startsWith('actions/checkout'));
      expect(checkout?.with?.ref, name).toBe('${{ needs.meta.outputs.sha }}');
      expect(checkout?.with?.['persist-credentials'], name).toBe(false);
    }
    for (const name of ['ci', 'image', 'deploy', 'sync-dev']) {
      expect(
        stepsOfJob(name).some((s) => s.uses?.startsWith('actions/checkout')),
        name,
      ).toBe(false);
    }
  });

  test('skrip `run` tanpa interpolasi ${{ }}; identitas dan guard memakai skrip murni dengan env eksplisit', () => {
    for (const step of stepsOf(release)) {
      if (step.run) expect(step.run, step.name).not.toContain('${{');
    }
    const identity = stepsOfJob('meta').find((s) => s.id === 'identity');
    expect(identity?.run).toContain('bun run scripts/release-identity.ts');
    expect(identity?.if).toContain("steps.resolve.outputs.release == 'true'");
    expect(identity?.env?.ONLY).toBe('${{ steps.resolve.outputs.only }}');
    expect(identity?.env?.SERVER_VERSION_AT_MERGE).toBe(
      '${{ steps.resolve.outputs.server_version_at_merge }}',
    );
    expect(identity?.env?.DESKTOP_VERSION_AT_MERGE).toBe(
      '${{ steps.resolve.outputs.desktop_version_at_merge }}',
    );
    const guardRun = stepsOfJob('guard').find((s) => s.run?.includes('release-guard.ts'));
    expect(guardRun?.run).toContain('bun run scripts/release-guard.ts');
    // metadata komponen yang sah berbeda dari staging = komponen yang dimuat PR (bukan hanya yang dirilis run ini)
    expect(guardRun?.env?.COMPONENTS).toBe('${{ needs.meta.outputs.components }}');
  });

  test('meta: PR dibaca lewat API (bukan field head dari event); non-rilis dilewati diam-diam; tiga bentuk cabang rilis lolos ke pagar identitas; keluaran meta lengkap', () => {
    const resolve = stepsOfJob('meta').find((s) => s.id === 'resolve');
    const run = resolve?.run ?? '';
    expect(run).toContain('gh api');
    expect(run).toContain('release/server-v*');
    expect(run).toContain('release/desktop-v*');
    expect(run).toContain('release/gabungan-*');
    expect(run).toContain('Bukan PR rilis; dilewati.');
    expect(run).toContain('release=false');
    expect(run).toContain("'.merged'");
    expect(run).toContain('refs/heads/main');
    expect(resolve?.env?.GH_TOKEN).toBe('${{ github.token }}');
    expect(resolve?.env?.INPUT_KOMPONEN).toBe('${{ inputs.komponen }}');
    expect(resolve?.env?.INPUT_VERSI).toBe('${{ inputs.versi }}');
    expect(Object.keys(jobs.meta?.outputs ?? {}).sort()).toEqual([
      'components',
      'desktop_version',
      'release',
      'server_version',
      'sha',
    ]);
    // `release` datang dari pagar identitas (yang menghitung saklar RELEASE_FLOW), bukan dari langkah baca PR
    expect(jobs.meta?.outputs?.release).toBe('${{ steps.identity.outputs.release }}');
  });

  test('job dengan leluhur yang bisa dilewati memakai fungsi status (success() implisit menilai seluruh rantai leluhur): guard dilewati pada rilis desktop saja, deploy pada rilis tanpa server', () => {
    for (const name of ['ci', 'build-desktop', 'publish-server', 'publish-desktop', 'sync-dev']) {
      const condition = jobs[name]?.if ?? '';
      expect(condition, name).toContain('!cancelled()');
      expect(condition, name).toContain('!failure()');
    }
    // job desktop menyebut hasil job yang diandalkannya secara eksplisit (tak bergantung pada success() implisit)
    expect(jobs['build-desktop']?.if).toContain("needs.ci.result == 'success'");
    expect(jobs['publish-desktop']?.if).toContain("needs.build-desktop.result == 'success'");
  });

  test('meta pemulihan: komponen dan versi divalidasi, cabang tunggal dicari lewat --head, cabang gabungan lewat daftar PR yang di-merge (titik versi di-escape), hanya komponen itu yang dirilis (only)', () => {
    const run = stepsOfJob('meta').find((s) => s.id === 'resolve')?.run ?? '';
    expect(run).toContain('Komponen pemulihan harus server atau desktop.');
    expect(run).toContain(
      'gh pr list --head "release/$only-v$INPUT_VERSI" --base main --state merged',
    );
    expect(run).toContain('gh pr list --base main --state merged');
    expect(run).toContain('--arg combined');
    expect(run).toContain('${INPUT_VERSI//./\\\\.}');
    expect(run).toContain('only=$INPUT_KOMPONEN');
    expect(run).toContain('echo "only=$only"');
    expect(run).toContain('Tidak ada PR rilis yang sudah di-merge untuk komponen dan versi itu.');
  });

  test('meta memvalidasi versi KEDUA package.json (semver) sebelum menuliskannya ke GITHUB_OUTPUT; sha ditulis paling akhir (nilai dikendalikan isi commit)', () => {
    const run = stepsOfJob('meta').find((s) => s.id === 'resolve')?.run ?? '';
    expect(run).toContain('version_at server');
    expect(run).toContain('version_at desktop');
    const serverCheck = run.indexOf(
      'fail "Versi di server/package.json pada commit merge bukan X.Y.Z."',
    );
    const desktopCheck = run.indexOf(
      'fail "Versi di desktop/package.json pada commit merge bukan X.Y.Z."',
    );
    const firstWrite = run.indexOf('>> "$GITHUB_OUTPUT"', run.indexOf('echo "release=true"'));
    expect(serverCheck).toBeGreaterThan(-1);
    expect(desktopCheck).toBeGreaterThan(-1);
    expect(serverCheck).toBeLessThan(firstWrite);
    expect(desktopCheck).toBeLessThan(firstWrite);
    const lines = run.split('\n');
    const shaLine = lines.findIndex((l) => l.includes('echo "sha=$sha"'));
    const lastOther = lines.findIndex((l) => l.includes('echo "only=$only"'));
    expect(shaLine).toBeGreaterThan(lastOther);
  });

  test('guard membaca refs/deployed/staging dan membandingkannya dengan commit rilis', () => {
    const runs = stepsOfJob('guard')
      .map((s) => s.run ?? '')
      .join('\n');
    expect(runs).toContain('git/ref/deployed/staging');
    expect(runs).toContain('compare/');
  });

  test('guard gagal tertutup: daftar berkas dikirim sebagai SATU baris JSON beserta jumlahnya (bukan teks per baris), 404 dibedakan dari galat API lain', () => {
    const compare = stepsOfJob('guard').find((s) => s.id === 'compare');
    expect(compare?.run).toContain('jq -c');
    expect(compare?.run).toContain('files_json=');
    expect(compare?.run).toContain('file_count=');
    expect(compare?.run).not.toContain('QC_FILES_EOF');
    expect(compare?.run).not.toContain('2>/dev/null');
    expect(compare?.run).toContain('404');
    const run = stepsOfJob('guard').find((s) => s.run?.includes('release-guard.ts'));
    expect(run?.env?.FILES_JSON).toBe('${{ steps.compare.outputs.files_json }}');
    expect(run?.env?.FILE_COUNT).toBe('${{ steps.compare.outputs.file_count }}');
    expect(run?.env?.GH_TOKEN).toBeUndefined();
  });

  test('bentrok tag terdeteksi di guard SEBELUM image/deploy: tag server dan (rilis gabungan) tag desktop yang sudah ada pada commit lain menggagalkan; CHANGELOG kedua komponen diperiksa', () => {
    const compare = stepsOfJob('guard').find((s) => s.id === 'compare');
    const run = compare?.run ?? '';
    expect(compare?.env?.VERSION).toBe('${{ needs.meta.outputs.server_version }}');
    expect(compare?.env?.DESKTOP_VERSION).toBe('${{ needs.meta.outputs.desktop_version }}');
    expect(run).toContain('check_tag "server-v$VERSION"');
    expect(run).toContain('check_tag "desktop-v$DESKTOP_VERSION"');
    expect(run).toContain('git/ref/tags/$tag');
    expect(run).toContain('Tag $tag sudah ada pada commit lain');
    expect(run).toContain('contents/server/CHANGELOG.md');
    expect(run).toContain('contents/desktop/CHANGELOG.md');
    // publish tak lagi menelan galat API sebagai "tag belum ada"
    for (const name of ['publish-server', 'publish-desktop']) {
      const create = stepsOfJob(name).find((s) => s.id === 'release');
      expect(create?.run, name).not.toContain('2>/dev/null');
      expect(create?.run, name).toContain('404');
    }
  });

  test('menjalankan ulang (production sudah di commit itu): image dan deploy dilewati, guard tak membandingkan staging, tag dan Release server tetap dituntaskan, desktop tak tertahan', () => {
    expect(Object.keys(jobs.guard?.outputs ?? {})).toEqual(['deployed']);
    for (const name of ['image', 'deploy']) {
      expect(jobs[name]?.if, name).toContain("needs.guard.outputs.deployed != 'true'");
    }
    const publishIf = jobs['publish-server']?.if ?? '';
    expect(publishIf).toContain('!cancelled()');
    expect(publishIf).toContain('!failure()');
    expect(publishIf).toContain("needs.guard.outputs.deployed == 'true'");
    expect(publishIf).toContain("needs.deploy.result == 'success'");
    const desktopIf = jobs['publish-desktop']?.if ?? '';
    expect(desktopIf).toContain('!cancelled()');
    expect(desktopIf).toContain('!failure()');
    expect(desktopIf).toContain("needs.meta.outputs.server_version == ''");
    expect(desktopIf).toContain("needs.guard.outputs.deployed == 'true'");
    expect(desktopIf).toContain("needs.deploy.result == 'success'");
    const compare = stepsOfJob('guard').find((s) => s.id === 'compare');
    expect(compare?.run).toContain('git/ref/deployed/production');
  });

  test('ci memanggil ci.yml SATU kali: selektif sejak deploy production bila hanya server, pemeriksaan penuh dengan desktop-check bila desktop ikut; dilewati hanya bila tak ada yang perlu diperiksa', () => {
    expect(jobs.ci?.uses).toBe('./.github/workflows/ci.yml');
    expect(jobs.ci?.with).toEqual({
      ref: '${{ needs.meta.outputs.sha }}',
      'since-deploy': "${{ needs.meta.outputs.desktop_version == '' && 'production' || '' }}",
      'desktop-check': "${{ needs.meta.outputs.desktop_version != '' }}",
    });
    expect(jobs.ci?.permissions).toEqual({
      contents: 'read',
      'pull-requests': 'read',
      packages: 'read',
    });
    const ciIf = jobs.ci?.if ?? '';
    // guard dilewati pada rilis desktop saja: ci tetap berjalan; guard gagal = tak berjalan
    expect(ciIf).toContain('!cancelled()');
    expect(ciIf).toContain('!failure()');
    expect(ciIf).toContain("needs.meta.outputs.desktop_version != ''");
    expect(ciIf).toContain("needs.guard.outputs.deployed != 'true'");
  });

  test('image dan deploy memanggil workflow bersama untuk production dengan versi server', () => {
    expect(jobs.image?.uses).toBe('./.github/workflows/server-image.yml');
    expect(jobs.image?.with).toEqual({
      target: 'production',
      sha: '${{ needs.meta.outputs.sha }}',
      'extra-tags': 'server-v${{ needs.meta.outputs.server_version }}',
    });
    expect(jobs.deploy?.uses).toBe('./.github/workflows/server-deploy.yml');
    expect(jobs.deploy?.with).toEqual({
      target: 'production',
      sha: '${{ needs.meta.outputs.sha }}',
    });
  });

  test('publish-server: tag dan Release dibuat hanya bila belum ada pada SHA yang sama (idempoten), tag di SHA lain menggagalkan', () => {
    const steps = stepsOfJob('publish-server');
    const notes = steps.find((s) => s.id === 'notes');
    const create = steps.find((s) => s.id === 'release');
    // catatan dibuat tanpa token (menjalankan kode dari checkout); token hanya di langkah yang memanggil API
    expect(notes?.run).toContain('changelog extract server');
    expect(notes?.env?.VERSION).toBe('${{ needs.meta.outputs.server_version }}');
    expect(notes?.env?.GH_TOKEN).toBeUndefined();
    expect(create?.env?.GH_TOKEN).toBe('${{ github.token }}');
    expect(create?.env?.VERSION).toBe('${{ needs.meta.outputs.server_version }}');
    expect(create?.run).not.toContain('bun run');
    expect(create?.run).toContain('git/ref/tags/');
    expect(create?.run).toContain('gh release create');
    expect(create?.run).toContain('--target');
    expect(create?.run).toContain('--verify-tag');
    expect(steps.indexOf(notes as Step)).toBeLessThan(steps.indexOf(create as Step));
  });

  test('build-desktop: Windows, CRLF dimatikan sebelum checkout, kunci publik dari Variable, kedua arsitektur diverifikasi, installer diunggah sebagai artefak (versi desktop)', () => {
    const job = jobs['build-desktop'];
    expect(job?.['runs-on']).toBe('windows-latest');
    expect(job?.defaults?.run?.shell).toBe('bash');
    const steps = job?.steps ?? [];
    const crlf = steps.findIndex((s) => s.run?.includes('core.autocrlf false'));
    const checkout = steps.findIndex((s) => s.uses?.startsWith('actions/checkout'));
    expect(crlf).toBeGreaterThanOrEqual(0);
    expect(crlf).toBeLessThan(checkout);
    expect(steps.some((s) => s.uses === './.github/actions/setup')).toBe(true);
    const build = steps.find((s) => s.run === 'bun run build:desktop');
    expect(build?.env?.UI_PUBLIC_KEY_PEM).toBe('${{ vars.UI_PUBLIC_KEY_PEM }}');
    expect(build?.env?.DESKTOP_RELEASE_PUBLIC_KEY_PEM).toBe(
      '${{ vars.DESKTOP_RELEASE_PUBLIC_KEY_PEM }}',
    );
    expect(build?.env?.CATALOG_TOKEN).toBe('${{ secrets.DESKTOP_CATALOG_TOKEN }}');
    const runs = steps.map((s) => s.run ?? '').join('\n');
    expect(runs).toContain('verify-pack --arch x64');
    expect(runs).toContain('verify-pack --arch arm64');
    const upload = steps.find((s) => s.uses?.startsWith('actions/upload-artifact'));
    expect(upload?.with?.['if-no-files-found']).toBe('error');
    expect(String(upload?.with?.path)).toContain(
      'QC-App-Setup-${{ needs.meta.outputs.desktop_version }}-x64.exe',
    );
    expect(String(upload?.with?.path)).toContain(
      'QC-App-Setup-${{ needs.meta.outputs.desktop_version }}-arm64.exe',
    );
    // token katalog hanya di langkah build, bukan di setup dependensi
    expect(JSON.stringify(steps.filter((s) => s !== build))).not.toContain('DESKTOP_CATALOG_TOKEN');
  });

  test('publish-desktop: unggah Drive (manifest ditandatangani) SEBELUM tag dan Release; tag/Release idempoten, installer dilampirkan; kunci ke berkas sementara dan dihapus if: always()', () => {
    const steps = stepsOfJob('publish-desktop');
    const notes = steps.find((s) => s.id === 'notes');
    const drive = steps.find((s) => s.run?.includes('publish-desktop-release.ts'));
    const release = steps.find((s) => s.id === 'release');
    expect(notes?.run).toContain('changelog extract desktop');
    expect(notes?.env?.VERSION).toBe('${{ needs.meta.outputs.desktop_version }}');
    expect(notes?.env?.GH_TOKEN).toBeUndefined();
    expect(drive).toBeDefined();
    expect(release).toBeDefined();
    // urutan: catatan, Drive, lalu tag + Release (tak ada Release tanpa unggahan yang sukses)
    expect(steps.indexOf(notes as Step)).toBeLessThan(steps.indexOf(drive as Step));
    expect(steps.indexOf(drive as Step)).toBeLessThan(steps.indexOf(release as Step));
    // Drive: rahasia hanya sebagai env langkah itu, berkas sementara izin ketat, folder dari Variable
    expect(drive?.env?.VERSION).toBe('${{ needs.meta.outputs.desktop_version }}');
    expect(drive?.env?.GOOGLE_SA_KEY_JSON).toBe('${{ secrets.DESKTOP_DRIVE_PUBLISHER_KEY }}');
    expect(drive?.env?.RELEASE_SIGNING_KEY).toBe('${{ secrets.DESKTOP_RELEASE_SIGNING_KEY }}');
    expect(drive?.env?.DESKTOP_RELEASE_PUBLIC_KEY_PEM).toBe(
      '${{ vars.DESKTOP_RELEASE_PUBLIC_KEY_PEM }}',
    );
    expect(drive?.env?.FOLDER_ID).toBe('${{ vars.DESKTOP_RELEASES_FOLDER_ID }}');
    expect(drive?.run).toContain('umask 077');
    expect(drive?.run).toContain('--folder-id "$FOLDER_ID"');
    expect(drive?.run).toContain('--changelog-file');
    // tag dan Release: token hanya di langkah API, tak menjalankan kode repo, idempoten; installer dilampirkan
    // (keputusan pemilik 2026-11-18: token katalog dinyatakan publik, jadi melampirkan installer tak menambah paparan)
    expect(release?.env?.GH_TOKEN).toBe('${{ github.token }}');
    expect(release?.env?.VERSION).toBe('${{ needs.meta.outputs.desktop_version }}');
    expect(release?.env?.INSTALLERS_DIR).toBe('${{ runner.temp }}/installers');
    expect(release?.run).not.toContain('bun run');
    expect(release?.run).toContain('git/ref/tags/');
    expect(release?.run).toContain('gh release create');
    expect(release?.run).toContain('--target');
    expect(release?.run).toContain('--verify-tag');
    expect(release?.run).toContain('desktop-v');
    // lampiran: hanya QC-App-Setup-*.exe dari artefak build, wajib ada, dan pembuatan ulang menimpa lampiran lama
    expect(release?.run).toContain('QC-App-Setup-*.exe');
    expect(release?.run).toContain('"${assets[@]}"');
    expect(release?.run).toContain('gh release upload "$tag" "${assets[@]}" --clobber');
    const createLines = (release?.run ?? '')
      .split('\n')
      .filter((l) => l.includes('gh release create'));
    expect(createLines).toHaveLength(2);
    for (const line of createLines) expect(line).toContain('"${assets[@]}"');
    const cleanup = steps.at(-1);
    expect(cleanup?.if).toBe('always()');
    expect(cleanup?.run).toContain('sa-key.json');
    expect(cleanup?.run).toContain('release-signing-key.pem');
    // artefak installer diunduh sebelum Drive
    const download = steps.find((s) => s.uses?.startsWith('actions/download-artifact'));
    expect(steps.indexOf(download as Step)).toBeLessThan(steps.indexOf(drive as Step));
  });

  test('publish-desktop tidak memasang dependensi (tanpa bun install): kunci hanya berada di job yang tak menjalankan kode pihak ketiga', () => {
    const runs = stepsOfJob('publish-desktop')
      .map((s) => `${s.uses ?? ''}\n${s.run ?? ''}`)
      .join('\n');
    expect(runs).not.toContain('bun install');
    expect(runs).not.toContain('./.github/actions/setup');
  });

  test('withdraw: hanya dari main, versi divalidasi, hanya menghapus tanda tangan (--withdraw), kunci dihapus if: always()', () => {
    const steps = stepsOfJob('withdraw');
    const pull = steps.find((s) => s.run?.includes('--withdraw'));
    expect(pull?.env?.VERSION).toBe('${{ inputs.tarik }}');
    expect(pull?.env?.GOOGLE_SA_KEY_JSON).toBe('${{ secrets.DESKTOP_DRIVE_PUBLISHER_KEY }}');
    expect(pull?.run).toContain('refs/heads/main');
    expect(pull?.run).toMatch(/VERSION =~ \^\[0-9\]\+/);
    expect(pull?.run).toContain('umask 077');
    expect(steps.at(-1)?.if).toBe('always()');
    expect(steps.at(-1)?.run).toContain('sa-key.json');
  });

  test('sync-dev: satu panggilan sync-dev.yml setelah SEMUA komponen yang dirilis sukses; komponen server, desktop, atau gabungan dengan kedua versi; deploy key dan git+SSH hidup di workflow itu, bukan di sini', () => {
    const job = jobs['sync-dev'];
    expect(job?.uses).toBe('./.github/workflows/sync-dev.yml');
    expect(job?.with).toEqual({
      sha: '${{ needs.meta.outputs.sha }}',
      version: '${{ needs.meta.outputs.server_version || needs.meta.outputs.desktop_version }}',
      komponen:
        "${{ needs.meta.outputs.server_version != '' && needs.meta.outputs.desktop_version != '' && 'gabungan' || needs.meta.outputs.server_version != '' && 'server' || 'desktop' }}",
      'version-desktop':
        "${{ needs.meta.outputs.server_version != '' && needs.meta.outputs.desktop_version || '' }}",
    });
    const syncIf = job?.if ?? '';
    expect(syncIf).toContain('!cancelled()');
    expect(syncIf).toContain('!failure()');
    expect(syncIf).toContain(
      "needs.meta.outputs.server_version == '' || needs.publish-server.result == 'success'",
    );
    expect(syncIf).toContain(
      "needs.meta.outputs.desktop_version == '' || needs.publish-desktop.result == 'success'",
    );
    expect(job?.steps).toBeUndefined();
    expect(codeOf(text)).not.toMatch(/git push|SYNC_DEPLOY_KEY|ssh-ed25519/);
  });

  test('docs/ci-cd.md menjelaskan release.yml dan saklar RELEASE_FLOW', () => {
    const doc = read('docs/ci-cd.md');
    expect(doc).toContain('release.yml');
    expect(doc).toContain('RELEASE_FLOW');
  });
});

describe('deploy-tag.yml: deploy versi tertentu lewat tag (rilis semver bagian 3)', () => {
  const text = rawOf('deploy-tag.yml');
  const wf = parse(text);
  const jobs = wf.jobs;

  test('pemicu hanya workflow_dispatch: tag (wajib), environment (pilihan staging|production), izinkan_downgrade_skema (boolean bawaan false)', () => {
    const on = wf.on as {
      workflow_dispatch: {
        inputs: Record<
          string,
          { type: string; required?: boolean; default?: unknown; options?: string[] }
        >;
      };
    };
    expect(Object.keys(wf.on ?? {})).toEqual(['workflow_dispatch']);
    const inputs = on.workflow_dispatch.inputs;
    expect(Object.keys(inputs).sort()).toEqual(['environment', 'izinkan_downgrade_skema', 'tag']);
    expect(inputs.tag?.required).toBe(true);
    expect(inputs.environment?.type).toBe('choice');
    expect(inputs.environment?.options).toEqual(['staging', 'production']);
    expect(inputs.izinkan_downgrade_skema?.type).toBe('boolean');
    expect(inputs.izinkan_downgrade_skema?.default).toBe(false);
  });

  test('regex pembuat Release di langkah facts (dievaluasi bash sungguhan): menerima github-actions[bot], menolak spasi, baris baru, dan karakter aneh', () => {
    const m = text.match(/\[\[ \$release_author =~ (\S+) \]\]/);
    expect(m?.[1]).toBeDefined();
    const accepts = (value: string): boolean =>
      Bun.spawnSync(['bash', '-c', '[[ $VAL =~ $RE ]]'], {
        env: { ...process.env, VAL: value, RE: m?.[1] ?? '' },
      }).exitCode === 0;
    expect(accepts('github-actions[bot]')).toBe(true);
    expect(accepts('rahmadmrhd')).toBe(true);
    expect(accepts('')).toBe(true);
    expect(accepts('a b')).toBe(false);
    expect(accepts('x\ny')).toBe(false);
    expect(accepts('a;rm')).toBe(false);
    expect(accepts('a'.repeat(101))).toBe(false);
  });

  test('concurrency: grup environment yang SAMA dengan deploy-server.yml dan release.yml, tanpa membatalkan', () => {
    expect(wf.concurrency?.group).toBe('deploy-server-${{ inputs.environment }}');
    expect(wf.concurrency?.['cancel-in-progress']).toBe(false);
  });

  test('urutan job: meta -> verify -> deploy; deploy memanggil server-deploy.yml dengan masukan dari meta dan input izin', () => {
    expect(Object.keys(jobs)).toEqual(['meta', 'verify', 'deploy']);
    expect([jobs.verify?.needs ?? []].flat()).toEqual(['meta']);
    expect([jobs.deploy?.needs ?? []].flat().sort()).toEqual(['meta', 'verify']);
    expect(jobs.deploy?.uses).toBe('./.github/workflows/server-deploy.yml');
    expect(jobs.deploy?.with).toEqual({
      target: '${{ inputs.environment }}',
      sha: '${{ needs.meta.outputs.sha }}',
      'allow-schema-downgrade': '${{ inputs.izinkan_downgrade_skema }}',
    });
    expect(codeOf(text)).not.toContain('secrets: inherit');
  });

  test('tanpa build image dan tanpa ci: hanya memverifikasi lalu men-deploy image yang sudah ada', () => {
    expect(codeOf(text)).not.toMatch(/build-push-action|server-image\.yml|ci\.yml/);
  });

  test('izin: contents read tingkat atas; verify tambah packages read; contents: write hanya batas deploy (mark-deployed di workflow terpanggil)', () => {
    expect(wf.permissions).toEqual({ contents: 'read' });
    expect(jobs.meta?.permissions).toEqual({ contents: 'read' });
    expect(jobs.verify?.permissions).toEqual({ contents: 'read', packages: 'read' });
    expect(jobs.deploy?.permissions).toEqual({ contents: 'write' });
  });

  test('checkout: hanya verify, hanya github.sha (ujung ref yang di-dispatch, untuk menjalankan skrip keputusan), tak pernah kode tag; kredensial tak disimpan', () => {
    const checkouts = stepsOf(wf).filter((s) => s.uses?.startsWith('actions/checkout'));
    expect(checkouts).toHaveLength(1);
    expect(checkouts[0]?.with?.ref).toBe('${{ github.sha }}');
    expect(checkouts[0]?.with?.['persist-credentials']).toBe(false);
    expect((jobs.verify?.steps ?? []).some((s) => s.uses?.startsWith('actions/checkout'))).toBe(
      true,
    );
    expect((jobs.meta?.steps ?? []).some((s) => s.uses?.startsWith('actions/checkout'))).toBe(
      false,
    );
  });

  test('skrip `run` tanpa interpolasi ${{ }}; tak ada rahasia (login GHCR memakai github.token)', () => {
    for (const step of stepsOf(wf)) {
      if (step.run) expect(step.run, step.name).not.toContain('${{');
    }
    expect(codeOf(text)).not.toMatch(/secrets\./);
  });

  test('meta: production hanya dari refs/heads/main, staging dari main atau dev; tag divalidasi regex lalu diubah ke SHA (tag beranotasi didereferensi)', () => {
    const runs = (jobs.meta?.steps ?? []).map((s) => s.run ?? '').join('\n');
    expect(runs).toContain('refs/heads/main');
    expect(runs).toContain('refs/heads/dev');
    expect(runs).toContain('^server-v(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$');
    expect(runs).toContain('git/ref/tags/');
    expect(runs).toContain('git/tags/');
    expect(Object.keys(jobs.meta?.outputs ?? {}).sort()).toEqual(['sha', 'version']);
  });

  test('verify: provenance dan pagar downgrade lewat skrip murni; langkah pemegang token hanya memanggil API, langkah skrip tanpa token', () => {
    const steps = jobs.verify?.steps ?? [];
    const facts = steps.filter((s) => s.env?.GH_TOKEN !== undefined);
    expect(facts.length).toBeGreaterThan(0);
    for (const step of facts) expect(step.run ?? '', step.name).not.toContain('bun run');
    const scripts = steps.filter((s) => s.run?.includes('bun run scripts/deploy-tag-check.ts'));
    expect(scripts.map((s) => s.run?.trim()).sort()).toEqual([
      'bun run scripts/deploy-tag-check.ts downgrade',
      'bun run scripts/deploy-tag-check.ts provenance',
    ]);
    for (const step of scripts) expect(step.env?.GH_TOKEN, step.name).toBeUndefined();
    const factsRuns = facts.map((s) => s.run ?? '').join('\n');
    // nama `main` ambigu bila ada tag bernama main: bandingkan dengan SHA ujung branch main yang diambil dari heads/main
    expect(factsRuns).toContain('git/ref/heads/main');
    expect(factsRuns).toContain('compare/$main_sha...$SHA');
    expect(factsRuns).not.toContain('compare/main...');
    expect(factsRuns).toContain('releases/tags/');
    expect(factsRuns).toContain('git/ref/deployed/');
    expect(factsRuns).toContain('docker buildx imagetools inspect');
    expect(factsRuns).toContain('server/migrations');
  });

  test('verify: token GHCR dicabut dari disk (docker logout) sebelum langkah skrip berjalan', () => {
    const steps = jobs.verify?.steps ?? [];
    const facts = steps.find((s) => s.id === 'facts');
    expect(facts?.run).toContain('docker logout ghcr.io');
    expect(facts?.run?.indexOf('docker logout ghcr.io')).toBeGreaterThan(
      facts?.run?.indexOf('docker buildx imagetools inspect') ?? Number.POSITIVE_INFINITY,
    );
  });

  test('verify: login GHCR memakai aksi yang dipatok SHA sebelum memeriksa image; 404 dibedakan dari galat API lain', () => {
    const steps = jobs.verify?.steps ?? [];
    const login = steps.findIndex((s) => s.uses?.startsWith('docker/login-action@'));
    const inspect = steps.findIndex((s) => s.run?.includes('docker buildx imagetools inspect'));
    expect(login).toBeGreaterThanOrEqual(0);
    expect(login).toBeLessThan(inspect);
    expect(steps[login]?.with?.password).toBe('${{ github.token }}');
    const runs = steps.map((s) => s.run ?? '').join('\n');
    expect(runs).toMatch(/HTTP 404/);
    expect(runs).toContain('api_try');
  });

  test('docs/ci-cd.md dan CLAUDE.md menjelaskan deploy-tag.yml', () => {
    expect(read('docs/ci-cd.md')).toContain('deploy-tag.yml');
    expect(read('CLAUDE.md')).toContain('deploy-tag.yml');
  });
});

describe('sync-dev.yml: sinkron main ke dev (workflow bersama, dipanggil release.yml)', () => {
  const text = rawOf('sync-dev.yml');
  const wf = parse(text);
  const job = wf.jobs['sync-dev'];

  test('hanya workflow_call dengan input sha, version, komponen (string wajib) dan version-desktop (string opsional, untuk rilis gabungan); izin contents read; satu sinkron pada satu waktu tanpa membatalkan', () => {
    const on = wf.on as {
      workflow_call: { inputs: Record<string, { type: string; required: boolean }> };
    };
    expect(Object.keys(wf.on ?? {})).toEqual(['workflow_call']);
    expect(Object.keys(on.workflow_call.inputs).sort()).toEqual([
      'komponen',
      'sha',
      'version',
      'version-desktop',
    ]);
    for (const [name, input] of Object.entries(on.workflow_call.inputs)) {
      expect(input.type).toBe('string');
      expect(input.required, name).toBe(name !== 'version-desktop');
    }
    expect(wf.permissions).toEqual({ contents: 'read' });
    expect(wf.concurrency).toEqual({ group: 'sync-dev', 'cancel-in-progress': false });
    expect(Object.keys(wf.jobs)).toEqual(['sync-dev']);
  });

  test('deploy key (bypass ruleset dev*) dari environment sync-dev; tanpa GITHUB_TOKEN tulis, tanpa app/PAT; kunci dibaca hanya sebagai env langkah dan dihapus di akhir', () => {
    expect(job?.environment).toBe('sync-dev');
    expect(job?.permissions).toEqual({ contents: 'read' });
    const steps = job?.steps ?? [];
    expect(steps.some((s) => s.uses?.startsWith('actions/create-github-app-token'))).toBe(false);
    const sync = steps.find((s) => s.run?.includes('git push'));
    expect(sync?.env?.SYNC_DEPLOY_KEY).toBe('${{ secrets.SYNC_DEPLOY_KEY }}');
    expect(JSON.stringify(job)).not.toContain('github.token');
    expect(JSON.stringify(job)).not.toContain('secrets.GITHUB_TOKEN');
    expect(JSON.stringify(job)).not.toMatch(/secrets\.(?!SYNC_DEPLOY_KEY)/);
    expect(codeOf(text)).not.toContain('secrets: inherit');
    const cleanup = steps.at(-1);
    expect(cleanup?.if).toBe('always()');
    expect(cleanup?.run).toContain('sync_key');
  });

  test('masukan lewat env (bukan ${{ }} di run) dan divalidasi: sha 40 heksa, versi X.Y.Z, komponen server|desktop|gabungan; versi desktop hanya untuk gabungan', () => {
    const sync = (job?.steps ?? []).find((s) => s.run?.includes('git push'));
    expect(sync?.env?.SHA).toBe('${{ inputs.sha }}');
    expect(sync?.env?.VERSION).toBe('${{ inputs.version }}');
    expect(sync?.env?.VERSION_DESKTOP).toBe('${{ inputs.version-desktop }}');
    expect(sync?.env?.KOMPONEN).toBe('${{ inputs.komponen }}');
    for (const step of job?.steps ?? []) expect(step.run ?? '', step.name).not.toContain('${{');
    const run = sync?.run ?? '';
    expect(run).toContain('[0-9a-f]{40}');
    expect(run).toMatch(/KOMPONEN =~ \^\(server\|desktop\|gabungan\)\$/);
    // gabungan wajib membawa versi desktop yang sah; komponen tunggal tak boleh membawanya
    expect(run).toContain('VERSION_DESKTOP =~');
    expect(run).toContain('[ -z "$VERSION_DESKTOP" ]');
    // pesan merge memuat komponen (gabungan: kedua versi)
    expect(run).toContain('label="server v$VERSION + desktop v$VERSION_DESKTOP"');
    expect(run).toContain('label="$KOMPONEN v$VERSION"');
    expect(run).toContain('sinkron main ke dev ($label)');
  });

  test('merge main ke dev lewat git+SSH tanpa PR; host key GitHub dipatok (bukan ssh-keyscan); konflik = peringatan jelas, tanpa membuat PR', () => {
    const sync = (job?.steps ?? []).find((s) => s.run?.includes('git push'));
    const run = sync?.run ?? '';
    expect(run).toContain('git merge --no-ff');
    expect(run).toContain('git push origin dev');
    expect(run).toContain('git@github.com:');
    // host key ed25519 GitHub (https://api.github.com/meta -> ssh_keys), diperiksa ketat
    expect(run).toContain(
      'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl',
    );
    expect(run).toContain('StrictHostKeyChecking=yes');
    expect(run).not.toMatch(/ssh-keyscan|StrictHostKeyChecking[= ]+no/i);
    expect(run).toContain('::warning::');
    expect(run).not.toContain('gh pr create');
    expect(run).not.toContain('gh api');
    // push hanya ke dev (bypass ruleset hanya di dev*); tak pernah ke main
    expect(run).not.toMatch(/git push[^\n]*main/);
  });

  test('tak ada checkout kode repositori: job hanya mengkloning dev lewat SSH', () => {
    expect((job?.steps ?? []).some((s) => s.uses?.startsWith('actions/checkout'))).toBe(false);
  });
});

describe('dokumentasi rilis (server, desktop, gabungan) dan sync-dev bersama', () => {
  test('release-desktop.yml sudah digabung ke release.yml (satu workflow rilis)', () => {
    expect(workflowFiles).toContain('release.yml');
    expect(workflowFiles).not.toContain('release-desktop.yml');
  });

  test('docs/ci-cd.md menjelaskan release.yml (tiga bentuk cabang rilis), sync-dev.yml, penarikan, dan retensi', () => {
    const doc = read('docs/ci-cd.md');
    for (const term of [
      'release.yml',
      'sync-dev.yml',
      'tarik',
      'desktop-release',
      'DESKTOP_RELEASES_FOLDER_ID',
      'release/gabungan-server-v',
    ]) {
      expect(doc, term).toContain(term);
    }
    expect(doc).not.toContain('release-desktop.yml');
  });

  test('docs/desktop-release-signing.md memuat semua secret dan Variable rilis desktop yang dipakai release.yml', () => {
    const doc = read('docs/desktop-release-signing.md');
    const used = new Set<string>();
    for (const match of rawOf('release.yml').matchAll(/\b(?:secrets|vars)\.([A-Z_]+)/g)) {
      const name = match[1] as string;
      if (name.startsWith('DESKTOP_') || name === 'UI_PUBLIC_KEY_PEM') used.add(name);
    }
    expect([...used].sort()).toEqual([
      'DESKTOP_CATALOG_TOKEN',
      'DESKTOP_DRIVE_PUBLISHER_KEY',
      'DESKTOP_RELEASES_FOLDER_ID',
      'DESKTOP_RELEASE_PUBLIC_KEY_PEM',
      'DESKTOP_RELEASE_SIGNING_KEY',
      'UI_PUBLIC_KEY_PEM',
    ]);
    for (const name of used) expect(doc, name).toContain(name);
    expect(doc).not.toContain('release-desktop.yml');
  });

  test('CLAUDE.md, docs/setup-google.md, dan checklist e2e desktop menyebut rilis desktop dan rilis gabungan', () => {
    expect(read('CLAUDE.md')).toContain('release.yml');
    expect(read('CLAUDE.md')).not.toContain('release-desktop.yml');
    expect(read('CLAUDE.md')).toContain('app-manifest');
    expect(read('CLAUDE.md')).toContain('release/gabungan-server-v');
    expect(read('docs/setup-google.md')).toContain('DESKTOP_RELEASES_FOLDER_ID');
    expect(read('docs/e2e-checklist-desktop.md')).toContain('Pembaruan otomatis');
  });
});
