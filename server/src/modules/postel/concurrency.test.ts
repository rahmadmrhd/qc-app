import { beforeEach, describe, expect, test } from 'bun:test';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { restCall } from '@server-test/rest-call';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

// Konkurensi `postels.save`: `Promise.all` atas permintaan REST nyata (bukan tiruan). Keanggotaan item dijaga CAS di
// dalam `batch()`, nomor kembar oleh indeks `postel_numbers_key`, versi usang oleh `updated_at`.

let env: TestEnv;

const ADMIN = 'admin@gmail.com';

// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

async function call(id: string, input: unknown): Promise<CallOut> {
  return (await restCall(env, ADMIN, id, input)) as CallOut;
}

const number = (value: string) => ({ number: value, expiresOn: '2027-03-01', link: '' });

const body = (itemIds: string[], numbers: string[], extra: Record<string, unknown> = {}) => ({
  note: '',
  itemIds,
  numbers: numbers.map(number),
  attachmentIds: [],
  ...extra,
});

async function rows(sql: string, ...binds: unknown[]): Promise<Json[]> {
  return (
    await env.DB.prepare(sql)
      .bind(...binds)
      .all<Json>()
  ).results;
}

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-11T03:00:00.000Z'));
  await seedBrand(env, 'PBE');
  for (const id of ['i1', 'i2', 'i3']) {
    await seedItem(env, { id, brand: 'PBE', model: `M-${id}` });
  }
});

