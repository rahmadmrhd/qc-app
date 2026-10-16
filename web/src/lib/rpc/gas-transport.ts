import type { RpcTransport } from './transport';

/** Penjalan `google.script.run.api` (disuntik agar dapat diuji). Menyelesaikan dengan string JSON respons. */
export type GasApiRunner = (method: string, payloadJson: string, token: string) => Promise<string>;

export interface GasTransportOptions {
  /** Jendela (ms) menggabungkan panggilan yang datang berdekatan. */
  windowMs?: number;
  /** Maksimal item per eksekusi batch (harus sama atau di bawah RPC_BATCH_MAX_ITEMS server). */
  maxItems?: number;
  /** Payload yang lebih besar dari ini (mis. unggah PDF/gambar) dikirim sendiri, tidak digabung. */
  maxItemChars?: number;
}

interface Pending {
  method: string;
  payloadJson: string;
  token: string;
  resolve: (raw: string) => void;
  reject: (error: unknown) => void;
}

function defaultRunner(method: string, payloadJson: string, token: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const run = window.google?.script?.run;
    if (!run) {
      reject(new Error('google.script.run tidak tersedia'));
      return;
    }
    run
      .withSuccessHandler((value) => resolve(String(value)))
      .withFailureHandler((error) => reject(error))
      .api(method, payloadJson, token);
  });
}

/**
 * Transport Apps Script yang menggabungkan RPC yang dipicu dalam jendela singkat (mis. loader halaman yang memanggil
 * beberapa query sekaligus) menjadi SATU eksekusi `api('batch', ...)`. Tiap eksekusi Apps Script berbiaya tetap
 * 1,5-2,5 detik dan antre serial di klien, jadi N panggilan terpisah = N × biaya itu. Hasil tiap item tetap
 * dikembalikan terpisah, sehingga pemanggil tidak tahu panggilannya digabung.
 */
export function createGasTransport(
  run: GasApiRunner = defaultRunner,
  options: GasTransportOptions = {},
): RpcTransport {
  const windowMs = options.windowMs ?? 15;
  const maxItems = options.maxItems ?? 8;
  const maxItemChars = options.maxItemChars ?? 20_000;
  let queue: Pending[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function sendGroup(group: Pending[]): Promise<void> {
    const first = group[0];
    if (!first) return;
    if (group.length === 1) {
      try {
        first.resolve(await run(first.method, first.payloadJson, first.token));
      } catch (error) {
        first.reject(error);
      }
      return;
    }
    try {
      const raw = await run(
        'batch',
        JSON.stringify(group.map((item) => ({ m: item.method, p: item.payloadJson }))),
        first.token,
      );
      let results: unknown[] | null = null;
      try {
        const parsed = JSON.parse(raw) as { batch?: unknown };
        if (Array.isArray(parsed.batch) && parsed.batch.length === group.length) {
          results = parsed.batch;
        }
      } catch {
        // dibiarkan: ditangani di bawah (semua item menerima respons mentah yang akan ditolak klien RPC)
      }
      group.forEach((item, index) => {
        item.resolve(results ? JSON.stringify(results[index]) : raw);
      });
    } catch (error) {
      for (const item of group) item.reject(error);
    }
  }

  function flush(): void {
    timer = null;
    const batch = queue;
    queue = [];
    // Satu grup per token (token berbeda tidak boleh berbagi eksekusi) dan per batas item.
    const byToken = new Map<string, Pending[]>();
    for (const item of batch) {
      const list = byToken.get(item.token) ?? [];
      list.push(item);
      byToken.set(item.token, list);
    }
    for (const list of byToken.values()) {
      for (let start = 0; start < list.length; start += maxItems) {
        void sendGroup(list.slice(start, start + maxItems));
      }
    }
  }

  return {
    call(method, payloadJson, token) {
      if (payloadJson.length > maxItemChars) return run(method, payloadJson, token);
      return new Promise<string>((resolve, reject) => {
        queue.push({ method, payloadJson, token, resolve, reject });
        if (timer === null) timer = setTimeout(flush, windowMs);
      });
    },
  };
}

export const gasTransport: RpcTransport = createGasTransport();
