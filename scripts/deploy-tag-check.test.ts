import { describe, expect, test } from 'bun:test';
import { checkDowngrade, checkProvenance, parseTag } from './deploy-tag-check';

const SHA = 'a'.repeat(40);

describe('parseTag', () => {
  test('server-vX.Y.Z sah menghasilkan versinya', () => {
    expect(parseTag('server-v1.2.3')).toEqual({ version: '1.2.3' });
    expect(parseTag('server-v0.0.0')).toEqual({ version: '0.0.0' });
    expect(parseTag('server-v10.20.30')).toEqual({ version: '10.20.30' });
  });

  test('bentuk lain ditolak: nol di depan, kurang bagian, tanpa awalan, pra-rilis, spasi, huruf besar, baris baru', () => {
    for (const tag of [
      'server-v01.2.3',
      'server-v1.02.3',
      'server-v1.2.03',
      'server-v1.2',
      'server-v1.2.3.4',
      'v1.2.3',
      'desktop-v1.2.3',
      'server-v1.2.3-rc1',
      'server-v1.2.3+build',
      ' server-v1.2.3',
      'server-v1.2.3 ',
      'Server-v1.2.3',
      'SERVER-V1.2.3',
      'server-v1.2.3\n',
      'server-v1.2.3\nserver-v9.9.9',
      'server-v-1.2.3',
      '',
    ]) {
      expect(parseTag(tag), JSON.stringify(tag)).toBeNull();
    }
  });
});

describe('checkProvenance', () => {
  const GOOD = {
    tag: 'server-v1.2.3',
    tagSha: SHA,
    mainRelation: 'behind',
    versionAtSha: '1.2.3',
    releaseAuthor: 'github-actions[bot]',
    releaseDraft: false,
    imageExists: true,
  };

  test('semua syarat terpenuhi lulus (SHA leluhur main = behind, atau sama dengan main = identical)', () => {
    expect(checkProvenance(GOOD).ok).toBe(true);
    expect(checkProvenance({ ...GOOD, mainRelation: 'identical' }).ok).toBe(true);
  });

  test('SHA bukan leluhur main (diverged atau ahead) ditolak', () => {
    for (const mainRelation of ['diverged', 'ahead', '', 'apa-saja']) {
      const result = checkProvenance({ ...GOOD, mainRelation });
      expect(result.ok, mainRelation).toBe(false);
      expect(result.reason).toMatch(/main/);
    }
  });

  test('versi di server/package.json pada SHA berbeda dari tag ditolak', () => {
    for (const versionAtSha of ['1.2.4', '', '0.0.0', '1.2.3-x']) {
      const result = checkProvenance({ ...GOOD, versionAtSha });
      expect(result.ok, versionAtSha).toBe(false);
      expect(result.reason).toMatch(/versi/i);
    }
  });

  test('GitHub Release untuk tag tidak ada, masih draf, atau bukan buatan github-actions[bot] ditolak', () => {
    const none = checkProvenance({ ...GOOD, releaseAuthor: null });
    expect(none.ok).toBe(false);
    expect(none.reason).toMatch(/Release/);
    const draft = checkProvenance({ ...GOOD, releaseDraft: true });
    expect(draft.ok).toBe(false);
    expect(draft.reason).toMatch(/draf/i);
    for (const releaseAuthor of [
      'rahmadmrhd',
      'github-actions',
      'GitHub-Actions[bot]',
      'dependabot[bot]',
      '',
    ]) {
      const other = checkProvenance({ ...GOOD, releaseAuthor });
      expect(other.ok, releaseAuthor).toBe(false);
      expect(other.reason).toMatch(/github-actions\[bot\]/);
    }
  });

  test('image qc-app:<sha> tidak ada di GHCR ditolak', () => {
    const result = checkProvenance({ ...GOOD, imageExists: false });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/image/i);
  });

  test('tag tak sah atau SHA tak sah ditolak sebelum syarat lain', () => {
    expect(checkProvenance({ ...GOOD, tag: 'server-v1.2' }).ok).toBe(false);
    expect(checkProvenance({ ...GOOD, tagSha: 'abc' }).ok).toBe(false);
    expect(checkProvenance({ ...GOOD, tagSha: SHA.toUpperCase() }).ok).toBe(false);
  });
});

describe('checkDowngrade', () => {
  const M1 = '0001_baseline.sql';
  const M2 = '0002_tambah_kolom.sql';
  const M3 = '0003_kolom_lagi.sql';

  test('upgrade (target punya semua migrasi aktif) dan sama lolos tanpa izin', () => {
    expect(
      checkDowngrade({ applied: [M1], target: [M1, M2], firstLines: {}, allow: false }),
    ).toEqual({
      ok: true,
      reason: expect.any(String),
      skipped: [],
    });
    expect(
      checkDowngrade({ applied: [M1, M2], target: [M1, M2], firstLines: {}, allow: false }).ok,
    ).toBe(true);
    expect(checkDowngrade({ applied: [], target: [M1], firstLines: {}, allow: false }).ok).toBe(
      true,
    );
  });

  test('downgrade biasa ditolak tanpa izin dan pesannya menyebut migrasi serta cara mengizinkan', () => {
    const result = checkDowngrade({
      applied: [M1, M2, M3],
      target: [M1],
      firstLines: { [M2]: '-- tambah kolom', [M3]: '-- kolom lagi' },
      allow: false,
    });
    expect(result.ok).toBe(false);
    expect(result.skipped).toEqual([]);
    expect(result.reason).toContain(M2);
    expect(result.reason).toContain(M3);
    expect(result.reason).toMatch(/izinkan_downgrade_skema/);
  });

  test('downgrade lolos dengan izin dan mengembalikan nama migrasi yang dilewati', () => {
    const result = checkDowngrade({
      applied: [M1, M2, M3],
      target: [M1],
      firstLines: { [M2]: '-- tambah kolom', [M3]: '-- kolom lagi' },
      allow: true,
    });
    expect(result.ok).toBe(true);
    expect(result.skipped).toEqual([M2, M3]);
  });

  test('migrasi berpenanda -- qc:contract ditolak walau berizin', () => {
    const result = checkDowngrade({
      applied: [M1, M2],
      target: [M1],
      firstLines: { [M2]: '-- qc:contract' },
      allow: true,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain(M2);
    expect(result.reason).toMatch(/contract/);
  });

  test('berkas tanpa baris pertama terbaca dianggap contract: ditolak walau berizin', () => {
    const result = checkDowngrade({ applied: [M1, M2], target: [M1], firstLines: {}, allow: true });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain(M2);
  });

  test('satu migrasi contract di antara yang biasa tetap menolak seluruhnya', () => {
    const result = checkDowngrade({
      applied: [M1, M2, M3],
      target: [M1],
      firstLines: { [M2]: '-- biasa', [M3]: '-- qc:contract' },
      allow: true,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain(M3);
  });

  test('nama migrasi tak sah ditolak walau berizin', () => {
    for (const bad of ['../x.sql', '0001_A.sql', 'x.sql', '0001_a.sql;id', '0001_a.SQL']) {
      const result = checkDowngrade({
        applied: [M1, bad],
        target: [M1],
        firstLines: { [bad]: '-- biasa' },
        allow: true,
      });
      expect(result.ok, bad).toBe(false);
    }
  });

  test('migrasi yang hanya ada di target (B \\ A) tak berpengaruh', () => {
    expect(
      checkDowngrade({ applied: [M1, M2], target: [M1, M2, M3], firstLines: {}, allow: false }).ok,
    ).toBe(true);
  });
});