describe('postels.save serentak', () => {
  test('dua catatan memasang item yang sama: tepat satu berhasil, yang kalah CONFLICT pada itemIds', async () => {
    const results = await Promise.all([
      call('postels.save', body(['i1'], ['CA-1'])),
      call('postels.save', body(['i1'], ['CB-1'])),
    ]);
    const ok = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.error?.code).toBe('CONFLICT');
    expect(failed[0]?.error?.fields?.itemIds).toContain('sudah tergabung ke Postel');
    const owners = await rows("SELECT DISTINCT postel_id FROM items WHERE id = 'i1'");
    expect(owners).toHaveLength(1);
    expect(owners[0].postel_id).toBe(ok[0]?.data?.id);
    // Penyimpan yang kalah tidak meninggalkan catatan atau nomor.
    expect(await rows('SELECT id FROM postels')).toHaveLength(1);
    expect(await rows('SELECT id FROM postel_numbers')).toHaveLength(1);
  });

  test('dua catatan baru dengan nomor sama: tepat satu berhasil, yang kalah CONFLICT pada number', async () => {
    const results = await Promise.all([
      call('postels.save', body(['i1'], ['Sama-1'])),
      call('postels.save', body(['i2'], ['SAMA 1'])),
    ]);
    const ok = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.error?.code).toBe('CONFLICT');
    expect(failed[0]?.error?.fields?.number).toBeTruthy();
    expect(await rows('SELECT id FROM postels')).toHaveLength(1);
    expect(await rows("SELECT id FROM items WHERE postel_id <> ''")).toHaveLength(1);
  });

  test('dua penyimpan atas catatan yang sama dengan expectedUpdatedAt sama: tepat satu berhasil, satu basi', async () => {
    const created = (await call('postels.save', body(['i1'], ['SAT-1']))).data as Json;
    env.clock.advance(1000);
    const numbers = created.numbers as Json[];
    const edit = (note: string) => ({
      id: created.id,
      expectedUpdatedAt: created.updatedAt,
      note,
      itemIds: ['i1'],
      numbers: [
        {
          id: numbers[0].id,
          number: numbers[0].number,
          expiresOn: numbers[0].expiresOn,
          link: numbers[0].link,
        },
      ],
      attachmentIds: [],
    });
    const rest = restClient(env);
    const put = (note: string) => {
      const { expectedUpdatedAt, id, ...rest_ } = edit(note);
      return rest.put(`/postels/${id as string}`, {
        headers: { 'if-match': `"${expectedUpdatedAt as string}"` },
        body: rest_,
      });
    };
    const responses = await Promise.all([put('dari A'), put('dari B')]);
    // 412 hanya dijawab untuk galat bertanda `stale: true` pada rute berETag yang dipanggil dengan If-Match.
    expect(responses.map((r) => r.status).sort()).toEqual([200, 412]);
    const winner = responses.find((r) => r.status === 200) as Response;
    const loser = responses.find((r) => r.status === 412) as Response;
    expect((await jsonOf(loser)).code).toBe('CONFLICT');
    const note = (await rows('SELECT note FROM postels WHERE id = ?', created.id))[0].note;
    expect(note).toBe((await jsonOf(winner)).note);
    // Hanya satu entri audit perubahan (selain pembuatan).
    expect(await rows("SELECT id FROM audit_log WHERE action = 'postel.update'")).toHaveLength(1);
  });

  test('simpan dan hapus serentak atas catatan yang sama: keadaan akhir konsisten (tanpa baris yatim)', async () => {
    for (let round = 0; round < 4; round++) {
      const created = (await call('postels.save', body(['i1', 'i2'], [`R${round}-1`])))
        .data as Json;
      env.clock.advance(1000);
      const numbers = created.numbers as Json[];
      const [saved, removed] = await Promise.all([
        call('postels.save', {
          id: created.id,
          expectedUpdatedAt: created.updatedAt,
          note: `ronde ${round}`,
          itemIds: ['i1', 'i3'],
          numbers: [
            {
              id: numbers[0].id,
              number: numbers[0].number,
              expiresOn: numbers[0].expiresOn,
              link: numbers[0].link,
            },
            { number: `R${round}-2`, expiresOn: '2028-01-01', link: '' },
          ],
          attachmentIds: [],
        }),
        call('postels.remove', { id: created.id }),
      ]);
      // Hapus lunak selalu berhasil (versi yang menyela direncanakan ulang). Simpan boleh menang lebih dulu atau kalah.
      expect(removed.ok).toBe(true);
      if (!saved.ok) expect(['NOT_FOUND', 'CONFLICT']).toContain(saved.error?.code);
      // Invarian basis data: catatan terhapus lunak, tak ada nomor hidup yang tersisa (nomor yang baru dari simpanan
      // yang menang lebih dulu ikut terhapus bersama induknya), dan tak ada nomor terhapus tanpa induk terhapus.
      expect(
        await rows("SELECT id FROM postels WHERE id = ? AND deleted_at <> ''", created.id),
      ).toHaveLength(1);
      expect(await rows("SELECT id FROM postel_numbers WHERE deleted_at = ''")).toHaveLength(0);
      expect(
        await rows(
          'SELECT n.id FROM postel_numbers n JOIN postels p ON p.id = n.postel_id WHERE n.deleted_at <> p.deleted_at',
        ),
      ).toHaveLength(0);
      // Audit: catatan dihapus tepat sekali.
      expect(
        await rows(
          "SELECT id FROM audit_log WHERE action = 'postel.delete' AND target = ?",
          `postel:${created.id as string}`,
        ),
      ).toHaveLength(1);
      env.clock.advance(1000);
    }
  });

  test('tiga penyimpanan pertama serentak menghasilkan satu jenis dan tiga stiker (satu per catatan)', async () => {
    const results = await Promise.all([
      call('postels.save', body(['i1'], ['T-1'])),
      call('postels.save', body(['i2'], ['T-2'])),
      call('postels.save', body(['i3'], ['T-3'])),
    ]);
    expect(results.map((r) => r.ok)).toEqual([true, true, true]);
    const types = await rows("SELECT id FROM sticker_types WHERE system_kind = 'postel'");
    expect(types).toHaveLength(1);
    const stickers = await rows('SELECT id, name FROM stickers WHERE type_id = ?', types[0].id);
    expect(stickers).toHaveLength(3);
    expect(stickers.map((s) => s.name).sort()).toEqual([
      'Postel - M-i1',
      'Postel - M-i2',
      'Postel - M-i3',
    ]);
    expect(await rows('SELECT id FROM postels')).toHaveLength(3);
    expect(await rows('SELECT DISTINCT sticker_id FROM postels')).toHaveLength(3);
  });
});
