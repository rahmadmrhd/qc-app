/*
 * Background Sync untuk antrean tulis offline Serah Terima (spek PWA offline Serah Terima §7b, Fase 3 Tahap D).
 *
 * Skrip KLASIK (bukan modul) yang diimpor service worker hasil Workbox lewat `workbox.importScripts`
 * (`web/src/app/pwa/pwa-config.ts`). Berkas ini sengaja statis dan tidak dipra-cache: server melayaninya `no-cache`
 * dan peramban memeriksa perubahannya bersama `sw.js`. Tes: `web/src/modules/handover/lib/sync-sw.test.ts` dan
 * `outbox-parity.test.ts` (kesetaraan dengan penguras halaman).
 *
 * Mengapa logikanya DUPLIKAT dari halaman (`outbox.ts`, `outbox-flush.ts`, `lib/api/client.ts`): skrip klasik tak
 * dapat mengimpor modul web (spek §3), dan service worker tak boleh membawa bundel aplikasi. Konstanta, bentuk
 * permintaan, klasifikasi galat, dan teks alasan penolakan HARUS sama dengan halaman; `outbox-parity.test.ts` menjaganya.
 * Ubah satu sisi = ubah sisi lain.
 *
 * Alur peristiwa `sync` (tag `qc-outbox`): ambil kunci Web Locks bersama penguras halaman, baca toko `outbox` di
 * IndexedDB `qc-device` (tanpa membuat apa pun bila belum ada), pastikan pemilik antrean = pemilik sesi (`/api/v1/me`),
 * lalu kirim entri berurutan. Berhasil = rekaman dihapus; ditolak server atau kedaluwarsa = rekaman DITANDAI
 * `rejected` (tanpa tab terbuka toast tak bisa tampil; penguras halaman berikutnya yang mengumumkan dan membuangnya);
 * server tak tersedia = entri tetap dan galat dilempar agar peramban menjadwalkan ulang. Skrip ini hanya MENGIRIM ke
 * origin sendiri; tak menyimpan respons API dan tak menjawab permintaan halaman.
 */
