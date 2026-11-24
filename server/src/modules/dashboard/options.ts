import type { Env } from '@server/core/env';
import { liveWhere } from '@server/core/soft-delete';
import type { UserContext } from '@server/modules/access/context';
import { readableBuIds } from '@server/modules/serial/access';
import { escapeLike } from '@server/modules/serial/repo';
import type {
  DashboardOption,
  DashboardOptionKind,
  DashboardOptionsDto,
  DashboardOptionsInput,
} from '@shared/dashboard';
import { OPTIONS_PAGE_DEFAULT, widgetMeta } from '@shared/dashboard';
import { hasLevel } from '@shared/permissions';
import { widgetAllowed } from './scope';

interface Page {
  options: DashboardOption[];
  /** Kursor halaman berikutnya (offset), hanya bila masih ada sisa. */
  next?: string;
}

interface Query {
  /** Kata pencarian (sudah dipangkas), kosong = tanpa pencarian. */
  search: string;
  /** Id yang diresolusi; bila ada, mengabaikan `search`, `offset`, dan `limit`. */
  ids: string[] | undefined;
  offset: number;
  limit: number;
}

/** Pola `LIKE` (tanpa peka huruf besar-kecil lewat `LOWER`); `!` = karakter lolos. */
const likePattern = (search: string) => `%${escapeLike(search.toLowerCase())}%`;
const marksOf = (values: readonly unknown[]) => values.map(() => '?').join(', ');

function pageOf<T extends { id: string }>(
  rows: readonly T[],
  query: Query,
  toOption: (row: T) => DashboardOption,
): Page {
  if (query.ids) return { options: rows.map(toOption) };
  const visible = rows.slice(0, query.limit);
  const page: Page = { options: visible.map(toOption) };
  if (rows.length > query.limit) page.next = String(query.offset + query.limit);
  return page;
}

/** `LIMIT`/`OFFSET` dari bilangan bulat yang sudah divalidasi; `limit + 1` baris dibaca untuk mengetahui ada sisa. */
function windowSql(query: Query): string {
  if (query.ids) return '';
  const limit = Math.trunc(query.limit) + 1;
  const offset = Math.trunc(query.offset);
  return `LIMIT ${limit} OFFSET ${offset}`;
}

async function customers(env: Env, query: Query): Promise<Page> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (query.ids) {
    where.push(`c.id IN (${marksOf(query.ids)})`);
    binds.push(...query.ids);
  } else if (query.search !== '') {
    where.push("LOWER(c.name) LIKE ? ESCAPE '!'");
    binds.push(likePattern(query.search));
  }
  const extra = where.map((clause) => ` AND ${clause}`).join('');
  const rows = await env.DB.prepare(
    `SELECT c.id, c.name FROM customers c WHERE ${liveWhere('c')}${extra} ORDER BY c.name, c.id ${windowSql(query)}`,
  )
    .bind(...binds)
    .all<{ id: string; name: string }>();
  return pageOf(rows.results, query, (row) => ({ value: row.id, label: row.name }));
}

async function items(env: Env, user: UserContext, query: Query): Promise<Page> {
  const buIds = widgetAllowed(user, widgetMeta('sn.recorded')) ? readableBuIds(user) : [];
  if (buIds.length === 0) return { options: [] };
  const where: string[] = [];
  const binds: unknown[] = [...buIds];
  if (query.ids) {
    where.push(`i.id IN (${marksOf(query.ids)})`);
    binds.push(...query.ids);
  } else if (query.search !== '') {
    where.push(
      "LOWER(CONCAT(CASE WHEN b.deleted_at = '' THEN b.name ELSE '' END, ' ', i.model)) LIKE ? ESCAPE '!'",
    );
    binds.push(likePattern(query.search));
  }
  const extra = where.map((clause) => ` AND ${clause}`).join('');
  const rows = await env.DB.prepare(
    `SELECT i.id, i.model, CASE WHEN b.deleted_at = '' THEN b.name ELSE '' END AS brand_name FROM items i LEFT JOIN brands b ON b.id = i.brand_id WHERE ${liveWhere('i')} AND EXISTS (SELECT 1 FROM item_business_units ibu WHERE ibu.item_id = i.id AND ibu.bu_id IN (${marksOf(buIds)}))${extra} ORDER BY brand_name, i.model, i.id ${windowSql(query)}`,
  )
    .bind(...binds)
    .all<{ id: string; model: string; brand_name: string | null }>();
  return pageOf(rows.results, query, (row) => ({
    value: row.id,
    label: `${row.brand_name ?? ''} ${row.model.trim()}`.trim(),
  }));
}

