// Menjalankan langkah `facts` (job `verify`) dari .github/workflows/deploy-tag.yml dengan `gh` dan `docker` PALSU (pola tes
// since-deploy), jadi logika bash/jq yang paling rawan teruji tanpa GitHub: pembedaan 404 dari galat API, pembacaan baris
// pertama migrasi (gagal tertutup), keluaran satu baris ke GITHUB_OUTPUT, dan pencabutan token GHCR. Butuh `jq` asli
// (ada di runner GitHub; dilewati bila tak terpasang, mis. di mesin Windows pengembang).
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { removeTempDirSync } from '../server/test-support/safe-rm';
import { ROOT_DIR } from './paths';

setDefaultTimeout(30_000);

function hasJq(): boolean {
  try {
    return Bun.spawnSync(['jq', '--version']).exitCode === 0;
  } catch {
    return false;
  }
}
const JQ = hasJq();

interface WorkflowStep {
  id?: string;
  run?: string;
}
const workflow = Bun.YAML.parse(
  readFileSync(join(ROOT_DIR, '.github', 'workflows', 'deploy-tag.yml'), 'utf8'),
) as { jobs: Record<string, { steps: WorkflowStep[] }> };
const FACTS = workflow.jobs.verify?.steps.find((step) => step.id === 'facts')?.run ?? '';

const REPO = 'o/r';
const TAG = 'server-v1.2.3';
const SHA = 'a'.repeat(40);
const MAIN_SHA = 'b'.repeat(40);
const DEPLOYED = 'c'.repeat(40);
const M1 = '0001_baseline.sql';
const M2 = '0002_tambah_kolom.sql';

const FAKE_GH = `#!/bin/sh
# gh palsu: "gh api [-H hdr] <path> [--jq expr]"; jawaban dari berkas fixture bernama path (/ ? = & -> _)
[ "$1" = api ] || exit 2
shift
path=''; expr=''
while [ $# -gt 0 ]; do
  case "$1" in
    -H) shift 2 ;;
    --jq) expr="$2"; shift 2 ;;
    *) path="$1"; shift ;;
  esac
done
name=$(printf '%s' "$path" | tr '/?=&' '____')
if [ -f "$FIX/$name.err" ]; then cat "$FIX/$name.err" >&2; exit 1; fi
if [ ! -f "$FIX/$name" ]; then echo "gh: Not Found (HTTP 404)" >&2; exit 1; fi
if [ -n "$expr" ]; then jq -r "$expr" < "$FIX/$name"; else cat "$FIX/$name"; fi
`;

const FAKE_DOCKER = `#!/bin/sh
echo "docker $*" >> "$FIX/docker.log"
case "$*" in
  "buildx imagetools inspect "*"--format"*)
    [ -f "$FIX/image_missing" ] && exit 1
    printf '{"config":{"Labels":{"qc.build-target":"%s"}}}' "$(cat "$FIX/image_target" 2>/dev/null || echo production)"
    exit 0 ;;
  "buildx imagetools inspect "*) [ -f "$FIX/image_missing" ] && exit 1; exit 0 ;;
esac
exit 0
`;

let base: string;
let bin: string;
let fix: string;
let outFile: string;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'qc-deploytag-'));
  bin = join(base, 'bin');
  mkdirSync(bin);
  for (const [name, body] of [
    ['gh', FAKE_GH],
    ['docker', FAKE_DOCKER],
  ] as const) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
});
afterAll(() => removeTempDirSync(base));

const posix = (path: string) => path.replaceAll('\\', '/');
const put = (path: string, body: unknown) =>
  writeFileSync(
    join(fix, path.replace(/[/?=&]/g, '_')),
    typeof body === 'string' ? body : JSON.stringify(body),
  );