(() => {
  const TAG = 'qc-outbox';
  const DB_NAME = 'qc-device';
  const STORE = 'outbox';
  const RECORD_VERSION = 1;
  const KINDS = ['check', 'comment', 'create'];
  const MAX_AGE_MS = 24 * 60 * 60 * 1000;
  const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
  const SEND_TIMEOUT_MS = 30000;
  const FLUSH_LOCK = 'qc-outbox-flush';
  const CHANNEL = 'qc-outbox';
  const SENDING_TTL_MS = 45000;
  const API_BASE = '/api/v1';
  const ERROR_CODES = [
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'NOT_FOUND',
    'VALIDATION',
    'CONFLICT',
    'UNAVAILABLE',
    'CLIENT_OUTDATED',
    'INTERNAL',
  ];
  /** Hanya penolakan nyata dari server yang menandai entri (sama dengan `REJECTION_CODES` di `outbox-flush.ts`, termasuk `CLIENT_OUTDATED` untuk 426 problem+json). */
  const REJECTION_CODES = ['CLIENT_OUTDATED', 'CONFLICT', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION'];
  const EXPIRED_REASON = 'Kedaluwarsa: lebih dari 24 jam sejak dibuat';
  /** Sama dengan `NO_TASK_REASON` di `outbox-flush.ts` (dijaga `outbox-parity.test.ts`). */
  const NO_TASK_REASON = 'Entri tidak memiliki task tujuan';
  const OPEN_TIMEOUT_MS = 10000;

  // --- Bentuk entri (padanan `isOutboxEntry` di `outbox.ts`) ---------------------------------------------------
  const isString = (value) => typeof value === 'string';
  const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

  function isEntry(value) {
    if (typeof value !== 'object' || value === null) return false;
    if (!isString(value.id) || !isFiniteNumber(value.at) || !isString(value.locationId))
      return false;
    if (value.state !== undefined && (value.state !== 'rejected' || !isString(value.reason))) {
      return false;
    }
    switch (value.kind) {
      case 'check':
        return (
          isString(value.taskId) &&
          typeof value.index === 'number' &&
          Number.isInteger(value.index) &&
          isString(value.text) &&
          typeof value.checked === 'boolean'
        );
      case 'comment':
        return (
          isString(value.clientId) &&
          isString(value.taskId) &&
          isString(value.quote) &&
          isString(value.before) &&
          isString(value.after) &&
          isString(value.body)
        );
      case 'create':
        return (
          Array.isArray(value.tasks) &&
          value.tasks.length > 0 &&
          value.tasks.every(
            (task) =>
              typeof task === 'object' &&
              task !== null &&
              isString(task.clientId) &&
              isString(task.customerName) &&
              isString(task.note),
          )
        );
      default:
        return false;
    }
  }

  /** Rekaman yang boleh dikirim: versi dikenal, jenis dikenal, bentuk valid, dan BELUM `rejected`. */
  function isSendable(record) {
    if (typeof record !== 'object' || record === null) return false;
    if (record.v !== RECORD_VERSION || !isString(record.owner)) return false;
    const entry = record.entry;
    if (typeof entry !== 'object' || entry === null) return false;
    if (!KINDS.includes(entry.kind)) return false;
    return isEntry(entry) && entry.state === undefined;
  }

  function isExpired(entry, now) {
    return now - entry.at > MAX_AGE_MS || entry.at - now > MAX_FUTURE_SKEW_MS;
  }

  // --- IndexedDB -------------------------------------------------------------------------------------------------
  /**
   * Membuka `qc-device` TANPA nomor versi: tak pernah membuat atau meng-upgrade apa pun (basis data yang belum ada
   * dibatalkan, bukan dibuat kosong). `null` = tak ada IndexedDB, basis data atau toko `outbox` belum ada, atau gagal.
   */
  function openDb() {
    return new Promise((resolve) => {
      let settled = false;
      const done = (db) => {
        if (settled) {
          // Terlambat (sudah menyerah): jangan membocorkan koneksi.
          if (db) db.close();
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(db);
      };
      const timer = setTimeout(() => done(null), OPEN_TIMEOUT_MS);
      try {
        const factory = self.indexedDB;
        if (!factory) return done(null);
        const request = factory.open(DB_NAME);
        request.onupgradeneeded = () => {
          // Basis data belum ada: batalkan pembuatannya (tak boleh ada basis data kosong buatan service worker).
          try {
            request.transaction.abort();
          } catch {
            // Diabaikan.
          }
        };
        request.onerror = () => done(null);
        request.onblocked = () => done(null);
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => db.close();
          if (!db.objectStoreNames.contains(STORE)) {
            db.close();
            return done(null);
          }
          done(db);
        };
      } catch {
        done(null);
      }
    });
  }

  /** Satu transaksi; `body(store, setResult)` mengisi hasil yang dikembalikan saat transaksi selesai. */
  function transact(db, mode, body) {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE, mode);
        let result;
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
        body(tx.objectStore(STORE), (value) => {
          result = value;
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /** Semua rekaman toko; `null` bila gagal dibaca. */
  async function readRecords(db) {
    try {
      return await transact(db, 'readonly', (store, setResult) => {
        const request = store.getAll();
        request.onsuccess = () => setResult(request.result);
      });
    } catch {
      return null;
    }
  }

  async function readRecord(db, key) {
    try {
      return await transact(db, 'readonly', (store, setResult) => {
        const request = store.get(key);
        request.onsuccess = () => setResult(request.result);
      });
    } catch {
      return undefined;
    }
  }

  /** Menghapus satu rekaman; `true` bila terkonfirmasi. */
  async function deleteRecord(db, key) {
    try {
      await transact(db, 'readwrite', (store) => {
        store.delete(key);
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Menandai entri `rejected` (baca-ubah-tulis dalam SATU transaksi: rekaman yang dibuang atau sudah ditandai tak
   * ditulis ulang). Kolom rekaman selain `entry` tak berubah. `true` bila ditandai.
   */
  async function markRejected(db, key, reason) {
    try {
      return await transact(db, 'readwrite', (store, setResult) => {
        const request = store.get(key);
        request.onsuccess = () => {
          const record = request.result;
          if (!record?.entry || record.entry.state === 'rejected') return;
          store.put({ ...record, entry: { ...record.entry, state: 'rejected', reason } });
          setResult(true);
        };
      }).then((changed) => changed === true);
    } catch {
      return false;
    }
  }

  // --- Jaringan --------------------------------------------------------------------------------------------------
  function parseJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  function isProblem(value) {
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof value.code === 'string' &&
      ERROR_CODES.includes(value.code)
    );
  }

  /** Galat dari respons non-2xx (padanan `errorFromResponse` di `lib/api/client.ts`): `{ code, message, fields }`. */
  function errorFromResponse(status, text) {
    const body = parseJson(text);
    if (isProblem(body)) {
      return {
        // 412 (If-Match basi) tetap `CONFLICT`.
        code: status === 412 ? 'CONFLICT' : body.code,
        // Hanya teks yang dipakai (sama dengan klien halaman): `detail`/`title` non-string jatuh ke berikutnya.
        message:
          typeof body.detail === 'string'
            ? body.detail
            : typeof body.title === 'string'
              ? body.title
              : 'Terjadi kesalahan pada server',
        fields: body.fields,
      };
    }
    if (status === 401) {
      return { code: 'UNAUTHENTICATED', message: 'Sesi tidak valid atau sudah berakhir' };
    }
    if (status === 403) return { code: 'FORBIDDEN', message: 'Permintaan ditolak' };
    if (status === 413) return { code: 'VALIDATION', message: 'Badan permintaan terlalu besar' };
    if (status === 429 || status === 503) {
      return { code: 'UNAVAILABLE', message: 'Layanan sedang sibuk atau tidak tersedia' };
    }
    return { code: 'INTERNAL', message: 'Respons server tidak valid' };
  }

  /**
   * Teks alasan penolakan (padanan bagian penolakan `describeError` di `lib/api/describe-error.ts`): pesan, ditambah
   * nilai unik `fields` yang berbeda dari pesan. Hanya dipakai untuk kode penolakan (`REJECTION_CODES`).
   */
  function describe(error) {
    const fieldValues =
      typeof error.fields === 'object' && error.fields !== null ? Object.values(error.fields) : [];
    const details = [
      ...new Set(
        fieldValues.filter(
          (text) => typeof text === 'string' && text !== '' && text !== error.message,
        ),
      ),
    ];
    return details.length > 0 ? `${error.message}: ${details.join(', ')}` : error.message;
  }

  /** Permintaan menurut jenis entri (padanan `sendOutboxEntry`); entri `check`/`comment` tanpa `taskId` ditolak lebih dulu. */
  function requestFor(entry) {
    switch (entry.kind) {
      case 'check':
        return {
          method: 'PUT',
          path: `/handovers/${encodeURIComponent(entry.taskId)}/checks`,
          body: {
            locationId: entry.locationId,
            index: entry.index,
            text: entry.text,
            checked: entry.checked,
          },
        };
      case 'comment':
        return {
          method: 'POST',
          path: `/handovers/${encodeURIComponent(entry.taskId)}/comments`,
          body: {
            locationId: entry.locationId,
            quote: entry.quote,
            before: entry.before,
            after: entry.after,
            body: entry.body,
            clientId: entry.clientId,
          },
        };
      default:
        return {
          method: 'POST',
          path: '/handovers/batch',
          body: {
            locationId: entry.locationId,
            tasks: entry.tasks.map((task) => ({
              customerName: task.customerName,
              note: task.note,
              clientId: task.clientId,
            })),
          },
        };
    }
  }

  /**
   * Mengirim satu entri. Hasil: `ok` (2xx), `rejected` (+`reason`), `hold` (server tak tersedia atau galat tak jelas:
   * entri tetap, putaran berhenti, galat dilempar), `unauth` (sesi tak sah: entri tetap, putaran berhenti tanpa galat).
   */
  async function sendEntry(entry) {
    const request = requestFor(entry);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    let response;
    let text;
    try {
      response = await self.fetch(API_BASE + request.path, {
        method: request.method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'X-Requested-With': 'qc',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request.body),
        signal: controller.signal,
      });
      text = await response.text();
    } catch {
      // Offline, abort (batas waktu), atau badan terputus: server tak terjangkau.
      return { kind: 'hold' };
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const error = errorFromResponse(response.status, text);
      if (error.code === 'UNAVAILABLE') return { kind: 'hold' };
      if (error.code === 'UNAUTHENTICATED') return { kind: 'unauth' };
      if (!REJECTION_CODES.includes(error.code)) return { kind: 'hold' };
      return { kind: 'rejected', reason: describe(error) };
    }
    // Badan kosong = sukses tanpa isi; badan tak terbaca sebagai JSON = respons tak valid (bukan penolakan).
    if (text !== '' && parseJson(text) === undefined) return { kind: 'hold' };
    return { kind: 'ok' };
  }

  /**
   * Email pemilik sesi lewat `/api/v1/me`. `null` = tak ada sesi sah (401/4xx lain atau badan tak terbaca): selesai
   * tanpa mengirim dan tanpa mengulang. Server tak terjangkau, 429, atau 5xx: melempar agar peramban mengulang nanti.
   */
  async function fetchOwner() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    let response;
    let text;
    try {
      response = await self.fetch(`${API_BASE}/me`, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      text = await response.text();
    } catch {
      throw new Error('qc-outbox: /me tidak terjangkau');
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 429 || response.status >= 500) {
      throw new Error('qc-outbox: /me tidak tersedia');
    }
    if (!response.ok) return null;
    const body = parseJson(text);
    // 2xx tetapi badan bukan JSON (halaman pemeliharaan/proksi): bukan bukti sesi tak sah; coba lagi nanti.
    if (body === undefined) throw new Error('qc-outbox: /me berbadan tak terbaca');
    return body && typeof body === 'object' && isString(body.email) ? body.email : null;
  }

  // --- Siaran dan pemberitahuan ----------------------------------------------------------------------------------
  function openChannel() {
    try {
      return typeof self.BroadcastChannel === 'function'
        ? new self.BroadcastChannel(CHANNEL)
        : null;
    } catch {
      return null;
    }
  }

  /** Memberi tahu jendela terbuka (D7); galat apa pun ditelan. */
  async function notifyClients(summary) {
    try {
      const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of list) {
        try {
          client.postMessage({
            type: 'qc-outbox-synced',
            taskIds: [...summary.taskIds],
            created: summary.created,
            rejected: summary.rejected,
          });
        } catch {
          // Jendela tak dapat dihubungi: lewati.
        }
      }
    } catch {
      // Tak ada klien: abaikan.
    }
  }

  // --- Putaran ---------------------------------------------------------------------------------------------------
  function compareRecords(a, b) {
    const savedAt = (record) => (isFiniteNumber(record.savedAt) ? record.savedAt : 0);
    const seq = (record) => (isFiniteNumber(record.seq) ? record.seq : 0);
    if (savedAt(a) !== savedAt(b)) return savedAt(a) - savedAt(b);
    if (seq(a) !== seq(b)) return seq(a) - seq(b);
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  }

  /** Pekerjaan di bawah kunci Web Locks (satu pengurasan pada satu waktu, bersama penguras halaman). */
  async function work() {
    const db = await openDb();
    if (db === null) return;
    const channel = openChannel();
    const post = (message) => {
      try {
        channel?.postMessage(message);
      } catch {
        // Siaran hanya membantu.
      }
    };
    try {
      const records = await readRecords(db);
      if (records === null) return;
      const sendable = records.filter(isSendable);
      if (sendable.length === 0) return;

      const email = await fetchOwner();
      if (email === null) return;
      const mine = sendable.filter((record) => record.owner === email).sort(compareRecords);
      if (mine.length === 0) return;

      const summary = { taskIds: new Set(), created: false, rejected: 0 };
      let hold = false;
      for (const listed of mine) {
        // Dibaca ulang tepat sebelum dikirim: halaman mungkin sudah membuang atau menimpanya.
        const record = await readRecord(db, listed.key);
        if (!record || !isSendable(record) || record.owner !== email) continue;
        const entry = record.entry;
        if (isExpired(entry, Date.now())) {
          if (await markRejected(db, record.key, EXPIRED_REASON)) {
            summary.rejected += 1;
            post({ type: 'changed' });
          }
          continue;
        }
        // Tanpa task tujuan: ditolak (bukan menahan antrean), sama dengan penguras halaman.
        if (entry.kind !== 'create' && entry.taskId === '') {
          if (await markRejected(db, record.key, NO_TASK_REASON)) {
            summary.rejected += 1;
            post({ type: 'changed' });
          }
          continue;
        }
        // Centang memakai penanda per tab (tak disiarkan); komentar dan task baru disiarkan agar tab lain menampilkan "Mengirim".
        const broadcastSending = entry.kind !== 'check';
        if (broadcastSending) {
          post({ type: 'sending', ids: [entry.id], until: Date.now() + SENDING_TTL_MS });
        }
        let stop = false;
        try {
          const outcome = await sendEntry(entry);
          if (outcome.kind === 'ok') {
            if (await deleteRecord(db, record.key)) post({ type: 'changed' });
            if (entry.kind === 'create') summary.created = true;
            else summary.taskIds.add(entry.taskId);
          } else if (outcome.kind === 'rejected') {
            if (await markRejected(db, record.key, outcome.reason)) {
              summary.rejected += 1;
              post({ type: 'changed' });
            }
          } else if (outcome.kind === 'hold') {
            hold = true;
            stop = true;
          } else {
            stop = true;
          }
        } finally {
          if (broadcastSending) post({ type: 'sending-done', ids: [entry.id] });
        }
        if (stop) break;
      }

      if (summary.taskIds.size > 0 || summary.created || summary.rejected > 0) {
        await notifyClients(summary);
      }
      // Sesudah pemberitahuan: peramban menjadwalkan ulang `sync` yang gagal (dengan jeda bertahap).
      if (hold) throw new Error('qc-outbox: server tidak tersedia');
    } finally {
      db.close();
      try {
        channel?.close();
      } catch {
        // Diabaikan.
      }
    }
  }

  function run() {
    // Tanpa Web Locks tak ada pengaman terhadap kirim ganda bersama penguras halaman: jalur halaman yang bekerja.
    const locks = self.navigator ? self.navigator.locks : undefined;
    if (!locks || typeof locks.request !== 'function') return Promise.resolve();
    return locks.request(FLUSH_LOCK, work);
  }

  self.addEventListener('sync', (event) => {
    if (event.tag !== TAG) return;
    event.waitUntil(run());
  });

  // Hanya untuk tes kesetaraan konstanta (`outbox-parity.test.ts`); tak berefek di produksi.
  if (typeof self.__qcSyncTest === 'function') {
    self.__qcSyncTest({
      constants: {
        DB_NAME,
        STORE,
        RECORD_VERSION,
        KINDS,
        MAX_AGE_MS,
        MAX_FUTURE_SKEW_MS,
        SEND_TIMEOUT_MS,
        FLUSH_LOCK,
        CHANNEL,
        SENDING_TTL_MS,
        API_BASE,
        ERROR_CODES,
        TAG,
      },
    });
  }
})();
