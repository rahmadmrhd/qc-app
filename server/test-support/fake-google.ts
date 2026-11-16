// Server Google palsu (Drive v3 + Sheets v4 + titik token OAuth) untuk tes klien Google: sebuah `fetch` yang
// disuntikkan ke `createGoogleClient`. Meniru perilaku yang dipakai klien (induk berkas, tempat sampah, `fields`,
// resumable, kunci sumber daya, token yang kedaluwarsa menurut jam terkendali), bukan seluruh API.
import { createHash } from 'node:crypto';
import { decodeBytes } from '@server/core/base64url';

export const FAKE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const FAKE_CLIENT_EMAIL = 'qc-test@qc-test.iam.gserviceaccount.com';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

export interface FakeDriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  bytes: Uint8Array;
  trashed: boolean;
  ownedByMe: boolean;
  appProperties: Record<string, string>;
  permissions: Array<{ id: string; type: string; role: string }>;
  /** Berkas eksternal: hanya terbaca bila header `X-Goog-Drive-Resource-Keys` memuat `id/kunci` ini. */
  resourceKey?: string;
  /** Berkas yang tak dibagikan ke service account: 404 untuk semua permintaan. */
  hidden?: boolean;
}

export interface RecordedRequest {
  method: string;
  url: URL;
  headers: Headers;
  /** Teks badan (JSON/form) atau `null`; badan biner ada di `bytes`. */
  text: string | null;
  bytes: Uint8Array | null;
}

export interface JwtClaims {
  iss: string;
  scope: string;
  aud: string;
  iat: number;
  exp: number;
}