beforeEach(() => {
  fix = join(base, `fix-${crypto.randomUUID().slice(0, 8)}`);
  mkdirSync(fix);
  outFile = join(fix, 'github_output');
  writeFileSync(outFile, '');
  put(`repos/${REPO}/git/ref/heads/main`, { object: { sha: MAIN_SHA } });
  put(`repos/${REPO}/compare/${MAIN_SHA}...${SHA}`, { status: 'behind' });
  put(`repos/${REPO}/contents/server/package.json?ref=${SHA}`, { version: '1.2.3' });
  put(`repos/${REPO}/releases/tags/${TAG}`, {
    author: { login: 'github-actions[bot]' },
    draft: false,
  });
  put(`repos/${REPO}/git/ref/deployed/production`, { object: { sha: DEPLOYED } });
  put(`repos/${REPO}/contents/server/migrations?ref=${DEPLOYED}`, [
    { name: M1, type: 'file' },
    { name: M2, type: 'file' },
    { name: 'README.md', type: 'file' },
  ]);
  put(`repos/${REPO}/contents/server/migrations?ref=${SHA}`, [{ name: M1, type: 'file' }]);
  put(
    `repos/${REPO}/contents/server/migrations/${M2}?ref=${DEPLOYED}`,
    '-- tambah kolom\nALTER TABLE a ADD b INT;\n',
  );
});

async function runFacts(extraEnv: Record<string, string> = {}) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  env.PATH = `${posix(bin)}${delimiter}${env.PATH ?? ''}`;
  Object.assign(env, {
    FIX: posix(fix),
    GH_TOKEN: 'token-uji',
    REPO,
    OWNER: 'Pemilik',
    TAG,
    TARGET: 'production',
    SHA,
    GITHUB_OUTPUT: posix(outFile),
    ...extraEnv,
  });
  const proc = Bun.spawn(['bash', '-c', FACTS], { env, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  const outputs: Record<string, string> = {};
  const raw = readFileSync(outFile, 'utf8');
  for (const line of raw.split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) outputs[line.slice(0, at)] = line.slice(at + 1);
  }
  return { code, out: stdout + stderr, outputs, raw };
}

const dockerLog = () => readFileSync(join(fix, 'docker.log'), 'utf8');

