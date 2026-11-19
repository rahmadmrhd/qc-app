// Runner inject bersama (diekstrak dari `runInjectRequest` di `ipc.ts`, perilaku mode tunggal TIDAK berubah): memuat paket,
// mengambil host key router bila skrip memakai {sshKey}, merencanakan skrip (`planInject`), menjalankan eksekutor SSH, dan
// memetakan hasilnya ke pesan aman. Dipakai mode tunggal (lewat IPC, dengan `emitProgress`) dan mode Multi (lewat port
// engine, dengan `onProgress`). Semua teks progres dan pesan hasil dibersihkan DI SINI (tanpa kontrol terminal, sandi
// disamarkan) sebelum keluar ke pemanggil mana pun.

import type { InjectProgressDto, InjectResult } from '@countrylock/bridge-contract';
import { PlanError, planInject, scriptKey } from '@countrylock/inject-plan';
import { type Brand, ScriptRenderError } from '@countrylock/script-template';
import { sanitizeProgress } from './ipc-support';
import { type LoadedPackage, PackageError } from './package/local-folder';
import { type HostKey, HostKeyError, type HostKeyOptions } from './ssh/host-key';
import type { InjectOptions, InjectOutcome, InjectReason } from './ssh/inject-session';
import { SENTINEL_BY_BRAND } from './ssh/strategy';

export const REASON_MESSAGES: Record<InjectReason, string> = {
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

export interface InjectRunnerDeps {
  ensurePackage(): Promise<LoadedPackage | null>;
  fetchHostKey(opts: HostKeyOptions): Promise<HostKey>;
  runInject(opts: InjectOptions): Promise<InjectOutcome>;
  /** Progres bertahap ke renderer (hanya mode tunggal; Multi memakai `onProgress` per panggilan). */
  emitProgress?(event: { id: string } & InjectProgressDto): void;
}

export interface InjectRunInput {
  id: string;
  mode: 'single' | 'multi';
  brand: Brand;
  firmwareCode: string;
  target: { ip: string; username: string; password: string };
}

export interface InjectRunner {
  /**
   * Menjalankan satu inject. Tidak pernah melempar: kegagalan apa pun menjadi `{ ok: false }` dengan pesan yang sudah
   * dibersihkan. `onProgress` menerima teks progres yang sudah dibersihkan.
   */
  run(
    input: InjectRunInput,
    signal: AbortSignal,
    onProgress?: (message: string) => void,
  ): Promise<InjectResult>;
}

export function createInjectRunner(deps: InjectRunnerDeps): InjectRunner {
  return {
    async run(req, signal, onProgress) {
      // Sandi yang diketahui sejauh ini; diperluas setelah paket dimuat. Semua pesan hasil disamarkan.
      let known: string[] = [req.target.password];
      const failed = (message: string): InjectResult => ({
        ok: false,
        stage: 'failed',
        message: sanitizeProgress(message, known),
      });

      try {
        const pkg = await deps.ensurePackage();
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
            signal,
          });
          sshKey = hostKey.base64;
        }

        const plan = planInject({
          config,
          brand: req.brand,
          mode: req.mode,
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
          signal,
          onProgress: (progress) => {
            const message = sanitizeProgress(progress.message, secrets);
            deps.emitProgress?.({ id: req.id, stage: progress.stage, message });
            onProgress?.(message);
          },
        });
        const stage = outcome.ok
          ? 'completed'
          : outcome.reason === 'cancelled'
            ? 'cancelled'
            : 'failed';
        return { ok: outcome.ok, stage, message: REASON_MESSAGES[outcome.reason] };
      } catch (error) {
        // Dibatalkan saat mengambil host key router: sama dengan pembatalan saat inject berjalan.
        if (signal.aborted && error instanceof HostKeyError) {
          return { ok: false, stage: 'cancelled', message: REASON_MESSAGES.cancelled };
        }
        if (
          error instanceof PlanError ||
          error instanceof ScriptRenderError ||
          error instanceof PackageError ||
          error instanceof HostKeyError
        ) {
          return failed(error.message);
        }
        return failed('Terjadi galat saat menyiapkan inject');
      }
    },
  };
}