export interface FakeGoogle {
  fetch: typeof fetch;
  files: Map<string, FakeDriveFile>;
  sheets: Map<string, Map<string, string[][]>>;
  requests: RecordedRequest[];
  /** Klaim JWT yang diterima titik token (satu per penukaran). */
  tokenExchanges: JwtClaims[];
  /** Kuota yang dilaporkan `about.get`. */
  quota: { limit?: string; usage: string };
  /** Dipanggil sebelum permintaan diproses; kembalikan Response untuk menggantikan jawaban atau lempar galat. */
  intercept:
    | ((request: RecordedRequest) => Response | undefined | Promise<Response | undefined>)
    | null;
  addFolder(id: string, parents?: string[]): FakeDriveFile;
  addFile(
    id: string,
    init: Partial<FakeDriveFile> & { parents: string[]; bytes?: Uint8Array },
  ): FakeDriveFile;
  /** Semua token yang sudah diterbitkan menjadi tak sah (permintaan berikutnya 401). */
  revokeTokens(): void;
}

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function googleError(status: number, reason: string, message = reason): Response {
  return json({ error: { code: status, message, errors: [{ reason, message }] } }, status);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function indexOfSub(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** Mengurai badan `multipart/related` (metadata JSON + isi) yang dibuat klien. */
function parseMultipart(
  contentType: string,
  body: Uint8Array,
): { metadata: Record<string, unknown>; mime: string; content: Uint8Array } {
  const boundary = /boundary=("?)([^";]+)\1/.exec(contentType)?.[2];
  if (!boundary) throw new Error('multipart tanpa boundary');
  const enc = new TextEncoder();
  const marker = enc.encode(`--${boundary}`);
  const first = indexOfSub(body, marker);
  const second = indexOfSub(body, marker, first + marker.length);
  const third = indexOfSub(body, marker, second + marker.length);
  const header = new TextDecoder();
  const partOf = (start: number, end: number) => {
    const part = body.slice(start + marker.length + 2, end - 2); // buang CRLF setelah marker dan sebelum marker berikut
    const split = indexOfSub(part, enc.encode('\r\n\r\n'));
    return { head: header.decode(part.slice(0, split)), data: part.slice(split + 4) };
  };
  const meta = partOf(first, second);
  const content = partOf(second, third);
  const mime = /content-type:\s*([^\r\n]+)/i.exec(content.head)?.[1]?.trim() ?? '';
  return {
    metadata: JSON.parse(header.decode(meta.data)) as Record<string, unknown>,
    mime,
    content: content.data,
  };
}

function md5(bytes: Uint8Array): string {
  return createHash('md5').update(bytes).digest('hex');
}

interface Session {
  metadata: Record<string, unknown>;
  total: number;
  chunks: Uint8Array[];
  received: number;
  targetId: string | null;
}

export function createFakeGoogle(options: {
  publicKey: CryptoKey;
  now: () => number;
  clientEmail?: string;
}): FakeGoogle {
  const clientEmail = options.clientEmail ?? FAKE_CLIENT_EMAIL;
  const files = new Map<string, FakeDriveFile>();
  const sheets = new Map<string, Map<string, string[][]>>();
  const requests: RecordedRequest[] = [];
  const tokenExchanges: JwtClaims[] = [];
  const tokens = new Map<string, number>(); // token -> kedaluwarsa (ms)
  const sessions = new Map<string, Session>();
  let counter = 0;

  const fake: FakeGoogle = {
    fetch: undefined as unknown as typeof fetch,
    files,
    sheets,
    requests,
    tokenExchanges,
    quota: { limit: '16106127360', usage: '46137344' },
    intercept: null,
    addFolder(id, parents = []) {
      return fake.addFile(id, { name: id, mimeType: FOLDER_MIME, parents });
    },
    addFile(id, init) {
      const file: FakeDriveFile = {
        id,
        name: init.name ?? id,
        mimeType: init.mimeType ?? 'application/octet-stream',
        parents: init.parents,
        bytes: init.bytes ?? new Uint8Array(),
        trashed: init.trashed ?? false,
        ownedByMe: init.ownedByMe ?? true,
        appProperties: init.appProperties ?? {},
        permissions: init.permissions ?? [],
        ...(init.resourceKey === undefined ? {} : { resourceKey: init.resourceKey }),
        ...(init.hidden === undefined ? {} : { hidden: init.hidden }),
      };
      files.set(id, file);
      return file;
    },
    revokeTokens() {
      tokens.clear();
    },
  };

  function newId(): string {
    counter += 1;
    return `gen${String(counter).padStart(8, '0')}abcdefghij`;
  }

  async function handleToken(request: RecordedRequest): Promise<Response> {
    const form = new URLSearchParams(request.text ?? '');
    if (form.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
      return json({ error: 'unsupported_grant_type' }, 400);
    }
    const [header, payload, signature] = (form.get('assertion') ?? '').split('.');
    if (!header || !payload || !signature) return json({ error: 'invalid_grant' }, 400);
    const signed = new TextEncoder().encode(`${header}.${payload}`);
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      options.publicKey,
      decodeBytes(signature) as Uint8Array,
      signed,
    );
    if (!valid)
      return json({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }, 400);
    const claims = JSON.parse(
      new TextDecoder().decode(decodeBytes(payload) as Uint8Array),
    ) as JwtClaims;
    if (claims.iss !== clientEmail || claims.aud !== FAKE_TOKEN_URL) {
      return json({ error: 'invalid_grant' }, 400);
    }
    tokenExchanges.push(claims);
    const token = `ya29.fake-${tokenExchanges.length}`;
    tokens.set(token, options.now() + 3600_000);
    return json({ access_token: token, expires_in: 3600, token_type: 'Bearer' });
  }

  function authorized(request: RecordedRequest): boolean {
    const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
    const expires = token === undefined ? undefined : tokens.get(token);
    return expires !== undefined && expires > options.now();
  }

  function meta(file: FakeDriveFile, fields: string | null): Record<string, unknown> {
    const all: Record<string, unknown> = {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      parents: file.parents,
      size: file.mimeType === FOLDER_MIME ? undefined : String(file.bytes.length),
      trashed: file.trashed,
      ownedByMe: file.ownedByMe,
      md5Checksum: file.mimeType === FOLDER_MIME ? undefined : md5(file.bytes),
      appProperties: file.appProperties,
      createdTime: '2026-11-06T00:00:00.000Z',
      modifiedTime: '2026-11-06T00:00:00.000Z',
    };
    if (fields === null) return { id: file.id, name: file.name, mimeType: file.mimeType };
    const wanted = new Set(fields.split(',').map((f) => f.trim()));
    return Object.fromEntries(
      Object.entries(all).filter(([k, v]) => wanted.has(k) && v !== undefined),
    );
  }

  function visible(request: RecordedRequest, id: string): FakeDriveFile | null {
    const file = files.get(id);
    if (!file || file.hidden) return null;
    if (file.resourceKey !== undefined) {
      const keys = request.headers.get('x-goog-drive-resource-keys') ?? '';
      if (!keys.split(',').some((entry) => entry.trim() === `${id}/${file.resourceKey}`))
        return null;
    }
    return file;
  }

  function finishUpload(
    session: Session,
    content: Uint8Array,
    mime: string,
    fields: string | null,
  ): Response {
    const m = session.metadata;
    if (session.targetId !== null) {
      const file = files.get(session.targetId);
      if (!file) return googleError(404, 'notFound');
      file.bytes = content;
      file.mimeType = (m.mimeType as string | undefined) ?? mime ?? file.mimeType;
      return json(meta(file, fields));
    }
    const id = newId();
    const file = fake.addFile(id, {
      name: String(m.name ?? id),
      mimeType: (m.mimeType as string | undefined) ?? mime,
      parents: (m.parents as string[] | undefined) ?? [],
      bytes: content,
      appProperties: (m.appProperties as Record<string, string> | undefined) ?? {},
    });
    return json(meta(file, fields), 200);
  }

  async function handleUpload(request: RecordedRequest): Promise<Response> {
    const { url } = request;
    const fields = url.searchParams.get('fields');
    const uploadType = url.searchParams.get('uploadType');
    const targetId = /\/files\/([^/]+)$/.exec(url.pathname)?.[1] ?? null;
    const body = request.bytes ?? new TextEncoder().encode(request.text ?? '');
    if (uploadType === 'multipart') {
      const parsed = parseMultipart(request.headers.get('content-type') ?? '', body);
      return finishUpload(
        {
          metadata: parsed.metadata,
          total: parsed.content.length,
          chunks: [],
          received: 0,
          targetId,
        },
        parsed.content,
        parsed.mime,
        fields,
      );
    }
    if (uploadType === 'resumable') {
      const metadata = request.text ? (JSON.parse(request.text) as Record<string, unknown>) : {};
      const sessionId = `sess-${sessions.size + 1}`;
      sessions.set(sessionId, {
        metadata: {
          ...metadata,
          mimeType: metadata.mimeType ?? request.headers.get('x-upload-content-type') ?? undefined,
        },
        total: Number(request.headers.get('x-upload-content-length') ?? '0'),
        chunks: [],
        received: 0,
        targetId,
      });
      return new Response('', {
        status: 200,
        headers: {
          location: `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${sessionId}&fields=${fields ?? ''}`,
        },
      });
    }
    return googleError(400, 'badRequest', 'uploadType tidak dikenal');
  }

  function handleResumablePut(request: RecordedRequest): Response {
    const sessionId = request.url.searchParams.get('upload_id') ?? '';
    const session = sessions.get(sessionId);
    if (!session) return googleError(404, 'notFound');
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(request.headers.get('content-range') ?? '');
    if (!range) return googleError(400, 'badRequest', 'Content-Range tidak valid');
    const [start, end, total] = [Number(range[1]), Number(range[2]), Number(range[3])];
    if (start !== session.received)
      return googleError(400, 'badRequest', 'Content-Range tidak berurutan');
    const chunk = request.bytes ?? new Uint8Array();
    if (chunk.length !== end - start + 1)
      return googleError(400, 'badRequest', 'panjang tak cocok');
    if (end + 1 < total && chunk.length % (256 * 1024) !== 0) {
      return googleError(400, 'badRequest', 'potongan harus kelipatan 256 KiB');
    }
    session.chunks.push(chunk);
    session.received += chunk.length;
    if (session.received < total) {
      return new Response('', {
        status: 308,
        headers: { range: `bytes=0-${session.received - 1}` },
      });
    }
    return finishUpload(
      session,
      concat(session.chunks),
      String(session.metadata.mimeType ?? ''),
      request.url.searchParams.get('fields') || null,
    );
  }

  function handleDrive(request: RecordedRequest): Response {
    const { url, method } = request;
    const path = url.pathname.replace('/drive/v3', '');
    const fields = url.searchParams.get('fields');

    if (path === '/about' && method === 'GET') {
      return json({ storageQuota: { ...fake.quota } });
    }
    if (path === '/files' && method === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const wantedName = / and name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replaceAll(/\\(.)/g, '$1');
      const matching = [...files.values()]
        .filter(
          (f) =>
            !f.hidden &&
            (!parent || f.parents.includes(parent)) &&
            !f.trashed &&
            (wantedName === undefined || f.name === wantedName),
        )
        .sort((a, b) => a.name.localeCompare(b.name));
      const pageSize = Number(url.searchParams.get('pageSize') ?? '100');
      const offset = Number(url.searchParams.get('pageToken') ?? '0');
      const page = matching.slice(offset, offset + pageSize);
      const wanted = /files\(([^)]*)\)/.exec(fields ?? '')?.[1] ?? 'id,name';
      return json({
        files: page.map((f) => meta(f, wanted)),
        ...(offset + pageSize < matching.length
          ? { nextPageToken: String(offset + pageSize) }
          : {}),
      });
    }
    if (path === '/files' && method === 'POST') {
      const body = JSON.parse(request.text ?? '{}') as Record<string, unknown>;
      const id = newId();
      const file = fake.addFile(id, {
        name: String(body.name ?? id),
        mimeType: String(body.mimeType ?? 'application/octet-stream'),
        parents: (body.parents as string[] | undefined) ?? [],
      });
      return json(meta(file, fields));
    }
    const copy = /^\/files\/([^/]+)\/copy$/.exec(path);
    if (copy && method === 'POST') {
      const source = visible(request, decodeURIComponent(copy[1] as string));
      if (!source) return googleError(404, 'notFound');
      const body = JSON.parse(request.text ?? '{}') as Record<string, unknown>;
      const file = fake.addFile(newId(), {
        name: String(body.name ?? source.name),
        mimeType: source.mimeType,
        parents: (body.parents as string[] | undefined) ?? [],
        bytes: source.bytes,
      });
      return json(meta(file, fields));
    }
    const perms = /^\/files\/([^/]+)\/permissions(?:\/([^/]+))?$/.exec(path);
    if (perms) {
      const file = visible(request, decodeURIComponent(perms[1] as string));
      if (!file) return googleError(404, 'notFound');
      if (method === 'GET') return json({ permissions: file.permissions });
      if (method === 'POST') {
        const body = JSON.parse(request.text ?? '{}') as { type: string; role: string };
        if (!file.permissions.some((p) => p.type === body.type)) {
          file.permissions.push({
            id: body.type === 'anyone' ? 'anyoneWithLink' : newId(),
            ...body,
          });
        }
        return json({ id: 'anyoneWithLink', ...body });
      }
      if (method === 'DELETE') {
        const before = file.permissions.length;
        file.permissions = file.permissions.filter((p) => p.id !== perms[2]);
        return file.permissions.length === before
          ? googleError(404, 'notFound')
          : new Response(null, { status: 204 });
      }
    }
    const one = /^\/files\/([^/]+)$/.exec(path);
    if (one) {
      const id = decodeURIComponent(one[1] as string);
      const file = visible(request, id);
      if (!file) return googleError(404, 'notFound', 'File not found');
      if (method === 'GET') {
        if (url.searchParams.get('alt') === 'media') {
          return new Response(file.bytes as unknown as ArrayBuffer, {
            status: 200,
            headers: { 'content-type': file.mimeType, 'content-length': String(file.bytes.length) },
          });
        }
        return json(meta(file, fields));
      }
      if (method === 'PATCH') {
        const body = JSON.parse(request.text ?? '{}') as Record<string, unknown>;
        if (typeof body.trashed === 'boolean') file.trashed = body.trashed;
        if (typeof body.name === 'string') file.name = body.name;
        return json(meta(file, fields));
      }
      if (method === 'DELETE') {
        files.delete(id);
        return new Response(null, { status: 204 });
      }
    }
    return googleError(404, 'notFound', `rute palsu tidak dikenal: ${method} ${path}`);
  }

  function rangeSheet(range: string): { title: string; a1: string | null } {
    const match = /^'((?:[^']|'')+)'(?:!(.+))?$/.exec(range);
    if (!match) return { title: range, a1: null };
    return { title: (match[1] as string).replace(/''/g, "'"), a1: match[2] ?? null };
  }

  function handleSheets(request: RecordedRequest): Response {
    const { url, method } = request;
    const match = /^\/v4\/spreadsheets\/([^/:]+)(.*)$/.exec(url.pathname);
    if (!match) return googleError(404, 'notFound');
    const book = sheets.get(decodeURIComponent(match[1] as string));
    if (!book) return googleError(404, 'notFound', 'Requested entity was not found.');
    const rest = decodeURIComponent(match[2] as string);
    if (rest === '' && method === 'GET') {
      return json({ sheets: [...book.keys()].map((title) => ({ properties: { title } })) });
    }
    if (rest === ':batchUpdate' && method === 'POST') {
      const body = JSON.parse(request.text ?? '{}') as {
        requests: Array<{ addSheet?: { properties: { title: string } } }>;
      };
      for (const item of body.requests) {
        const title = item.addSheet?.properties.title;
        if (title === undefined) continue;
        if (book.has(title)) {
          return googleError(400, 'badRequest', `A sheet with the name "${title}" already exists.`);
        }
        book.set(title, []);
      }
      return json({ replies: [] });
    }
    if (rest === '/values:batchGet' && method === 'GET') {
      const ranges = url.searchParams.getAll('ranges');
      return json({
        valueRanges: ranges.map((range) => {
          const { title } = rangeSheet(range);
          const rows = book.get(title);
          if (!rows) return { range, majorDimension: 'ROWS' };
          // Seperti Sheets: baris kosong di ekor dan sel kosong di ujung baris dibuang.
          const trimmed = rows.map((row) => {
            let end = row.length;
            while (end > 0 && row[end - 1] === '') end -= 1;
            return row.slice(0, end);
          });
          while (trimmed.length > 0 && trimmed[trimmed.length - 1]?.length === 0) trimmed.pop();
          return trimmed.length === 0
            ? { range, majorDimension: 'ROWS' }
            : { range, majorDimension: 'ROWS', values: trimmed };
        }),
      });
    }
    const valuesRoute = /^\/values\/(.+?):(clear|append)$/.exec(rest);
    if (valuesRoute && method === 'POST') {
      const { title } = rangeSheet(valuesRoute[1] as string);
      const rows = book.get(title);
      if (!rows) return googleError(400, 'badRequest', `Unable to parse range: ${valuesRoute[1]}`);
      if (valuesRoute[2] === 'clear') {
        book.set(title, []);
        return json({ clearedRange: valuesRoute[1] });
      }
      const body = JSON.parse(request.text ?? '{}') as { values: string[][] };
      if (url.searchParams.get('valueInputOption') !== 'RAW') {
        return googleError(400, 'badRequest', 'valueInputOption harus RAW');
      }
      rows.push(...body.values);
      return json({ updates: { updatedRows: body.values.length } });
    }
    return googleError(
      404,
      'notFound',
      `rute Sheets palsu tidak dikenal: ${method} ${url.pathname}`,
    );
  }

  fake.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const headers = new Headers(init?.headers);
    const rawBody = init?.body;
    let text: string | null = null;
    let bytes: Uint8Array | null = null;
    if (typeof rawBody === 'string') text = rawBody;
    else if (rawBody instanceof URLSearchParams) text = rawBody.toString();
    else if (rawBody instanceof Uint8Array) {
      bytes = rawBody;
      text = new TextDecoder().decode(rawBody);
    } else if (rawBody instanceof Blob) {
      bytes = new Uint8Array(await rawBody.arrayBuffer());
      text = new TextDecoder().decode(bytes);
    }
    const request: RecordedRequest = {
      method: (init?.method ?? 'GET').toUpperCase(),
      url,
      headers,
      text,
      bytes,
    };
    requests.push(request);
    const forced = await fake.intercept?.(request);
    if (forced) return forced;
    if (url.href.startsWith(FAKE_TOKEN_URL)) return handleToken(request);
    if (url.hostname !== 'www.googleapis.com' && url.hostname !== 'sheets.googleapis.com') {
      return googleError(404, 'notFound', `host tak dikenal: ${url.hostname}`);
    }
    if (!authorized(request)) return googleError(401, 'authError', 'Invalid Credentials');
    if (url.pathname.startsWith('/upload/drive/v3/files')) {
      return request.method === 'PUT' ? handleResumablePut(request) : handleUpload(request);
    }
    if (url.pathname.startsWith('/drive/v3/')) return handleDrive(request);
    if (url.pathname.startsWith('/v4/spreadsheets/')) return handleSheets(request);
    return googleError(404, 'notFound');
  }) as typeof fetch;

  return fake;
}

/** Pasangan kunci RSA uji + berkas kunci service account (JSON) yang cocok. TIDAK PERNAH kunci nyata. */
export async function createTestServiceAccount(): Promise<{
  keyJson: string;
  privateKeyPem: string;
  publicKey: CryptoKey;
  clientEmail: string;
}> {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const b64 = Buffer.from(pkcs8).toString('base64');
  const lines = b64.match(/.{1,64}/g) ?? [];
  const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----\n`;
  return {
    keyJson: JSON.stringify({
      type: 'service_account',
      project_id: 'qc-test',
      private_key_id: 'test-key-id',
      private_key: privateKeyPem,
      client_email: FAKE_CLIENT_EMAIL,
      token_uri: FAKE_TOKEN_URL,
    }),
    privateKeyPem,
    publicKey: pair.publicKey,
    clientEmail: FAKE_CLIENT_EMAIL,
  };
}
