// Host mode Multi-Device di proses utama (spek 2026-11-19 §2): satu engine per aplikasi, perintah dari IPC (argumen SUDAH
// divalidasi `BRIDGE_ARGS` oleh `ipc.ts`; host tidak mengurai ulang), saling-kecualikan dengan inject tunggal, dan
// penerusan snapshot ke renderer. Kredensial dasar dibaca dari paket skrip aktif DI SINI (renderer tak pernah mengirim
// sandi dasar). Galat yang sampai ke renderer hanya `IpcError` berpesan buatan sendiri.

import type { BRIDGE_CHANNELS } from '@countrylock/bridge-contract';
import { isValidHost } from '@countrylock/host';
import { scriptKey } from '@countrylock/inject-plan';
import { createMultiEngine, type MultiPorts } from '@countrylock/multi/engine';
import type { MultiSnapshot } from '@countrylock/multi/snapshot';
import { IpcError, sanitizeProgress } from '../ipc-support';
import type { LoadedPackage } from '../package/local-folder';

/** Nama kunci kanal `multi*` di `BRIDGE_CHANNELS`/`BRIDGE_ARGS` (urutan = urutan di kontrak). */
export const MULTI_CHANNEL_KEYS = [
  'multiStart',
  'multiStop',
  'multiScan',
  'multiSetConcurrency',
  'multiSetAutoInject',
  'multiInjectDevice',
  'multiCancelDevice',
  'multiInjectAll',
  'multiStopQueue',
  'multiCancelAll',
  'multiAddCredential',
  'multiSetBlocked',
  'multiSetRegistered',
  'multiPrepareBridge',
  'multiSnapshot',
  'multiPendingEvents',
  'multiAckInjected',
  'multiOpenWeb',
] as const satisfies ReadonlyArray<keyof typeof BRIDGE_CHANNELS>;

export type MultiChannelKey = (typeof MULTI_CHANNEL_KEYS)[number];

export interface MultiHostDeps {
  ports: MultiPorts;
  ensurePackage(): Promise<LoadedPackage | null>;
  /** Snapshot berubah (diteruskan ke renderer lewat `MULTI_CHANGE_EVENT`). */
  emitChange(snapshot: MultiSnapshot): void;
  /** Ada inject mode tunggal yang berjalan? (saling-kecualikan). */
  isSingleInjecting(): boolean;
  openExternal(url: string): Promise<void>;
  /** Dipanggil saat Multi berhenti sibuk (tak ada perangkat `queued`/`injecting`); melepas pemuatan halaman tertunda. */
  onIdle?(): void;
}

export interface MultiHost {
  /** `args` = argumen yang sudah divalidasi zod untuk kanal itu. */
  handle(channel: MultiChannelKey, args: unknown[]): Promise<unknown>;
  isRunning(): boolean;
  /** Ada perangkat yang sedang atau akan di-inject (`injecting` atau `queued`), termasuk yang dibatalkan dan belum selesai. */
  isInjecting(): boolean;
  dispose(): void;
}

const MSG_SINGLE_BUSY = 'Hentikan inject tunggal dulu';

