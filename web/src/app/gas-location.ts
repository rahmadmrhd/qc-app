export const TOP_LOCATION_TIMEOUT_MS = 1500;

/** Pulihkan route dari hash URL atas (bookmark/refresh) sebelum router dibuat. */
export function restoreHashFromTop(win: Window = window): Promise<void> {
  const url = win.google?.script?.url;
  if (!url) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, TOP_LOCATION_TIMEOUT_MS);
    url.getLocation((location) => {
      clearTimeout(timer);
      const hash = (location.hash ?? '').replace(/^#/, '');
      if (hash && !win.location.hash) win.location.hash = hash;
      resolve();
    });
  });
}

/** Salin hash route ke URL atas sekaligus membuang query ?code&state sisa login. */
export function syncTopUrl(hash: string, win: Window = window): void {
  win.google?.script?.history.replace(null, {}, hash.replace(/^#/, ''));
}