async function stickerTypes(env: Env, query: Query): Promise<Page> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (query.ids) {
    where.push(`t.id IN (${marksOf(query.ids)})`);
    binds.push(...query.ids);
  } else if (query.search !== '') {
    where.push("LOWER(t.name) LIKE ? ESCAPE '!'");
    binds.push(likePattern(query.search));
  }
  const extra = where.map((clause) => ` AND ${clause}`).join('');
  const rows = await env.DB.prepare(
    `SELECT t.id, t.name FROM sticker_types t WHERE ${liveWhere('t')}${extra} ORDER BY t.name, t.id ${windowSql(query)}`,
  )
    .bind(...binds)
    .all<{ id: string; name: string }>();
  return pageOf(rows.results, query, (row) => ({ value: row.id, label: row.name }));
}

async function stickers(env: Env, query: Query): Promise<Page> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (query.ids) {
    where.push(`s.id IN (${marksOf(query.ids)})`);
    binds.push(...query.ids);
  } else if (query.search !== '') {
    where.push("LOWER(s.name) LIKE ? ESCAPE '!'");
    binds.push(likePattern(query.search));
  }
  const extra = where.map((clause) => ` AND ${clause}`).join('');
  const rows = await env.DB.prepare(
    `SELECT s.id, s.name FROM stickers s WHERE ${liveWhere('s')}${extra} ORDER BY s.name, s.id ${windowSql(query)}`,
  )
    .bind(...binds)
    .all<{ id: string; name: string }>();
  return pageOf(rows.results, query, (row) => ({ value: row.id, label: row.name }));
}

/**
 * Daftar pilihan filter grup, hanya yang boleh dibaca pemanggil: customer bila berhak Serah Terima, item pada BU
 * yang boleh dibaca bila berhak Serial, jenis stiker dan stiker bila berhak stok stiker atau `sticker: view`.
 * Record terhapus tidak dapat dipilih. Masukan opsional (`kind`, `query`, `cursor`, `limit`, `ids`) membuat daftar
 * dicari dan dihalamani di server tanpa memperluas hak: id di luar hak atau di luar daftar yang boleh dibaca
 * tidak mengembalikan nama.
 */
export async function loadOptions(
  env: Env,
  user: UserContext,
  input: DashboardOptionsInput = {},
): Promise<DashboardOptionsDto> {
  const query: Query = {
    search: input.query ?? '',
    ids: input.ids,
    offset: input.cursor === undefined ? 0 : Number(input.cursor),
    limit: input.limit ?? OPTIONS_PAGE_DEFAULT,
  };
  const kinds: readonly DashboardOptionKind[] = input.kind
    ? [input.kind]
    : ['customers', 'items', 'stickerTypes', 'stickers'];
  const stickerAllowed =
    widgetAllowed(user, widgetMeta('st.out')) || hasLevel(user.permissions.sticker, 'view');
  const empty: Page = { options: [] };

  const loaders: Record<DashboardOptionKind, () => Promise<Page>> = {
    customers: async () =>
      widgetAllowed(user, widgetMeta('hs.created')) ? customers(env, query) : empty,
    items: () => items(env, user, query),
    stickerTypes: async () => (stickerAllowed ? stickerTypes(env, query) : empty),
    stickers: async () => (stickerAllowed ? stickers(env, query) : empty),
  };

  const options: DashboardOptionsDto = { customers: [], items: [], stickerTypes: [], stickers: [] };
  const next: NonNullable<DashboardOptionsDto['next']> = {};
  for (const kind of kinds) {
    const page = await loaders[kind]();
    options[kind] = page.options;
    if (page.next !== undefined) next[kind] = page.next;
  }
  if (Object.keys(next).length > 0) options.next = next;
  return options;
}
