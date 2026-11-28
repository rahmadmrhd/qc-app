import { writeAudit } from '@server/core/audit';
import { isRetryableWriteError } from '@server/core/cas';
import type { ActorRef } from '@server/core/context';
import { DbError } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError, staleError } from '@server/core/errors';
import { newId } from '@server/core/id';
import { readObject } from '@server/core/validate';
import type {
  ClBundleDetailDto,
  ClBundleDto,
  ClBundleFirmwareDto,
  ClDraftDto,
  GetClBundleInput,
  PublishClBundleInput,
  ReactivateClBundleInput,
} from '@shared/contract';
import {
  type ClDraftFile,
  type ClManifest,
  type ClPreviousBundle,
  canonicalHashInput,
  parseSettingsFile,
  pathKey,
  routerUsedBy,
  validateDraft,
} from '@shared/countrylock-bundle';
import { toFileDto } from './files-service';
import { listClFirmwares } from './firmware-service';
import { sha256Hex } from './hash';
import {
  bundleSettingsText,
  type ClBundleRecord,
  type ClRole,
  type DraftFingerprint,
  draftFingerprint,
  draftGuardStmts,
  getBundleByNumber,
  insertBundleFilesStmt,
  insertBundleStmt,
  latestBundle,
  listBundles,
  listLiveFilesWithText,
  reserveBundleNumber,
} from './repo';

/** `minApp` fase 1; dinaikkan hanya bila `schema` manifest naik. */
const MIN_APP = '0.0.0';
const NOTE_MAX = 200;
const PUBLISH_ATTEMPTS = 4;
const LIST_LIMIT = 100;
const STALE_MESSAGE =
  'Draf atau daftar bundel berubah saat diterbitkan. Muat ulang lalu coba lagi.';

// --- Validasi masukan -------------------------------------------------------------------------------------------

export function validatePublishClBundle(raw: unknown): PublishClBundleInput {
  const reader = readObject(raw);
  const note = reader.str('note', { max: NOTE_MAX });
  reader.done();
  return { note };
}

function readNumber(reader: ReturnType<typeof readObject>): string {
  const value = reader.raw('number');
  if (typeof value !== 'string' || !/^[1-9]\d{0,8}$/.test(value)) {
    reader.fail('number', 'Nomor bundel tidak valid');
  }
  return value as string;
}

/** `number` ikut jalur URL: teks angka bulat positif. */
export function validateGetClBundle(raw: unknown): GetClBundleInput {
  const reader = readObject(raw);
  const number = readNumber(reader);
  reader.done();
  return { number };
}

export function validateReactivateClBundle(raw: unknown): ReactivateClBundleInput {
  const reader = readObject(raw);
  const number = readNumber(reader);
  const note = reader.str('note', { max: NOTE_MAX });
  reader.done();
  return { number, note };
}

// --- Draf ---------------------------------------------------------------------------------------------------------

interface DraftComputation {
  dto: ClDraftDto;
  fingerprint: DraftFingerprint;
  manifestFiles: ClManifest['files'];
  manifestFirmwares: ClBundleFirmwareDto[];
  hasErrors: boolean;
}

/** Hash bundel dari berkas (jalur + sha256) dan kredensial router di `settings.json` (kosong bila tak terbaca). */
async function computeHashes(
  files: { path: string; role: ClRole; sha256: string }[],
  settingsText: string | undefined,
  firmwares: ClBundleFirmwareDto[],
): Promise<{ computerHash: string; routerHash: string }> {
  // Spek 5.1: bagian pengaturan komputer (daftar merk dan firmware) ikut hash komputer. JSON kanonik: urut merk + kode.
  const sortedFirmwares = [...firmwares].sort((a, b) =>
    a.brand !== b.brand
      ? a.brand < b.brand
        ? -1
        : 1
      : a.code < b.code
        ? -1
        : a.code > b.code
          ? 1
          : 0,
  );
  const computerHash = await sha256Hex(
    canonicalHashInput(files, `firmwares\n${JSON.stringify(sortedFirmwares)}`),
  );
  let credentials = '';
  if (settingsText !== undefined) {
    const parsed = parseSettingsFile(settingsText);
    if (parsed.ok) {
      const { ip, username, password, interfaceBridge } = parsed.settings.router;
      credentials = await sha256Hex(JSON.stringify({ ip, username, password, interfaceBridge }));
    }
  }
  const routerFiles = files.filter((file) => file.role === 'router');
  const routerHash = await sha256Hex(canonicalHashInput(routerFiles, credentials));
  return { computerHash, routerHash };
}

function sameContent(
  manifest: ClManifest,
  computerHash: string,
  routerHash: string,
  firmwares: ClBundleFirmwareDto[],
): boolean {
  return (
    manifest.computerHash === computerHash &&
    manifest.routerHash === routerHash &&
    JSON.stringify(manifest.firmwares) === JSON.stringify(firmwares)
  );
}

