// Pendaftaran IPC proses utama (spek §6). Renderer TIDAK tepercaya: setiap argumen divalidasi zod
// sebelum menyentuh layanan, tidak ada kanal yang menerima jalur berkas (folder paket dipilih lewat
// dialog proses utama), dan galat ke renderer tidak pernah memuat kata sandi.
//
// Mode inject: Fase 0-1 hanya mode tunggal ('single'); `InjectRequest` tidak membawa mode.

import {
  type AuthStatus,
  BRIDGE_ARGS,
  BRIDGE_CHANNELS,
  type CatalogSnapshot,
  type CatalogStatus,
  type DeviceInfoResult,
  type InjectProgressDto,
  type InjectRequest,
  type InjectResult,
  type PackageDto,
  type PingResult,
  type RouterInfoResult,
  stripTerminalControl,
} from '@countrylock/bridge-contract';
import {
  type ConnectTarget,
  type PingKind,
  PlanError,
  planInject,
  scriptKey,
} from '@countrylock/inject-plan';
import type { AddResult, PendingEntry } from '@countrylock/pending';
import { type Brand, ScriptRenderError } from '@countrylock/script-template';
import type { z } from 'zod';
import { type LoadedPackage, PackageError } from './package/local-folder';
import type { Settings } from './settings';
import { type HostKey, HostKeyError, type HostKeyOptions } from './ssh/host-key';
import {
  type InjectOptions,
  type InjectOutcome,
  type InjectReason,
  maskSecrets,
} from './ssh/inject-session';
import { SENTINEL_BY_BRAND } from './ssh/strategy';
import type { DraftStore } from './store/draft-store';
import type { PendingStore } from './store/pending-store';

/** Sebagian kecil `IpcMainInvokeEvent` yang dipakai; memudahkan tes tanpa memuat `electron`. */
export interface IpcEventLike {
  senderFrame?: { url: string } | null;
}

export interface IpcMainLike {
  handle(channel: string, listener: (event: IpcEventLike, ...args: unknown[]) => unknown): void;
}

export interface IpcDeps {
  ipcMain: IpcMainLike;
  settings: { get(): Settings; set(next: Partial<Settings>): void };
  loadPackage(dir: string): Promise<LoadedPackage>;
  /** Dialog pilih folder milik proses utama; null bila dibatalkan. Jalur tak pernah dari renderer. */
  chooseDirectory(): Promise<string | null>;
  ping(host: string, timeoutMs: number): Promise<{ ok: boolean; kind: PingKind }>;
  readDeviceInfo(brand: Brand, conn: ConnectTarget): Promise<DeviceInfoResult>;
  readRouterInfo(conn: ConnectTarget): Promise<RouterInfoResult>;
  fetchHostKey(opts: HostKeyOptions): Promise<HostKey>;
  runInject(opts: InjectOptions): Promise<InjectOutcome>;
  pending: PendingStore;
  /** Draft Catat Serial Number (jembatan v8): snapshot tunggal; galatnya sampai ke renderer apa adanya. */
  draft: DraftStore;
  /** Login desktop (token hanya di proses utama; renderer hanya menerima `AuthStatus`). */
  auth: { status(): AuthStatus; start(): Promise<void>; logout(): void };
  /**
   * Katalog Tipe offline (potret tersimpan + sinkron). Hanya data katalog dan status yang sampai ke renderer: tanpa token,
   * alamat server, atau jalur berkas.
   */
  catalog: {
    snapshot(): CatalogSnapshot | null;
    status(): CatalogStatus;
    refresh(): Promise<CatalogStatus>;
  };
  /** Menerapkan bundel UI siap dan memuat ulang jendela (proses utama yang memutuskan boleh/tidaknya). */
  ui: { reload(): Promise<void> };
  /** Kirim progres ke renderer (`webContents.send(INJECT_PROGRESS_EVENT, ...)`). */
  emitProgress(event: { id: string } & InjectProgressDto): void;
  /**
   * Dipanggil saat inject terakhir yang berjalan selesai (berhasil, gagal, atau dibatalkan);
   * proses utama memakainya untuk melepas pemuatan halaman yang ditunda selama inject.
   */
  onInjectIdle?(): void;
  /** Task 14 memasang pemeriksaan asal pengirim (hanya `app://qc`); bila ada dan false, ditolak. */
  isTrustedSender?(event: IpcEventLike): boolean;
}

