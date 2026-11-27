import { readObject } from '@server/core/validate';
import type {
  GetClFileInput,
  GetClRevisionInput,
  RevertClFileInput,
  SaveClFileInput,
} from '@shared/contract';
import {
  CL_PATH_MAX,
  CL_TEXT_MAX_BYTES,
  SETTINGS_PATH,
  validateClPath,
} from '@shared/countrylock-bundle';

const MAX_ID_LENGTH = 100;
const MESSAGE_MAX = 200;
const SEQ_MAX = 1_000_000_000;
const ROLES = ['settings', 'script', 'router'] as const;

/** Karakter kontrol yang ditolak di isi teks: semua C0 kecuali tab, LF, dan CR. */
export function hasForbiddenControl(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return true;
  }
  return false;
}

function readSeq(reader: ReturnType<typeof readObject>, key: string): number {
  const value = reader.raw(key);
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > SEQ_MAX) {
    reader.fail(key, 'Nomor revisi tidak valid');
    return 1;
  }
  return value;
}

export function validateGetClFile(raw: unknown): GetClFileInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: MAX_ID_LENGTH });
  reader.done();
  return { id };
}

export function validateSaveClFile(raw: unknown): SaveClFileInput {
  const reader = readObject(raw);
  // `str` memangkas spasi tepi: nama jalur dan pesan memang tidak boleh berspasi di tepi.
  const path = reader.str('path', { required: true, max: CL_PATH_MAX });
  const role = reader.oneOf('role', ROLES);
  const message = reader.str('message', { max: MESSAGE_MAX });
  const rawText = reader.raw('text');
  let text = '';
  if (typeof rawText !== 'string') {
    reader.fail('text', 'Isi berkas harus berupa teks');
  } else if (hasForbiddenControl(rawText)) {
    reader.fail('text', 'Isi berkas memuat karakter kontrol yang tidak diizinkan');
  } else if (new TextEncoder().encode(rawText).length > CL_TEXT_MAX_BYTES) {
    reader.fail('text', `Isi berkas maksimal ${CL_TEXT_MAX_BYTES / 1024} KB`);
  } else {
    text = rawText;
  }
  if (path !== '') {
    const pathProblem = validateClPath(path);
    if (pathProblem !== null) reader.fail('path', pathProblem);
  }
  const rawBase = reader.raw('baseSeq');
  let baseSeq: number | undefined;
  if (rawBase !== undefined && rawBase !== null) baseSeq = readSeq(reader, 'baseSeq');
  const expectedUpdatedAt = reader.str('expectedUpdatedAt', { max: 40 });
  reader.done();
  return {
    path,
    role,
    text,
    ...(message === '' ? {} : { message }),
    ...(baseSeq === undefined ? {} : { baseSeq }),
    ...(expectedUpdatedAt === '' ? {} : { expectedUpdatedAt }),
  };
}

/** `seq` ikut jalur URL: teks angka bulat positif. */
export function validateGetClRevision(raw: unknown): GetClRevisionInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: MAX_ID_LENGTH });
  const seq = reader.raw('seq');
  if (typeof seq !== 'string' || !/^[1-9]\d{0,8}$/.test(seq)) {
    reader.fail('seq', 'Nomor revisi tidak valid');
  }
  reader.done();
  return { id, seq: seq as string };
}

export function validateRevertClFile(raw: unknown): RevertClFileInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: MAX_ID_LENGTH });
  const seq = readSeq(reader, 'seq');
  const message = reader.str('message', { max: MESSAGE_MAX });
  reader.done();
  return { id, seq, ...(message === '' ? {} : { message }) };
}

/** Aturan peran/jalur dokumen pengaturan: `settings.json` hanya berperan `settings`, dan sebaliknya. */
export function settingsRoleProblem(path: string, role: string): string | null {
  if (role === 'settings' && path !== SETTINGS_PATH) {
    return `Berkas berperan pengaturan harus bernama ${SETTINGS_PATH}`;
  }
  if (path === SETTINGS_PATH && role !== 'settings') {
    return `${SETTINGS_PATH} harus berperan pengaturan`;
  }
  return null;
}
