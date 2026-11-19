// Pemeriksaan deploy lewat tag (workflow .github/workflows/deploy-tag.yml, job `verify`; rancangan
// docs/superpowers/specs/2026-11-17-rilis-semver-design.md bagian 5.5). Fungsi murni: data dikumpulkan pemanggil lewat
// `gh api` (langkah yang memegang token), lalu skrip ini memutuskan (langkah yang TIDAK memegang token).
//  - provenance: tag dapat dibuat siapa pun berizin tulis (ruleset tag tak tersedia, 5.0), jadi tag hanya dipercaya bila
//    SHA-nya leluhur `main`, versi di `server/package.json` pada SHA itu sama dengan tag, Release-nya ada dan dibuat
//    workflow `publish` (`github-actions[bot]`), dan image `qc-app:<sha>` ada. Catatan: Release buatan bot bukan bukti kuat
//    sendirian (penulis berizin tulis dapat memicu workflow lain yang memakai token yang sama); syarat lain tetap pagar utama.
//  - downgrade: pemeriksaan terbaik dari CI (`refs/deployed/<env>` dapat basi); pagar yang berwenang ada di VPS
//    (`deploy/deploy.sh` `schema_guard`), dengan aturan yang sama.
import { hasContractMarker } from './migration-contract';

const TAG_PATTERN = /^server-v((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const MIGRATION_PATTERN = /^[0-9]{4}_[a-z0-9_]+\.sql$/;
const RELEASE_BOT = 'github-actions[bot]';

/** `server-vX.Y.Z` (tanpa nol di depan, tanpa pra-rilis) menghasilkan versinya; selain itu `null`. */
export function parseTag(tag: string): { version: string } | null {
  const match = TAG_PATTERN.exec(tag);
  return match ? { version: match[1] as string } : null;
}

export interface ProvenanceInput {
  tag: string;
  /** SHA commit yang ditunjuk tag (tag beranotasi sudah didereferensi pemanggil). */
  tagSha: string;
  /** `status` dari `compare/main...<tagSha>`: `behind` (SHA leluhur main), `identical`, `ahead`, `diverged`. */
  mainRelation: string;
  /** `version` di `server/package.json` pada SHA itu ('' bila tak terbaca). */
  versionAtSha: string;
  /** Login pembuat GitHub Release untuk tag itu; `null` bila Release tidak ada. */
  releaseAuthor: string | null;
  releaseDraft: boolean;
  /** Image `qc-app:<sha>` ada di GHCR. */
  imageExists: boolean;
}

export function checkProvenance(input: ProvenanceInput): { ok: boolean; reason: string } {
  const parsed = parseTag(input.tag);
  if (!parsed)
    return { ok: false, reason: 'Tag harus berbentuk server-vX.Y.Z (angka tanpa nol di depan).' };
  if (!SHA_PATTERN.test(input.tagSha))
    return { ok: false, reason: 'Tag tidak menunjuk ke SHA commit 40 heksa.' };
  if (input.mainRelation !== 'behind' && input.mainRelation !== 'identical') {
    return {
      ok: false,
      reason:
        'Commit tag bukan leluhur dari main: hanya kode yang sudah masuk main yang boleh di-deploy lewat tag.',
    };
  }
  if (input.versionAtSha !== parsed.version) {
    return {
      ok: false,
      reason: `Versi di server/package.json pada commit tag (${input.versionAtSha === '' ? 'tak terbaca' : 'berbeda'}) tidak sama dengan versi tag ${parsed.version}.`,
    };
  }
  if (input.releaseAuthor === null)
    return { ok: false, reason: 'GitHub Release untuk tag itu tidak ada.' };
  if (input.releaseDraft) return { ok: false, reason: 'GitHub Release untuk tag itu masih draf.' };
  if (input.releaseAuthor !== RELEASE_BOT) {
    return {
      ok: false,
      reason: `GitHub Release untuk tag itu tidak dibuat oleh ${RELEASE_BOT} (workflow rilis).`,
    };
  }
  if (!input.imageExists) {
    return { ok: false, reason: 'Image qc-app untuk commit tag itu tidak ada di GHCR.' };
  }
  return {
    ok: true,
    reason: `Tag server-v${parsed.version} sah: leluhur main, versi cocok, Release dari workflow, image ada.`,
  };
}

export interface DowngradeInput {
  /** Nama berkas migrasi pada SHA yang sedang aktif di environment (`refs/deployed/<env>`). */
  applied: string[];
  /** Nama berkas migrasi pada SHA target. */
  target: string[];
  /** Baris pertama berkas migrasi di SHA yang sedang aktif, per nama; nama yang tak ada = tak terbaca. */
  firstLines: Record<string, string>;
  /** `izinkan_downgrade_skema`. */
  allow: boolean;
}

export function checkDowngrade(input: DowngradeInput): {
  ok: boolean;
  reason: string;
  skipped: string[];
} {
  const inTarget = new Set(input.target);
  const skipped = input.applied.filter((name) => !inTarget.has(name));
  if (skipped.length === 0) {
    return {
      ok: true,
      reason: 'Tidak ada migrasi yang dilewati (upgrade atau skema sama).',
      skipped: [],
    };
  }
  const invalid = skipped.filter((name) => !MIGRATION_PATTERN.test(name));
  if (invalid.length > 0) {
    return {
      ok: false,
      reason: 'Ada nama migrasi yang tidak sah (bukan NNNN_nama.sql); pagar downgrade menolak.',
      skipped: [],
    };
  }
  // Tak terbaca = dianggap contract (gagal tertutup), sama dengan `schema_guard` di VPS.
  const contract = skipped.filter((name) => {
    const first = input.firstLines[name];
    return first === undefined || hasContractMarker(first);
  });
  if (contract.length > 0) {
    return {
      ok: false,
      reason: `Downgrade melewati migrasi berpenanda contract atau yang tak terbaca (${contract.join(', ')}): tidak boleh dilewati, izin tidak berlaku.`,
      skipped: [],
    };
  }
  if (!input.allow) {
    return {
      ok: false,
      reason: `Downgrade ini melewati ${skipped.length} migrasi yang sudah diterapkan (${skipped.join(', ')}). Ulangi dengan izinkan_downgrade_skema bila disengaja.`,
      skipped: [],
    };
  }
  return {
    ok: true,
    reason: `Downgrade skema diizinkan: ${skipped.length} migrasi dilewati (${skipped.join(', ')}).`,
    skipped,
  };
}

function readJsonList(raw: string | undefined): string[] | null {
  try {
    const parsed: unknown = JSON.parse(raw ?? '');
    if (Array.isArray(parsed) && parsed.every((item): item is string => typeof item === 'string'))
      return parsed;
  } catch {
    // JSON rusak ditangani pemanggil (gagal tertutup)
  }
  return null;
}

function readJsonRecord(raw: string | undefined): Record<string, string> | null {
  try {
    const parsed: unknown = JSON.parse(raw ?? '');
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string') record[key] = value;
      }
      return record;
    }
  } catch {
    // JSON rusak ditangani pemanggil (gagal tertutup)
  }
  return null;
}

