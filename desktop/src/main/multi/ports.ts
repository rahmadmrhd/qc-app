// Port nyata mesin Multi (`countrylock/src/multi/engine.ts`): SSH exec ke router, ping ICMP, baca info perangkat, inject lewat
// runner bersama, dan penyimpanan peristiwa. Semua kegagalan dipetakan ke bentuk port dengan pesan buatan sendiri: sandi
// (perangkat maupun router) tidak pernah masuk pesan, dan keluaran router disamarkan sebelum keluar. Port `readLeases`,
// `ping`, dan `readInfo` tak punya signal, jadi masing-masing memakai batas waktunya sendiri.

import { randomUUID } from 'node:crypto';
import { stripTerminalControl } from '@countrylock/bridge-contract';
import type { MultiPorts } from '@countrylock/multi/engine';
import { LEASE_COMMAND, parseDhcpLeases } from '@countrylock/multi/lease';
import { abortError } from '@countrylock/multi/scheduler';
import { readDeviceInfo as realReadDeviceInfo } from '../device/info';
import { pingOnce } from '../device/ping';
import type { InjectRunner } from '../inject-runner';
import type { LoadedPackage } from '../package/local-folder';
import { execCommands, SshExecError } from '../ssh/exec';
import { maskSecrets } from '../ssh/inject-session';
import type { MultiEventStore } from '../store/multi-event-store';

const PING_TIMEOUT_MS = 1000;
const LEASE_TIMEOUT_MS = 4000;
const BRIDGE_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_CHARS = 120;
/** Nama interface/bridge RouterOS dari config.QC disisipkan ke perintah: hanya karakter aman. */
const SAFE_ROUTER_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
/** Galat RouterOS datang sebagai teks keluaran (exec-channel tak mengubah kode keluar menjadi galat). */
const ROUTER_ERROR =
  /failure:|bad command|syntax error|expected|invalid|no such|not allowed|permission|cannot|error/i;
const ALREADY_EXISTS = /already have such entry/i;

