import type { ConfigurableUpdater } from './start-app-update';

/**
 * Memuat `autoUpdater` dari electron-updater (paket CommonJS; impor dinamis menjaga bentuk ESM proses utama dan tahan
 * terhadap perbedaan ekspor bernama/default). `--smoke` memeriksa paket ini termuat dari hasil kemas.
 */
export async function loadAutoUpdater(): Promise<ConfigurableUpdater> {
  const mod = (await import('electron-updater')) as unknown as {
    autoUpdater?: ConfigurableUpdater;
    default?: { autoUpdater?: ConfigurableUpdater };
  };
  const updater = mod.autoUpdater ?? mod.default?.autoUpdater;
  if (!updater) throw new Error('electron-updater tidak menyediakan autoUpdater');
  return updater;
}
