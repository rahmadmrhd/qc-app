import { writeAudit } from '@server/core/audit';
import { batchGuarded } from '@server/core/cas';
import type { ActorRef } from '@server/core/context';
import type { DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError } from '@server/core/errors';
import { newId } from '@server/core/id';
import { readObject } from '@server/core/validate';
import type { ImportClInput, ImportClResult } from '@shared/contract';
import {
  CL_FILES_MAX,
  CL_IMPORT_MAX_JSON_BYTES,
  CL_PATH_MAX,
  CL_TEXT_MAX_BYTES,
  type ClBrand,
  type ClIssue,
  FIRMWARE_CODE_MAX,
  parseSettingsFile,
  pathKey,
  SETTINGS_PATH,
  validateClPath,
} from '@shared/countrylock-bundle';
import { hasControlChars } from '@shared/text';
import { sha256Hex } from './hash';
import {
  CL_CONFLICTS,
  type ClFileRecord,
  type ClRevisionRecord,
  firmwareRows,
  insertFileStmt,
  insertRevisionStmt,
  listFileHeads,
} from './repo';
import { hasForbiddenControl, settingsRoleProblem } from './validate';

const BRANDS = ['mikrotik', 'ubiquiti'] as const;
const FIRMWARES_MAX = 200;
const LABEL_MAX = 120;
const IMPORT_MESSAGE = 'Impor dari konfigurasi lama';
const STALE_MESSAGE = 'Berkas draf berubah saat diimpor. Coba lagi.';

// --- Validasi -----------------------------------------------------------------------------------------------------

type Reader = ReturnType<typeof readObject>;

function brandOf(reader: Reader, where: string, value: unknown): ClBrand {
  if (value === 'mikrotik' || value === 'ubiquiti') return value;
  reader.fail(where, `Merk harus salah satu dari ${BRANDS.join(', ')}`);
  return 'mikrotik';
}

function readScripts(reader: Reader): ImportClInput['scripts'] {
  const raw = reader.raw('scripts');
  if (!Array.isArray(raw)) {
    reader.fail('scripts', 'Daftar skrip harus berupa larik');
    return [];
  }
  if (raw.length + 1 > CL_FILES_MAX) {
    reader.fail('scripts', `Maksimal ${CL_FILES_MAX - 1} skrip per impor`);
    return [];
  }
  const scripts: ImportClInput['scripts'] = [];
  const seen = new Set<string>();
  raw.forEach((entry, index) => {
    const where = `scripts[${index}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      reader.fail(where, 'Entri skrip harus berupa objek');
      return;
    }
    const item = entry as Record<string, unknown>;
    const path = item.path;
    const text = item.text;
    if (typeof path !== 'string' || path === '' || path.length > CL_PATH_MAX) {
      reader.fail(`${where}.path`, 'Nama berkas tidak valid');
      return;
    }
    const pathProblem = validateClPath(path) ?? settingsRoleProblem(path, 'script');
    if (pathProblem !== null) {
      reader.fail(`${where}.path`, pathProblem);
      return;
    }
    if (seen.has(pathKey(path))) {
      reader.fail(`${where}.path`, 'Nama berkas kembar dalam impor');
      return;
    }
    seen.add(pathKey(path));
    if (typeof text !== 'string') {
      reader.fail(`${where}.text`, 'Isi berkas harus berupa teks');
      return;
    }
    if (hasForbiddenControl(text)) {
      reader.fail(`${where}.text`, 'Isi berkas memuat karakter kontrol yang tidak diizinkan');
      return;
    }
    if (new TextEncoder().encode(text).length > CL_TEXT_MAX_BYTES) {
      reader.fail(`${where}.text`, `Isi berkas maksimal ${CL_TEXT_MAX_BYTES / 1024} KB`);
      return;
    }
    scripts.push({ path, text, brand: brandOf(reader, `${where}.brand`, item.brand) });
  });
  return scripts;
}

function readFirmwares(reader: Reader): ImportClInput['firmwares'] {
  const raw = reader.raw('firmwares');
  if (!Array.isArray(raw)) {
    reader.fail('firmwares', 'Daftar firmware harus berupa larik');
    return [];
  }
  if (raw.length > FIRMWARES_MAX) {
    reader.fail('firmwares', `Maksimal ${FIRMWARES_MAX} firmware per impor`);
    return [];
  }
  const firmwares: ImportClInput['firmwares'] = [];
  raw.forEach((entry, index) => {
    const where = `firmwares[${index}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      reader.fail(where, 'Entri firmware harus berupa objek');
      return;
    }
    const item = entry as Record<string, unknown>;
    const code = item.code;
    const label = item.label;
    const scriptPath = item.scriptPath;
    if (
      typeof code !== 'string' ||
      code === '' ||
      code.length > FIRMWARE_CODE_MAX ||
      hasControlChars(code)
    ) {
      reader.fail(`${where}.code`, 'Kode firmware tidak valid');
      return;
    }
    if (typeof label !== 'string' || label.length > LABEL_MAX || hasControlChars(label)) {
      reader.fail(`${where}.label`, 'Label firmware tidak valid');
      return;
    }
    let path: string | null = null;
    if (scriptPath !== null && scriptPath !== undefined) {
      if (
        typeof scriptPath !== 'string' ||
        scriptPath.length > CL_PATH_MAX ||
        validateClPath(scriptPath) !== null
      ) {
        reader.fail(`${where}.scriptPath`, 'Jalur skrip tidak valid');
        return;
      }
      path = scriptPath;
    }
    firmwares.push({
      brand: brandOf(reader, `${where}.brand`, item.brand),
      code,
      label,
      scriptPath: path,
    });
  });
  return firmwares;
}