export function createMultiHost(deps: MultiHostDeps): MultiHost {
  // Pertahanan ganda: pesan hasil "Siapkan bridge router" disamarkan lagi di sini (sandi server dari paket aktif),
  // walau port nyata sudah menyamarkannya; pesan itu juga masuk `snapshot().message`.
  const ports: MultiPorts = {
    ...deps.ports,
    // Arah sebaliknya dari penjaga `injectRun`: inject tunggal yang baru mulai saat Multi berjalan (diam) tak boleh
    // berbagi router dengan inject perangkat Multi (Auto Inject, Inject All, atau manual); perangkat ditandai gagal.
    async inject(req, signal, onProgress) {
      if (deps.isSingleInjecting()) {
        return { ok: false, stage: 'failed', message: MSG_SINGLE_BUSY };
      }
      return deps.ports.inject(req, signal, onProgress);
    },
    async ensureBridgePorts() {
      const result = await deps.ports.ensureBridgePorts();
      let secrets: string[] = [];
      try {
        const pkg = await deps.ensurePackage();
        if (pkg) {
          secrets = [pkg.config.server.password, pkg.config.brands.ubiquiti?.password ?? ''].filter(
            (secret) => secret.length > 0,
          );
        }
      } catch {
        // Tanpa paket tak ada sandi yang dikenal untuk disamarkan.
      }
      return { ok: result.ok, message: sanitizeProgress(result.message, secrets) };
    },
  };
  const engine = createMultiEngine(ports);
  let starting = false;
  let disposed = false;

  const busy = (s: MultiSnapshot): boolean => s.counts.injecting > 0 || s.counts.queued > 0;
  let wasBusy = false;
  const unsubscribe = engine.onChange((snapshot) => {
    if (disposed) return;
    deps.emitChange(snapshot);
    const nowBusy = busy(snapshot);
    if (wasBusy && !nowBusy) deps.onIdle?.();
    wasBusy = nowBusy;
  });

  async function start(cfg: {
    firmwareCode: string;
    concurrency: number;
    excludeIp: string;
    autoInject: boolean;
    target: Parameters<typeof engine.start>[0]['target'];
  }): Promise<void> {
    // `engine.start` diam-diam tidak berbuat apa-apa bila sudah berjalan: periksa sendiri agar pesannya jelas.
    if (starting || engine.snapshot().running) throw new IpcError('Multi sudah berjalan');
    if (deps.isSingleInjecting()) throw new IpcError(MSG_SINGLE_BUSY);
    starting = true;
    try {
      const pkg = await deps.ensurePackage();
      if (!pkg) throw new IpcError('Paket skrip belum dipilih');
      const ubiquiti = pkg.config.brands.ubiquiti;
      if (!ubiquiti) throw new IpcError('Paket skrip tidak memuat merk Ubiquiti');
      const firmware = ubiquiti.firmware.find((f) => f.code === cfg.firmwareCode);
      if (!firmware) throw new IpcError(`Firmware "${cfg.firmwareCode}" tidak ada di config.QC`);
      const script = pkg.scripts[scriptKey(ubiquiti, firmware.file)];
      if (script === undefined) {
        throw new IpcError(`Skrip ${firmware.file} tidak ditemukan di paket skrip`);
      }
      // Inject tunggal bisa saja dimulai selama paket dimuat: periksa lagi tepat sebelum engine berjalan.
      if (deps.isSingleInjecting()) throw new IpcError(MSG_SINGLE_BUSY);
      engine.start({
        ...cfg,
        target: { ...cfg.target },
        base: { username: ubiquiti.username, password: ubiquiti.password },
      });
    } finally {
      starting = false;
    }
  }

  async function openWeb(mac: string): Promise<void> {
    const device = engine.snapshot().devices.find((d) => d.mac === mac);
    if (!device) throw new IpcError('Perangkat tidak ditemukan');
    // Hanya IP/nama host yang sah dari snapshot; bentuk URL selalu `https://<ip>` (tak pernah dari renderer).
    if (!isValidHost(device.ip)) throw new IpcError('Alamat perangkat tidak valid');
    await deps.openExternal(`https://${device.ip}`);
  }

  return {
    async handle(channel, args) {
      switch (channel) {
        case 'multiStart':
          return start(args[0] as Parameters<typeof start>[0]);
        case 'multiStop':
          await engine.stop();
          return undefined;
        case 'multiScan':
          await engine.scan();
          return undefined;
        case 'multiSetConcurrency':
          engine.setConcurrency(args[0] as number);
          return undefined;
        case 'multiSetAutoInject':
          engine.setAutoInject(args[0] as boolean);
          return undefined;
        case 'multiInjectDevice':
          engine.injectDevice(args[0] as string);
          return undefined;
        case 'multiCancelDevice':
          engine.cancelDevice(args[0] as string);
          return undefined;
        case 'multiInjectAll':
          engine.injectAll();
          return undefined;
        case 'multiStopQueue':
          engine.stopQueue();
          return undefined;
        case 'multiCancelAll':
          engine.cancelAll();
          return undefined;
        case 'multiAddCredential':
          engine.addCredential(args[0] as { username: string; password: string });
          return undefined;
        case 'multiSetBlocked':
          engine.setBlocked(args[0] as string | null);
          return undefined;
        case 'multiSetRegistered':
          engine.setRegistered(args[0] as string[]);
          return undefined;
        case 'multiPrepareBridge':
          return engine.prepareBridge();
        case 'multiSnapshot':
          return engine.snapshot();
        case 'multiPendingEvents':
          return engine.pendingEvents();
        case 'multiAckInjected':
          engine.ackInjected(args[0] as string[]);
          return undefined;
        case 'multiOpenWeb':
          return openWeb(args[0] as string);
      }
    },
    // Termasuk jendela saat `multiStart` menunggu paket dimuat (paket tak boleh diganti di sela itu).
    isRunning: () => starting || engine.snapshot().running,
    // Termasuk inject yang dibatalkan `stop()` tetapi belum selesai menutup sesi SSH-nya (`engine.isBusy`).
    isInjecting: () => engine.isBusy() || busy(engine.snapshot()),
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      // `stop()` membatalkan semua loop dan inject secara SINKRON (abort) sebelum menunggu; Electron tak menunggu di will-quit.
      void engine.stop();
    },
  };
}