const PING_TIMEOUT_MS = 1000;
const MAX_PROGRESS_CHARS = 500;

/** Galat yang pesannya aman ditampilkan ke renderer (tanpa kata sandi). */
class IpcError extends Error {}

const REASON_MESSAGES: Record<InjectReason, string> = {
  completed: 'Inject selesai',
  'dropped-after-output':
    'Inject selesai; perangkat memutus sambungan setelah skrip berjalan (kemungkinan memulai ulang)',
  timeout: 'Perangkat tidak menjawab dalam batas waktu',
  dropped: 'Sambungan ke perangkat terputus sebelum skrip selesai',
  auth: 'Perangkat menolak kredensial',
  connect: 'Tidak dapat tersambung ke perangkat',
  cancelled: 'Inject dibatalkan',
  error: 'Terjadi galat saat menjalankan skrip',
};

/** Argumen IPC divalidasi sebagai tuple (argumen berlebih ditolak); pesan tidak memuat nilai. */
function parseArgs<T extends z.ZodType>(schema: T, args: unknown[]): z.infer<T> {
  const result = schema.safeParse(args);
  if (!result.success) {
    const where = result.error.issues[0]?.path.filter((p) => typeof p === 'string').join('.');
    throw new IpcError(`Argumen tidak valid${where ? `: ${where}` : ''}`);
  }
  return result.data;
}

function toPackageDto(pkg: LoadedPackage): PackageDto {
  return {
    dir: pkg.dir,
    // Renderer tak butuh kata sandi server maupun JSON mentah (keduanya dipakai proses utama saja).
    config: { ...pkg.config, server: { ...pkg.config.server, password: '' }, raw: null },
    missing: pkg.missing,
    warnings: pkg.warnings,
  };
}

/** Buang escape terminal dulu, baru samarkan sandi (ANSI di tengah sandi tak boleh lolos). */
function sanitizeProgress(text: string, secrets: readonly string[]): string {
  const clean = maskSecrets(stripTerminalControl(text), secrets);
  return clean.length > MAX_PROGRESS_CHARS ? `${clean.slice(0, MAX_PROGRESS_CHARS)}...` : clean;
}

