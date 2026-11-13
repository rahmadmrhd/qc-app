/*
 * Penanganan push dan klik notifikasi (spek notifikasi Serah Terima §5.2).
 *
 * Skrip KLASIK (bukan modul) yang diimpor service worker hasil Workbox lewat `workbox.importScripts`
 * (`web/src/app/pwa/pwa-config.ts`). Berkas ini sengaja statis dan tidak dipra-cache: server melayaninya `no-cache`
 * dan peramban memeriksa perubahannya bersama `sw.js`. Tes: `web/src/modules/push/push-sw.test.ts`.
 *
 * Bentuk muatan dari server (`pushPayloadOf` di `shared/notifications.ts`): `{ title, body, url, tag }`.
 */
(() => {
  const ICON = '/icons/icon-192.png';
  const GENERIC_TITLE = 'QC App';
  const GENERIC_BODY = 'Ada pembaruan di QC App';

  /** Teks dari muatan: hanya string, dipotong agar muatan aneh tak membesar-besarkan notifikasi. */
  function text(value, max) {
    return typeof value === 'string' ? value.slice(0, max) : '';
  }

  /** Spasi, karakter kontrol (0x00-0x20, 0x7f), atau garis miring terbalik (0x5c). */
  function hasUnsafeChar(value) {
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code <= 0x20 || code === 0x7f || code === 0x5c) return true;
    }
    return false;
  }

  /**
   * Tautan yang boleh dibuka: HANYA path same-origin. Ditolak bila tak diawali satu "/", memuat spasi/karakter kontrol
   * (peramban membuang tab dan baris baru saat mengurai URL, jadi "/<tab>/evil.test" menjadi "//evil.test") atau
   * garis miring terbalik, atau bila hasil penguraiannya bukan origin ini. Selain itu jatuh ke "/".
   */
  function safeUrl(value) {
    if (typeof value !== 'string' || value.charAt(0) !== '/' || value.charAt(1) === '/') return '/';
    if (hasUnsafeChar(value)) return '/';
    try {
      const url = new URL(value, self.location.origin);
      if (url.origin !== self.location.origin) return '/';
      return url.pathname + url.search + url.hash;
    } catch {
      return '/';
    }
  }

  function parsePayload(event) {
    try {
      const data = event.data ? event.data.json() : null;
      return data !== null && typeof data === 'object' ? data : {};
    } catch {
      return {};
    }
  }

  self.addEventListener('push', (event) => {
    const payload = parsePayload(event);
    const title = text(payload.title, 200) || GENERIC_TITLE;
    const options = {
      body: text(payload.body, 500) || GENERIC_BODY,
      icon: ICON,
      data: { url: safeUrl(payload.url) },
    };
    const tag = text(payload.tag, 100);
    if (tag !== '') {
      // Notifikasi sejenis (kejadian + task yang sama) menggantikan yang lama, tetapi tetap berbunyi.
      options.tag = tag;
      options.renotify = true;
    }
    // Peramban mewajibkan setiap push menampilkan notifikasi (`userVisibleOnly`): selalu tampilkan, bahkan bila
    // muatannya rusak.
    event.waitUntil(self.registration.showNotification(title, options));
  });

  /** Window aplikasi (same-origin) yang sudah terbuka, atau null. */
  function findAppWindow(list) {
    for (const client of list) {
      try {
        if (new URL(client.url).origin === self.location.origin) return client;
      } catch {
        // URL klien tak terbaca: lewati.
      }
    }
    return null;
  }

  self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = safeUrl(event.notification.data?.url);
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
        const mine = findAppWindow(list);
        if (mine === null) return self.clients.openWindow(url);
        return Promise.resolve(mine.focus())
          .then(() =>
            typeof mine.navigate === 'function' ? mine.navigate(url) : self.clients.openWindow(url),
          )
          .catch(() => self.clients.openWindow(url)); // window tak terkontrol service worker tak dapat dinavigasi
      }),
    );
  });
})();
