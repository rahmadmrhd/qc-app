import type {
  AuditCursorPageDto,
  AuditPageDto,
  BoardPageDto,
  HandoverDto,
  ItemPageDto,
  ItemSummaryDto,
  JobDto,
  QrDesignDto,
} from '@shared/rpc';
import { sortBoard } from '@/modules/handover/lib/group-board';
import { filterItems } from '@/modules/item/lib/filter-items';
import type { RpcTransport } from './transport';

/**
 * Adaptor tipis antara kontrak Worker (halaman berkursor, `jobs.get`) dan mock backend gas yang masih memakai
 * kontrak lama (daftar utuh, halaman bernomor, ekspor sinkron). Dipakai HANYA oleh transport dev; dibuang bersama
 * mock-backend pada Task 4.4 (Ruling Task 4.3).
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

type Envelope = { ok: true; data: unknown } | { ok: false; error: unknown };

const ok = (data: unknown) => JSON.stringify({ ok: true, data });

function pageWindow(input: { cursor?: string; limit?: number }): { offset: number; limit: number } {
  const offset = Math.max(0, Number(input.cursor ?? 0) || 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, input.limit ?? DEFAULT_LIMIT));
  return { offset, limit };
}

function nextCursorOf(offset: number, limit: number, total: number): string | null {
  return offset + limit < total ? String(offset + limit) : null;
}

export function adaptMockToWorker(inner: RpcTransport): RpcTransport {
  const jobs = new Map<string, JobDto>();
  let jobSeq = 0;

  async function callInner(method: string, payload: unknown, token: string): Promise<Envelope> {
    return JSON.parse(await inner.call(method, JSON.stringify(payload), token)) as Envelope;
  }

  return {
    async call(method, payloadJson, token) {
      const input = (JSON.parse(payloadJson) ?? {}) as Record<string, unknown>;
      switch (method) {
        case 'handovers.board': {
          const result = await callInner(
            'handovers.board',
            { locationIds: input.locationIds },
            token,
          );
          if (!result.ok) return JSON.stringify(result);
          const all = sortBoard(result.data as HandoverDto[]).filter(
            (item) => item.status === input.status,
          );
          const { offset, limit } = pageWindow(input);
          const page: BoardPageDto = {
            items: all.slice(offset, offset + limit),
            nextCursor: nextCursorOf(offset, limit, all.length),
            total: all.length,
          };
          return ok(page);
        }
        case 'items.list': {
          const result = await callInner('items.list', null, token);
          if (!result.ok) return JSON.stringify(result);
          const status =
            input.status === 'active' || input.status === 'inactive' ? input.status : 'all';
          const all = filterItems(result.data as ItemSummaryDto[], {
            q: typeof input.query === 'string' ? input.query : '',
            status,
          });
          const { offset, limit } = pageWindow(input);
          const page: ItemPageDto = {
            items: all.slice(offset, offset + limit),
            nextCursor: nextCursorOf(offset, limit, all.length),
          };
          return ok(page);
        }
        case 'access.audit.list': {
          const { offset, limit } = pageWindow(input);
          const entries: AuditCursorPageDto['entries'] = [];
          let total = 0;
          let pageNo = 1;
          let pageSize = limit;
          // Halaman lama bernomor: ambil halaman yang menutup jendela [offset, offset + limit].
          while (true) {
            const result = await callInner(
              'access.audit.list',
              { page: pageNo, action: input.action, query: input.query },
              token,
            );
            if (!result.ok) return JSON.stringify(result);
            const data = result.data as AuditPageDto;
            total = data.total;
            pageSize = data.pageSize || pageSize;
            const base = (pageNo - 1) * pageSize;
            data.entries.forEach((entry, index) => {
              const position = base + index;
              if (position >= offset && position < offset + limit) entries.push(entry);
            });
            if (base + pageSize >= Math.min(total, offset + limit) || data.entries.length === 0)
              break;
            pageNo++;
          }
          const page: AuditCursorPageDto = {
            entries,
            nextCursor: nextCursorOf(offset, limit, total),
          };
          return ok(page);
        }
        case 'qrcodes.export': {
          const result = await callInner('qrcodes.export', input, token);
          if (!result.ok) return JSON.stringify(result);
          const jobId = `mock-job-${++jobSeq}`;
          jobs.set(jobId, {
            id: jobId,
            kind: 'qr_export',
            status: 'done',
            progress: 100,
            result: (result.data as QrDesignDto).id,
          });
          return ok({ jobId });
        }
        case 'jobs.get': {
          const job = jobs.get(String(input.id));
          if (job) return ok(job);
          return JSON.stringify({
            ok: false,
            error: { code: 'NOT_FOUND', message: 'Pekerjaan tidak ditemukan', requestId: '-' },
          });
        }
        default:
          return inner.call(method, payloadJson, token);
      }
    },
  };
}