export function registerIpc(deps: IpcDeps): { isInjecting(): boolean } {
  const running = new Map<string, AbortController>();
  let current: LoadedPackage | null = null;

  const handle = (
    channel: string,
    listener: (event: IpcEventLike, ...args: unknown[]) => unknown,
  ): void => {
    deps.ipcMain.handle(channel, async (event, ...args) => {
      if (deps.isTrustedSender && !deps.isTrustedSender(event)) {
        throw new IpcError('Pengirim tidak dipercaya');
      }
      try {
        return await listener(event, ...args);
      } catch (error) {
        // Hanya galat yang sengaja dibuat (pesan aman) yang diteruskan; selebihnya generik.
        if (error instanceof IpcError || error instanceof PackageError) throw error;
        throw new IpcError('Terjadi galat pada proses utama');
      }
    });
  };

  const ensurePackage = async (): Promise<LoadedPackage | null> => {
    if (current) return current;
    const dir = deps.settings.get().packageDir;
    if (!dir) return null;
    current = await deps.loadPackage(dir);
    return current;
  };

  handle(BRIDGE_CHANNELS.packageLoad, async (_event, ...args) => {
    parseArgs(BRIDGE_ARGS.packageLoad, args);
    current = null;
    const pkg = await ensurePackage();
    return pkg ? toPackageDto(pkg) : null;
  });

  handle(BRIDGE_CHANNELS.packageChooseDir, async (_event, ...args) => {
    parseArgs(BRIDGE_ARGS.packageChooseDir, args);
    const dir = await deps.chooseDirectory();
    if (!dir) return null;
    // Dimuat dulu: folder tanpa config.QC yang sah tidak menggantikan paket aktif.
    const pkg = await deps.loadPackage(dir);
    deps.settings.set({ packageDir: dir });
    current = pkg;
    return toPackageDto(pkg);
  });

  handle(BRIDGE_CHANNELS.devicePing, async (_event, ...args): Promise<PingResult> => {
    const [host] = parseArgs(BRIDGE_ARGS.devicePing, args);
    return deps.ping(host, PING_TIMEOUT_MS);
  });

  handle(BRIDGE_CHANNELS.deviceReadInfo, async (_event, ...args) => {
    const [req] = parseArgs(BRIDGE_ARGS.deviceReadInfo, args);
    return deps.readDeviceInfo(req.brand, {
      host: req.host,
      username: req.username,
      password: req.password,
    });
  });

  handle(BRIDGE_CHANNELS.deviceReadRouterInfo, async (_event, ...args) => {
    const [req] = parseArgs(BRIDGE_ARGS.deviceReadRouterInfo, args);
    return deps.readRouterInfo({ host: req.host, username: req.username, password: req.password });
  });

  handle(BRIDGE_CHANNELS.injectRun, async (_event, ...args) => {
    const [req] = parseArgs(BRIDGE_ARGS.injectRun, args);
    return runInjectRequest(req);
  });

  handle(BRIDGE_CHANNELS.injectCancel, async (_event, ...args) => {
    const [id] = parseArgs(BRIDGE_ARGS.injectCancel, args);
    running.get(id)?.abort();
  });

  handle(BRIDGE_CHANNELS.authStatus, async (_event, ...args): Promise<AuthStatus> => {
    parseArgs(BRIDGE_ARGS.authStatus, args);
    return deps.auth.status();
  });

  handle(BRIDGE_CHANNELS.authLogin, async (_event, ...args) => {
    parseArgs(BRIDGE_ARGS.authLogin, args);
    try {
      await deps.auth.start();
    } catch {
      // Pesan asli dibuang: hanya pesan terkontrol yang sampai ke renderer.
      throw new IpcError('Tidak dapat membuka peramban sistem untuk login');
    }
  });

  handle(BRIDGE_CHANNELS.authLogout, async (_event, ...args) => {
    parseArgs(BRIDGE_ARGS.authLogout, args);
    deps.auth.logout();
  });

  handle(BRIDGE_CHANNELS.uiReload, async (_event, ...args) => {
    parseArgs(BRIDGE_ARGS.uiReload, args);
    await deps.ui.reload();
  });

  handle(BRIDGE_CHANNELS.catalogGet, async (_event, ...args): Promise<CatalogSnapshot | null> => {
    parseArgs(BRIDGE_ARGS.catalogGet, args);
    return deps.catalog.snapshot();
  });

  handle(BRIDGE_CHANNELS.catalogStatus, async (_event, ...args): Promise<CatalogStatus> => {
    parseArgs(BRIDGE_ARGS.catalogStatus, args);
    return deps.catalog.status();
  });

  handle(BRIDGE_CHANNELS.catalogRefresh, async (_event, ...args): Promise<CatalogStatus> => {
    parseArgs(BRIDGE_ARGS.catalogRefresh, args);
    return deps.catalog.refresh();
  });

  handle(BRIDGE_CHANNELS.pendingList, async (_event, ...args): Promise<PendingEntry[]> => {
    parseArgs(BRIDGE_ARGS.pendingList, args);
    return deps.pending.list();
  });

  handle(BRIDGE_CHANNELS.pendingAdd, async (_event, ...args): Promise<AddResult> => {
    const [entry] = parseArgs(BRIDGE_ARGS.pendingAdd, args);
    return deps.pending.add(entry);
  });

  handle(BRIDGE_CHANNELS.pendingRemove, async (_event, ...args) => {
    const [serial] = parseArgs(BRIDGE_ARGS.pendingRemove, args);
    deps.pending.remove(serial);
  });

  handle(BRIDGE_CHANNELS.draftLoad, async (_event, ...args): Promise<unknown[]> => {
    parseArgs(BRIDGE_ARGS.draftLoad, args);
    return deps.draft.load();
  });

  handle(BRIDGE_CHANNELS.draftSave, async (_event, ...args) => {
    const [rows] = parseArgs(BRIDGE_ARGS.draftSave, args);
    deps.draft.save(rows);
  });

  // Pengelola bundel UI memakai ini agar bundel tak ditukar di tengah inject.
  return { isInjecting: () => running.size > 0 };

  async function runInjectRequest(req: InjectRequest): Promise<InjectResult> {
    // Sandi yang diketahui sejauh ini; diperluas setelah paket dimuat. Semua pesan hasil disamarkan.
    let known: string[] = [req.target.password];
    const failed = (message: string): InjectResult => ({
      ok: false,
      stage: 'failed',
      message: sanitizeProgress(message, known),
    });

    if (running.has(req.id)) return failed('Inject dengan id ini sedang berjalan');
    const controller = new AbortController();
    running.set(req.id, controller);
    try {
      const pkg = await ensurePackage();
      if (!pkg) return failed('Paket skrip belum dipilih');

      const { config } = pkg;
      const serverPassword = config.server.password;
      known = [req.target.password, serverPassword];

      // {sshKey} = host key RSA router (server) yang diambil SAAT tersambung; hanya bila skrip memakainya.
      let sshKey = '';
      const brandConfig = config.brands[req.brand];
      const firmware = brandConfig?.firmware.find((f) => f.code === req.firmwareCode);
      const rawScript =
        brandConfig && firmware ? pkg.scripts[scriptKey(brandConfig, firmware.file)] : undefined;
      if (rawScript?.includes('{sshKey}')) {
        const hostKey = await deps.fetchHostKey({
          host: config.server.ip,
          username: config.server.username,
          password: serverPassword,
        });
        sshKey = hostKey.base64;
      }

      const plan = planInject({
        config,
        brand: req.brand,
        mode: 'single',
        firmwareCode: req.firmwareCode,
        scripts: new Map(Object.entries(pkg.scripts)),
        target: req.target,
        sshKey,
      });
      // plan.secrets = semua bentuk sisipan sandi di skrip (escape); ditambah sandi mentah.
      const secrets = [...new Set([...plan.secrets, ...known.filter((p) => p.length > 0)])];
      known = secrets;

      const outcome = await deps.runInject({
        host: plan.connect.host,
        username: plan.connect.username,
        password: plan.connect.password,
        script: plan.script,
        sentinel: SENTINEL_BY_BRAND[req.brand],
        secrets,
        signal: controller.signal,
        onProgress: (progress) => {
          deps.emitProgress({
            id: req.id,
            stage: progress.stage,
            message: sanitizeProgress(progress.message, secrets),
          });
        },
      });
      const stage = outcome.ok
        ? 'completed'
        : outcome.reason === 'cancelled'
          ? 'cancelled'
          : 'failed';
      return { ok: outcome.ok, stage, message: REASON_MESSAGES[outcome.reason] };
    } catch (error) {
      if (
        error instanceof PlanError ||
        error instanceof ScriptRenderError ||
        error instanceof PackageError ||
        error instanceof HostKeyError
      ) {
        return failed(error.message);
      }
      return failed('Terjadi galat saat menyiapkan inject');
    } finally {
      running.delete(req.id);
      if (running.size === 0) deps.onInjectIdle?.();
    }
  }
}