/**
 * Memvalidasi seluruh masukan impor SEBELUM ada penulisan (satu entri jahat = tak ada yang disimpan). Selain batas per
 * bidang, JSON permintaan dibatasi `CL_IMPORT_MAX_JSON_BYTES`: lebih besar dari itu `VALIDATION` dan klien memecah impor.
 */
export function validateImportCl(raw: unknown): ImportClInput {
  const reader = readObject(raw);
  if (new TextEncoder().encode(JSON.stringify(raw ?? null)).length > CL_IMPORT_MAX_JSON_BYTES) {
    reader.fail(
      '_',
      `Impor terlalu besar (maks. ${Math.floor(CL_IMPORT_MAX_JSON_BYTES / 1024)} KB per panggilan); pecah menjadi beberapa panggilan`,
    );
    reader.done();
  }
  const rawSettings = reader.raw('settings');
  let settings: ImportClInput['settings'] | undefined;
  if (typeof rawSettings !== 'object' || rawSettings === null || Array.isArray(rawSettings)) {
    reader.fail('settings', 'Pengaturan harus berupa objek');
  } else {
    const parsed = parseSettingsFile(JSON.stringify(rawSettings));
    if (parsed.ok) settings = parsed.settings;
    else reader.fail('settings', parsed.error);
  }
  const scripts = readScripts(reader);
  const firmwares = readFirmwares(reader);
  reader.done();
  return { settings: settings as ImportClInput['settings'], scripts, firmwares };
}

// --- Impor --------------------------------------------------------------------------------------------------------

/**
 * Impor sekali pakai (idempoten): membuat HANYA berkas yang belum ada (nama hidup sama = dilewati; isi berbeda hanya
 * dilaporkan di `issues`, tidak menimpa), mengaitkan `script_path` firmware yang sudah ada dan masih kosong, dan melaporkan
 * kode firmware tak dikenal tanpa membuatnya. Semua penulisan (berkas, revisi 1, kaitan firmware, audit) satu `batch()`.
 */