function parseManifest(record: ClBundleRecord): ClManifest {
  return JSON.parse(record.manifestJson) as ClManifest;
}

async function computeDraft(env: Env): Promise<DraftComputation> {
  // Sidik jari DULU, isi sesudahnya (lihat `draftFingerprint`).
  const fingerprint = await draftFingerprint(env.DB);
  // Berkas + revisi + isi teks dalam SATU kueri (satu snapshot konsisten).
  const [heads, firmwares, latest] = await Promise.all([
    listLiveFilesWithText(env.DB),
    listClFirmwares(env),
    latestBundle(env.DB),
  ]);
  const draftFiles: ClDraftFile[] = heads.map(({ file, revision, text }) => ({
    path: file.path,
    role: file.role,
    sha256: revision.sha256,
    size: revision.size,
    ...(file.kind === 'text' ? { text: text ?? '' } : {}),
  }));
  // Pengaturan bundel terbit terakhir = pembanding peringatan ADDRESS_CHANGED.
  let previous: ClPreviousBundle | undefined;
  if (latest !== null) {
    const previousText = await bundleSettingsText(env.DB, latest.id);
    const parsed = previousText === null ? null : parseSettingsFile(previousText);
    if (parsed?.ok) previous = { settings: parsed.settings };
  }
  const manifestFiles: ClManifest['files'] = [...draftFiles]
    .sort((a, b) => {
      const left = pathKey(a.path);
      const right = pathKey(b.path);
      if (left !== right) return left < right ? -1 : 1;
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    })
    .map(({ path, role, sha256, size }) => ({ path, role, sha256, size }));
  const manifestFirmwares: ClBundleFirmwareDto[] = firmwares.map((firmware) => ({
    brand: firmware.brand,
    code: firmware.code,
    label: firmware.label,
    scriptPath: firmware.scriptPath,
    parallel: firmware.parallel,
  }));
  const issues = validateDraft(
    draftFiles,
    firmwares.map(({ brand, code, scriptPath, parallel }) => ({
      brand,
      code,
      scriptPath,
      parallel,
    })),
    previous,
  );
  const usedBy = routerUsedBy(
    draftFiles,
    firmwares.map(({ brand, code, scriptPath, parallel }) => ({
      brand,
      code,
      scriptPath,
      parallel,
    })),
  );
  const settingsText = draftFiles.find((file) => file.role === 'settings')?.text;
  const { computerHash, routerHash } = await computeHashes(
    manifestFiles,
    settingsText,
    manifestFirmwares,
  );
  const changed =
    latest === null ||
    !sameContent(parseManifest(latest), computerHash, routerHash, manifestFirmwares);
  return {
    fingerprint,
    manifestFiles,
    manifestFirmwares,
    hasErrors: issues.some((issue) => issue.severity === 'error'),
    dto: {
      files: heads.map((head) => toFileDto(head, usedBy)),
      firmwares,
      issues,
      computerHash,
      routerHash,
      changed,
    },
  };
}

/** Draf saat ini: berkas hidup, firmware, temuan validasi, hash kandidat bundel, dan apakah berbeda dari bundel terbit terakhir. */
export async function clDraft(env: Env): Promise<ClDraftDto> {
  return (await computeDraft(env)).dto;
}

// --- Bundel -------------------------------------------------------------------------------------------------------

function toBundleDto(record: ClBundleRecord, fileCount: number): ClBundleDto {
  return {
    number: record.number,
    computerHash: record.computerHash,
    routerHash: record.routerHash,
    minApp: record.minApp,
    note: record.note,
    publishedBy: record.publishedBy,
    createdAt: record.createdAt,
    sourceNumber: record.sourceNumber,
    fileCount,
  };
}

export async function listClBundles(env: Env): Promise<ClBundleDto[]> {
  return (await listBundles(env.DB, LIST_LIMIT)).map((record) =>
    toBundleDto(record, parseManifest(record).files.length),
  );
}

export async function clBundleDetail(
  env: Env,
  input: GetClBundleInput,
): Promise<ClBundleDetailDto> {
  const record = await getBundleByNumber(env.DB, Number(input.number));
  if (record === null) throw appError('NOT_FOUND', 'Bundel tidak ditemukan');
  const manifest = parseManifest(record);
  return {
    ...toBundleDto(record, manifest.files.length),
    files: manifest.files,
    firmwares: manifest.firmwares,
  };
}

/** Kegagalan tulis yang aman diulang setelah memuat ulang keadaan: penjaga CAS, deadlock, atau nomor bundel bentrok. */
function isRetryableBundleError(error: unknown): boolean {
  if (isRetryableWriteError(error)) return true;
  return (
    error instanceof DbError &&
    error.kind === 'duplicate' &&
    error.key?.endsWith('cl_bundles_number') === true
  );
}

interface BundleWrite {
  action: 'countrylock.publish' | 'countrylock.reactivate';
  manifest: Omit<ClManifest, 'number'>;
  note: string;
  sourceNumber: number | null;
  guard: ReturnType<typeof draftGuardStmts>;
}