export interface MultiPortsDeps {
  /** Paket skrip aktif (router, firmware, dan kredensial server dibaca dari sini). */
  packages: { ensure(): Promise<LoadedPackage | null> };
  runner: InjectRunner;
  events: MultiEventStore;
  /** Dapat diganti tes (mis. diarahkan ke server SSH palsu). */
  exec?: typeof execCommands;
  ping?: typeof pingOnce;
  readDeviceInfo?: typeof realReadDeviceInfo;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Keluaran router untuk pesan: tanpa kontrol terminal, sandi server disamarkan, diringkas. */
function routerText(text: string, secrets: readonly string[]): string {
  const clean = maskSecrets(
    stripTerminalControl(text),
    secrets.filter((s) => s.length > 0),
  )
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > MAX_OUTPUT_CHARS ? `${clean.slice(0, MAX_OUTPUT_CHARS)}...` : clean;
}

export function createMultiPorts(deps: MultiPortsDeps): MultiPorts {
  const exec = deps.exec ?? execCommands;
  const ping = deps.ping ?? pingOnce;
  const readInfo = deps.readDeviceInfo ?? realReadDeviceInfo;

  return {
    now: () => Date.now(),
    sleep,
    newId: () => randomUUID(),

    async readLeases() {
      try {
        const pkg = await deps.packages.ensure();
        if (!pkg) return null;
        // Semua SSH dari PC ke router (lease, bridge, host key) = `config.server.ip` dengan kredensial `config.server`.
        // `ipServer` BUKAN host SSH: hanya nilai placeholder `{ipServer}` di skrip.
        const { server } = pkg.config;
        const [out = ''] = await exec(
          { host: server.ip, username: server.username, password: server.password },
          [LEASE_COMMAND],
          { timeoutMs: LEASE_TIMEOUT_MS },
        );
        return parseDhcpLeases(out);
      } catch {
        // Sengaja tanpa pesan galat: bisa memuat sandi atau alamat; engine menampilkan pesan generik.
        return null;
      }
    },

    async ping(ip) {
      try {
        return (await ping(ip, PING_TIMEOUT_MS)).ok;
      } catch {
        return false;
      }
    },

    async readInfo(ip, cred) {
      const result = await readInfo('ubiquiti', {
        host: ip,
        username: cred.username,
        password: cred.password,
      });
      if (result.ok) {
        const { model, serial, country } = result.info;
        return { ok: true, model, serial, country };
      }
      return {
        ok: false,
        error: result.error === 'PERMISSION_DENIED' ? 'PERMISSION_DENIED' : 'UNAVAILABLE',
      };
    },

    async inject(req, signal, onProgress) {
      const result = await deps.runner.run(
        {
          id: req.id,
          mode: 'multi',
          brand: 'ubiquiti',
          firmwareCode: req.firmwareCode,
          target: { ip: req.ip, username: req.cred.username, password: req.cred.password },
        },
        signal,
        onProgress,
      );
      return { ok: result.ok, stage: result.stage, message: result.message };
    },

    async ensureBridgePorts() {
      let pkg: LoadedPackage | null;
      try {
        pkg = await deps.packages.ensure();
      } catch {
        return { ok: false, message: 'Paket skrip tidak dapat dibaca' };
      }
      if (!pkg) return { ok: false, message: 'Paket skrip belum dipilih' };
      const { server } = pkg.config;
      const ubiquiti = pkg.config.brands.ubiquiti;
      if (!ubiquiti) return { ok: false, message: 'Paket skrip tidak memuat merk Ubiquiti' };

      const comp = server.interfaceComp.trim();
      const bridge = ubiquiti.multi.interfaceBridge.trim();
      const names = [comp, bridge, ...server.interfaceList];
      if (!names.every((n) => SAFE_ROUTER_NAME.test(n))) {
        return {
          ok: false,
          message:
            'Nama interface atau bridge di config.QC tidak valid (hanya huruf, angka, titik, garis bawah, dan tanda hubung)',
        };
      }

      // L4.2: hapus bridge port selain interfaceComp, lalu pastikan semua interface masuk bridge Multi.
      const steps = [
        {
          label: 'hapus bridge port',
          command: `/interface bridge port remove [find interface!=${comp}]`,
          idempotentAdd: false,
        },
        ...server.interfaceList.map((iface) => ({
          label: `tambah ${iface}`,
          command: `/interface bridge port add bridge=${bridge} interface=${iface}`,
          idempotentAdd: true,
        })),
      ];

      let outputs: string[];
      try {
        outputs = await exec(
          { host: server.ip, username: server.username, password: server.password },
          steps.map((s) => s.command),
          { timeoutMs: BRIDGE_TIMEOUT_MS },
        );
      } catch (error) {
        const denied = error instanceof SshExecError && error.kind === 'PERMISSION_DENIED';
        return {
          ok: false,
          message: denied
            ? 'Router menolak kredensial server di config.QC'
            : 'Tidak dapat tersambung ke router',
        };
      }

      const failures: string[] = [];
      steps.forEach((step, i) => {
        const out = outputs[i] ?? '';
        if (step.idempotentAdd && ALREADY_EXISTS.test(out)) return;
        if (ROUTER_ERROR.test(out)) {
          failures.push(`${step.label}: ${routerText(out, [server.password])}`);
        }
      });
      if (failures.length > 0) {
        return { ok: false, message: `Sebagian perintah gagal (${failures.join('; ')})` };
      }
      return {
        ok: true,
        message: `Bridge router siap (${server.interfaceList.length} interface ke ${bridge})`,
      };
    },

    events: {
      add: (event) => deps.events.add(event),
      list: () => deps.events.list(),
      ack: (ids) => deps.events.ack(ids),
    },
  };
}
