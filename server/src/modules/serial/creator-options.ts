import type { Env } from '@server/core/env';
import { liveWhere } from '@server/core/soft-delete';
import type { UserContext } from '@server/modules/access/context';
import type {
  ListSerialCreatorOptionsInput,
  SerialCreatorOptionDto,
  SerialCreatorOptionsPageDto,
} from '@shared/contract';
import { readableBuIds } from './access';
import { escapeLike } from './repo';
import { readsAllBus } from './service';
import { SERIAL_CREATOR_DEFAULT_LIMIT } from './validate';

const placeholders = (count: number): string => Array.from({ length: count }, () => '?').join(', ');

/**
 * Pilihan filter "Dicatat oleh": email pembuat catatan PERTAMA dari serial hidup yang boleh dibaca pemanggil (BU saat ini
 * atau riwayat; pengguna dari BU yang tak terbaca tidak bocor). Tidak memindai tabel: pembaca Semua BU memakai indeks
 * `serials_created_by`, pembaca sebagian BU digerakkan dari BU (indeks `serials_bu_deleted_created_by` dan riwayat BU),
 * dikelompokkan per pembuat dan dibatasi `LIMIT` per cabang; pencarian (nama atau email, min. 2 karakter,
 * dijaga validator) mencocokkan awalan email atau nama/email pengguna hidup. Pencatat tanpa baris pengguna hidup tampil
 * dengan email sebagai nama. Mode `ids` hanya meresolusi nama nilai terpilih (tetap dalam hak baca yang sama).
 */
export async function queryCreatorOptions(
  env: Env,
  user: UserContext,
  input: ListSerialCreatorOptionsInput,
): Promise<SerialCreatorOptionsPageDto> {
  const buIds = readableBuIds(user);
  if (buIds.length === 0) return { items: [], nextCursor: null };
  const byIds = input.ids !== undefined;
  const limit = byIds ? (input.ids?.length ?? 0) : (input.limit ?? SERIAL_CREATOR_DEFAULT_LIMIT);
  if (limit === 0) return { items: [], nextCursor: null };

  // Sumber baris: membaca SEMUA BU = satu sumber tanpa predikat BU (indeks `serials_created_by`). Pembaca sebagian BU
  // digerakkan dari BU (seperti `serials.list`): cabang BU saat ini (indeks `serials_bu_deleted_created_by`) dan cabang
  // riwayat lewat `serial_business_units` per `bu_id` (indeks `serial_bu_by_bu`), sehingga tak ada pemindaian seluruh
  // indeks pembuat; himpunan hasil kedua cabang digabung dan dideduplikasi oleh UNION.
  const allBus = readsAllBus(user, buIds);
  const sources: { from: string; binds: unknown[] }[] = allBus
    ? [{ from: `FROM serials s WHERE ${liveWhere('s')} AND s.created_by <> ''`, binds: [] }]
    : [
        {
          from: `FROM serials s WHERE ${liveWhere('s')} AND s.created_by <> '' AND s.bu_id IN (${placeholders(buIds.length)})`,
          binds: [...buIds],
        },
        {
          from: `FROM serial_business_units h JOIN serials s ON s.id = h.serial_id WHERE ${liveWhere('s')} AND s.created_by <> '' AND h.bu_id IN (${placeholders(buIds.length)})`,
          binds: [...buIds],
        },
      ];
  const where: string[] = [];
  const baseBinds: unknown[] = [];
  if (byIds) {
    const ids = input.ids ?? [];
    where.push(`s.created_by IN (${placeholders(ids.length)})`);
    baseBinds.push(...ids);
  } else if (input.cursor) {
    where.push('s.created_by > ?');
    baseBinds.push(input.cursor);
  }
  const base = where.length === 0 ? '' : ` AND ${where.join(' AND ')}`;
  const tail = ' GROUP BY s.created_by ORDER BY s.created_by LIMIT ?';

  // Varian pencarian: awalan email, atau nama/email pengguna hidup (dua cabang agar tiap cabang memakai indeksnya).
  const query = byIds ? '' : (input.query ?? '').trim().toLowerCase();
  const variants: { sql: string; binds: unknown[] }[] =
    query === ''
      ? [{ sql: '', binds: [] }]
      : [
          { sql: " AND s.created_by LIKE ? ESCAPE '!'", binds: [`${escapeLike(query)}%`] },
          {
            sql: ` AND s.created_by IN (SELECT u.email FROM users u WHERE ${liveWhere('u')} AND (LOCATE(?, LOWER(u.name)) > 0 OR LOCATE(?, u.email) > 0))`,
            binds: [query, query],
          },
        ];
  const arms: { sql: string; binds: unknown[] }[] = [];
  for (const source of sources) {
    for (const variant of variants) {
      arms.push({
        sql: `SELECT s.created_by AS email ${source.from}${base}${variant.sql}${tail}`,
        binds: [...source.binds, ...baseBinds, ...variant.binds, limit + 1],
      });
    }
  }
  const rows =
    arms.length === 1 && arms[0]
      ? await env.DB.prepare(arms[0].sql)
          .bind(...arms[0].binds)
          .all<{ email: string }>()
      : await env.DB.prepare(
          `${arms.map((arm) => `(${arm.sql})`).join(' UNION ')} ORDER BY email LIMIT ?`,
        )
          .bind(...arms.flatMap((arm) => arm.binds), limit + 1)
          .all<{ email: string }>();
  const page = rows.results.slice(0, limit);
  const names = new Map<string, string>();
  if (page.length > 0) {
    const users = await env.DB.prepare(
      `SELECT u.email, u.name FROM users u WHERE ${liveWhere('u')} AND u.email IN (${placeholders(page.length)})`,
    )
      .bind(...page.map((row) => row.email))
      .all<{ email: string; name: string }>();
    for (const row of users.results) names.set(row.email, row.name);
  }
  const items: SerialCreatorOptionDto[] = page.map((row) => ({
    email: row.email,
    name: names.get(row.email) || row.email,
  }));
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: !byIds && rows.results.length > limit && last ? last.email : null,
  };
}