export async function importCountryLock(
  env: Env,
  input: ImportClInput,
  actor: ActorRef,
): Promise<ImportClResult> {
  const settingsText = `${JSON.stringify(input.settings, null, 2)}\n`;
  const incoming: { path: string; text: string; role: 'settings' | 'script'; brand?: ClBrand }[] = [
    { path: SETTINGS_PATH, text: settingsText, role: 'settings' },
    ...input.scripts.map((script) => ({ ...script, role: 'script' as const })),
  ];

  const heads = await listFileHeads(env.DB);
  const existing = new Map(heads.map((head) => [pathKey(head.file.path), head]));
  const issues: ClIssue[] = [];
  const statements: DbStatement[] = [];
  const now = nowIso(env);
  const created: string[] = [];
  let skipped = 0;

  for (const file of incoming) {
    const sha256 = await sha256Hex(file.text);
    const head = existing.get(pathKey(file.path));
    if (head !== undefined) {
      skipped += 1;
      if (head.file.path !== file.path) {
        issues.push({
          severity: 'warning',
          code: 'IMPORT_CONTENT_DIFFERS',
          path: file.path,
          message: `Berkas ${head.file.path} sudah ada (beda huruf besar/kecil); tidak ditimpa`,
        });
      } else if (head.file.role !== file.role || head.file.kind !== 'text') {
        issues.push({
          severity: 'warning',
          code: 'IMPORT_ROLE_MISMATCH',
          path: file.path,
          message: 'Berkas sudah ada dengan peran atau jenis berbeda; tidak ditimpa',
        });
      } else if (head.revision.sha256 !== sha256) {
        issues.push({
          severity: 'warning',
          code: 'IMPORT_CONTENT_DIFFERS',
          path: file.path,
          message: 'Berkas sudah ada dengan isi berbeda; isi lama dipertahankan',
        });
      }
      continue;
    }
    const id = newId();
    const record: ClFileRecord = {
      id,
      path: file.path,
      role: file.role,
      kind: 'text',
      headRev: 1,
      removedAt: '',
      createdAt: now,
      updatedAt: now,
    };
    const revision: ClRevisionRecord = {
      id: newId(),
      fileId: id,
      seq: 1,
      sha256,
      size: new TextEncoder().encode(file.text).length,
      textBody: file.text,
      message: IMPORT_MESSAGE,
      author: actor.email,
      createdAt: now,
    };
    statements.push(insertFileStmt(env.DB, record), insertRevisionStmt(env.DB, revision));
    created.push(file.path);
  }

  if (heads.length + created.length > CL_FILES_MAX) {
    throw appError('VALIDATION', `Draf maksimal ${CL_FILES_MAX} berkas`, {
      scripts: `Draf maksimal ${CL_FILES_MAX} berkas`,
    });
  }

  // Kaitan firmware: skrip harus berupa berkas skrip hidup (sudah ada atau dibuat di impor ini).
  const scriptKeys = new Set<string>();
  for (const head of heads) {
    if (head.file.role === 'script') scriptKeys.add(pathKey(head.file.path));
  }
  for (const script of input.scripts) {
    if (!existing.has(pathKey(script.path))) scriptKeys.add(pathKey(script.path));
  }
  const brandOfScript = new Map(
    input.scripts.map((script) => [pathKey(script.path), script.brand]),
  );
  // Jalur berkas SEBENARNYA (huruf besar/kecil persis seperti berkas hidup atau berkas yang dibuat impor ini).
  const realPathOf = new Map<string, string>();
  for (const script of input.scripts) realPathOf.set(pathKey(script.path), script.path);
  for (const head of heads) realPathOf.set(pathKey(head.file.path), head.file.path);
  const firmwares = new Map(
    (await firmwareRows(env.DB)).map((row) => [`${row.brand}:${row.code}`, row]),
  );
  const linkStatementIndexes: number[] = [];
  const plannedLinks = new Map<string, string>();
  for (const wanted of input.firmwares) {
    const label = `${wanted.brand}/${wanted.code}`;
    const row = firmwares.get(`${wanted.brand}:${wanted.code}`);
    if (row === undefined) {
      issues.push({
        severity: 'warning',
        code: 'IMPORT_FIRMWARE_UNKNOWN',
        message: `Firmware ${label} belum ada di daftar firmware; tidak dibuat`,
      });
      continue;
    }
    if (wanted.scriptPath === null) continue;
    if (!scriptKeys.has(pathKey(wanted.scriptPath))) {
      issues.push({
        severity: 'warning',
        code: 'IMPORT_FIRMWARE_SCRIPT_MISSING',
        path: wanted.scriptPath,
        message: `Skrip firmware ${label} belum ada di draf; kaitan dilewati`,
      });
      continue;
    }
    const scriptBrand = brandOfScript.get(pathKey(wanted.scriptPath));
    if (scriptBrand !== undefined && scriptBrand !== wanted.brand) {
      issues.push({
        severity: 'warning',
        code: 'IMPORT_BRAND_MISMATCH',
        path: wanted.scriptPath,
        message: `Skrip firmware ${label} berasal dari merk ${scriptBrand}; kaitan dilewati`,
      });
      continue;
    }
    const realPath = realPathOf.get(pathKey(wanted.scriptPath)) ?? wanted.scriptPath;
    const alreadyPlanned = plannedLinks.get(row.id);
    if (alreadyPlanned !== undefined) {
      // Entri ganda untuk firmware yang sama dalam satu impor: yang pertama menang.
      if (pathKey(alreadyPlanned) !== pathKey(realPath)) {
        issues.push({
          severity: 'warning',
          code: 'IMPORT_FIRMWARE_LINK_DIFFERS',
          path: wanted.scriptPath,
          message: `Firmware ${label} sudah menaut skrip lain; tidak diubah`,
        });
      }
      continue;
    }
    if (row.scriptPath !== null && pathKey(row.scriptPath) === pathKey(realPath)) continue;
    if (row.scriptPath !== null) {
      issues.push({
        severity: 'warning',
        code: 'IMPORT_FIRMWARE_LINK_DIFFERS',
        path: wanted.scriptPath,
        message: `Firmware ${label} sudah menaut skrip lain; tidak diubah`,
      });
      continue;
    }
    plannedLinks.set(row.id, realPath);
    linkStatementIndexes.push(statements.length);
    statements.push(
      env.DB.prepare(
        "UPDATE cl_firmwares SET script_path = ?, updated_at = ? WHERE id = ? AND removed_at = '' AND script_path IS NULL",
      ).bind(realPath, now, row.id),
    );
  }

  const planned = linkStatementIndexes.length;
  const result: ImportClResult = {
    filesCreated: created.length,
    filesSkipped: skipped,
    firmwaresLinked: planned,
    issues,
  };
  if (statements.length === 0) return result;

  statements.push(
    writeAudit(env.DB, {
      ts: now,
      actor: actor.email,
      action: 'countrylock.import',
      target: 'Impor Country Lock',
      targetId: '',
      before: null,
      after: {
        filesCreated: created.length,
        filesSkipped: skipped,
        firmwaresLinked: planned,
        paths: created,
      },
    }),
  );
  const results = await batchGuarded(env.DB, statements, CL_CONFLICTS, STALE_MESSAGE);
  // Hitungan jujur: hanya UPDATE yang benar-benar mengubah baris (penjaga `script_path IS NULL` dapat mengalahkan kita).
  result.firmwaresLinked = linkStatementIndexes.filter(
    (index) => (results[index]?.meta.changes ?? 0) > 0,
  ).length;
  return result;
}