async function writeBundle(env: Env, plan: BundleWrite, actor: ActorRef): Promise<ClBundleDto> {
  const { number, statements: numberStatements } = await reserveBundleNumber(env.DB);
  const now = nowIso(env);
  const manifest: ClManifest = { ...plan.manifest, number };
  const record: ClBundleRecord = {
    id: newId(),
    number,
    computerHash: manifest.computerHash,
    routerHash: manifest.routerHash,
    minApp: manifest.minApp,
    manifestJson: JSON.stringify(manifest),
    note: plan.note,
    publishedBy: actor.email,
    sourceNumber: plan.sourceNumber,
    createdAt: now,
  };
  await env.DB.batch([
    ...plan.guard,
    ...numberStatements,
    insertBundleStmt(env.DB, record),
    insertBundleFilesStmt(env.DB, record.id, manifest.files),
    writeAudit(env.DB, {
      ts: now,
      actor: actor.email,
      action: plan.action,
      target: `Bundel ${number}`,
      targetId: record.id,
      before: null,
      after: {
        number,
        computerHash: record.computerHash,
        routerHash: record.routerHash,
        fileCount: manifest.files.length,
        note: record.note,
        sourceNumber: record.sourceNumber,
      },
    }),
  ]);
  return toBundleDto(record, manifest.files.length);
}

/**
 * Menerbitkan draf sebagai bundel baru. Ditolak `CONFLICT` bila ada temuan ber-severity error atau draf sama dengan
 * bundel terbit terakhir. Nomor dari penghitung CAS dan penjaga sidik jari draf berada di `batch()` yang sama dengan
 * penulisan; bila penerbit serentak menyela, draf dihitung ulang (yang kalah biasanya menjadi `changed = false` =
 * `CONFLICT`), jadi nomor tidak pernah ganda.
 */
export async function publishClBundle(
  env: Env,
  input: PublishClBundleInput,
  actor: ActorRef,
): Promise<ClBundleDto> {
  for (let attempt = 0; attempt < PUBLISH_ATTEMPTS; attempt++) {
    const draft = await computeDraft(env);
    if (draft.hasErrors) {
      throw appError('CONFLICT', 'Draf masih memuat kesalahan. Perbaiki lalu coba lagi.');
    }
    if (!draft.dto.changed) {
      throw appError('CONFLICT', 'Tidak ada perubahan sejak bundel terakhir diterbitkan');
    }
    try {
      return await writeBundle(
        env,
        {
          action: 'countrylock.publish',
          manifest: {
            schema: 1,
            minApp: MIN_APP,
            computerHash: draft.dto.computerHash,
            routerHash: draft.dto.routerHash,
            files: draft.manifestFiles,
            firmwares: draft.manifestFirmwares,
          },
          note: input.note,
          sourceNumber: null,
          guard: draftGuardStmts(env.DB, draft.fingerprint),
        },
        actor,
      );
    } catch (error) {
      if (!isRetryableBundleError(error)) throw error;
    }
  }
  throw staleError(STALE_MESSAGE);
}

/**
 * Mengaktifkan ulang bundel lama sebagai bundel BARU (nomor berikutnya, `sourceNumber` = nomor asal) dengan isi persis
 * bundel asal (manifest disalin; revisi berkas tak perlu masih sama dengan draf). Ditolak `CONFLICT` bila isinya sudah
 * sama dengan bundel terbit terakhir.
 */
export async function reactivateClBundle(
  env: Env,
  input: ReactivateClBundleInput,
  actor: ActorRef,
): Promise<ClBundleDto> {
  const source = await getBundleByNumber(env.DB, Number(input.number));
  if (source === null) throw appError('NOT_FOUND', 'Bundel tidak ditemukan');
  const sourceManifest = parseManifest(source);
  for (let attempt = 0; attempt < PUBLISH_ATTEMPTS; attempt++) {
    const latest = await latestBundle(env.DB);
    if (
      latest !== null &&
      sameContent(
        parseManifest(latest),
        sourceManifest.computerHash,
        sourceManifest.routerHash,
        sourceManifest.firmwares,
      )
    ) {
      throw appError('CONFLICT', 'Bundel terbit terakhir sudah berisi sama dengan bundel ini');
    }
    try {
      return await writeBundle(
        env,
        {
          action: 'countrylock.reactivate',
          manifest: {
            schema: sourceManifest.schema,
            minApp: sourceManifest.minApp,
            computerHash: sourceManifest.computerHash,
            routerHash: sourceManifest.routerHash,
            files: sourceManifest.files,
            firmwares: sourceManifest.firmwares,
          },
          note: input.note,
          sourceNumber: source.number,
          guard: [],
        },
        actor,
      );
    } catch (error) {
      if (!isRetryableBundleError(error)) throw error;
    }
  }
  throw staleError(STALE_MESSAGE);
}