describe.skipIf(!JQ)('deploy-tag.yml: langkah facts dengan gh dan docker palsu', () => {
  test('jalur sehat: fakta provenance dan pagar downgrade terkumpul, satu baris per keluaran', async () => {
    const result = await runFacts();
    expect(result.code, result.out).toBe(0);
    expect(result.outputs).toEqual({
      main_relation: 'behind',
      version_at_sha: '1.2.3',
      release_exists: 'true',
      release_author: 'github-actions[bot]',
      release_draft: 'false',
      image_exists: 'true',
      image_target: 'production',
      downgrade_check: 'true',
      applied_json: JSON.stringify([M1, M2]),
      target_json: JSON.stringify([M1]),
      first_lines_json: JSON.stringify({ [M2]: '-- tambah kolom' }),
    });
    expect(result.raw.trim().split('\n')).toHaveLength(11);
    // nama image dari pemilik huruf kecil; token GHCR dicabut dari disk setelah image diperiksa
    expect(dockerLog()).toContain('buildx imagetools inspect ghcr.io/pemilik/qc-app:' + SHA);
    expect(dockerLog().indexOf('logout ghcr.io')).toBeGreaterThan(
      dockerLog().indexOf('imagetools inspect'),
    );
  });

  test('membandingkan dengan SHA ujung main (heads/main), bukan nama main', async () => {
    const result = await runFacts();
    expect(result.code, result.out).toBe(0);
    // tanpa fixture compare untuk SHA main yang benar, langkah akan gagal 404: lulus berarti jalur yang dipakai benar
    expect(result.outputs.main_relation).toBe('behind');
  });

  test('Release 404 = release_exists false (bukan galat); galat API lain menggagalkan langkah', async () => {
    rmSync(join(fix, `repos_${REPO.replace('/', '_')}_releases_tags_${TAG}`));
    const none = await runFacts();
    expect(none.code, none.out).toBe(0);
    expect(none.outputs.release_exists).toBe('false');
    expect(none.outputs.release_author).toBe('');

    put(`repos/${REPO}/releases/tags/${TAG}`, '');
    writeFileSync(
      join(fix, `repos_${REPO.replace('/', '_')}_releases_tags_${TAG}.err`),
      'gh: Server Error (HTTP 500)',
    );
    const broken = await runFacts();
    expect(broken.code).not.toBe(0);
    expect(broken.out).toContain('::error::');
  });

  test('penunjuk refs/deployed belum ada (404): pagar CI dilewati dengan pemberitahuan; sama dengan target: dilewati', async () => {
    rmSync(join(fix, `repos_${REPO.replace('/', '_')}_git_ref_deployed_production`));
    const first = await runFacts();
    expect(first.code, first.out).toBe(0);
    expect(first.outputs.downgrade_check).toBe('false');
    expect(first.out).toContain('::notice::');

    put(`repos/${REPO}/git/ref/deployed/production`, { object: { sha: SHA } });
    const same = await runFacts();
    expect(same.code, same.out).toBe(0);
    expect(same.outputs.downgrade_check).toBe('false');
  });

  test('galat API pada refs/deployed (bukan 404) menggagalkan langkah, bukan dibaca sebagai belum ada', async () => {
    writeFileSync(
      join(fix, `repos_${REPO.replace('/', '_')}_git_ref_deployed_production.err`),
      'gh: Bad Gateway (HTTP 502)',
    );
    const result = await runFacts();
    expect(result.code).not.toBe(0);
  });

  test('baris pertama migrasi tak terbaca: kuncinya tidak diisi (skrip menolaknya sebagai contract)', async () => {
    rmSync(
      join(fix, `repos_${REPO.replace('/', '_')}_contents_server_migrations_${M2}_ref_${DEPLOYED}`),
    );
    const result = await runFacts();
    expect(result.code, result.out).toBe(0);
    expect(result.outputs.first_lines_json).toBe('{}');
  });

  test('image tidak ada di GHCR: image_exists false', async () => {
    writeFileSync(join(fix, 'image_missing'), '1');
    const result = await runFacts();
    expect(result.code, result.out).toBe(0);
    expect(result.outputs.image_exists).toBe('false');
  });

  test('label qc.build-target image dibaca: staging terbawa apa adanya; nilai asing/kosong menjadi kosong (provenance menolak)', async () => {
    writeFileSync(join(fix, 'image_target'), 'staging');
    const staging = await runFacts();
    expect(staging.code, staging.out).toBe(0);
    expect(staging.outputs.image_target).toBe('staging');

    writeFileSync(
      join(fix, 'image_target'),
      'production' + String.fromCharCode(10) + 'image_exists=true',
    );
    const evil = await runFacts();
    expect(evil.code, evil.out).toBe(0);
    expect(evil.outputs.image_target).toBe('');
    expect(evil.outputs.image_exists).toBe('true');

    writeFileSync(join(fix, 'image_missing'), '1');
    const missing = await runFacts();
    expect(missing.outputs.image_target).toBe('');
  });

  test('nama berkas jahat (baris baru, ../) tak menyelipkan baris GITHUB_OUTPUT palsu dan tak dibaca isinya', async () => {
    const evil = `0001_a.sql\nimage_exists=true`;
    put(`repos/${REPO}/contents/server/migrations?ref=${DEPLOYED}`, [
      { name: M1, type: 'file' },
      { name: evil, type: 'file' },
      { name: '../x.sql', type: 'file' },
    ]);
    const result = await runFacts();
    expect(result.code, result.out).toBe(0);
    const keys = result.raw
      .trim()
      .split('\n')
      .map((line) => line.slice(0, line.indexOf('=')));
    expect(keys).toEqual([
      'main_relation',
      'version_at_sha',
      'release_exists',
      'release_author',
      'release_draft',
      'image_exists',
      'image_target',
      'downgrade_check',
      'applied_json',
      'target_json',
      'first_lines_json',
    ]);
    expect(result.outputs.image_exists).toBe('true');
    expect(result.outputs.first_lines_json).toBe('{}');
  });

  test('versi di package.json bukan X.Y.Z: version_at_sha kosong (ditolak skrip), SHA/tag tak sah menggagalkan langkah', async () => {
    put(`repos/${REPO}/contents/server/package.json?ref=${SHA}`, {
      version: '1.2.3\nimage_exists=true',
    });
    const odd = await runFacts();
    expect(odd.code, odd.out).toBe(0);
    expect(odd.outputs.version_at_sha).toBe('');
    expect((await runFacts({ SHA: 'zzz' })).code).not.toBe(0);
    expect((await runFacts({ TAG: 'server-v01.2.3' })).code).not.toBe(0);
    expect((await runFacts({ TARGET: 'dev' })).code).not.toBe(0);
  });
});