if (import.meta.main) {
  const env = process.env;
  const mode = process.argv[2];
  let result: { ok: boolean; reason: string; skipped?: string[] };
  if (mode === 'provenance') {
    result = checkProvenance({
      tag: env.TAG ?? '',
      tagSha: env.TAG_SHA ?? '',
      mainRelation: env.MAIN_RELATION ?? '',
      versionAtSha: env.VERSION_AT_SHA ?? '',
      releaseAuthor: env.RELEASE_EXISTS === 'true' ? (env.RELEASE_AUTHOR ?? '') : null,
      releaseDraft: env.RELEASE_DRAFT === 'true',
      imageExists: env.IMAGE_EXISTS === 'true',
    });
  } else if (mode === 'downgrade') {
    const applied = readJsonList(env.APPLIED_JSON);
    const target = readJsonList(env.TARGET_JSON);
    const firstLines = readJsonRecord(env.FIRST_LINES_JSON);
    if (applied === null || target === null || firstLines === null) {
      result = {
        ok: false,
        reason:
          'Daftar migrasi untuk pagar downgrade tidak terbaca; pagar menolak (gagal tertutup).',
      };
    } else {
      result = checkDowngrade({ applied, target, firstLines, allow: env.ALLOW === 'true' });
    }
  } else {
    result = { ok: false, reason: 'Mode tidak dikenal (provenance atau downgrade).' };
  }
  if (!result.ok) {
    console.log(`::error::${result.reason}`);
    process.exit(1);
  }
  if (result.skipped && result.skipped.length > 0) console.log(`::warning::${result.reason}`);
  else console.log(result.reason);
}
