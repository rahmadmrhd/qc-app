// Harness spike perangkat nyata (spek §11; Task 9). Dijalankan PEMILIK pada router jump dan satu
// perangkat Ubiquiti nyata; hasilnya (spike-report-<tanggal>.json) ditempel ke
// docs/superpowers/spikes/2026-11-hardware-spike.md. Tidak pernah dijalankan otomatis terhadap
// jaringan: tes memakai server SSH palsu.
//
// Keamanan: kata sandi HANYA dari variabel lingkungan (SPIKE_ROUTER_PASSWORD, SPIKE_UBNT_PASSWORD),
// tidak pernah dari argumen CLI, dan tidak pernah masuk laporan (catatan melewati maskSecrets).
// Semua tulis-uji (berkas di /temp router, berkas /tmp Ubiquiti) dibersihkan kembali.
//
// Satu-satunya efek samping yang disengaja pada Ubiquiti: satu baris known_hosts untuk router
// ditambahkan di /var/etc/persistent/.ssh/known_hosts, persis seperti skrip produksi.

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, type SFTPWrapper, type Stats } from 'ssh2';
import { type HostKey, HostKeyError, probeHostKey } from '../src/main/ssh/host-key';
import {
  type InjectProgress,
  maskSecrets,
  runInjectDetailed,
  type SentinelStrategy,
} from '../src/main/ssh/inject-session';

export type CheckResult = 'ok' | 'timeout' | 'error';

export interface SpikeTarget {
  host: string;
  port?: number;
  username: string;
  password: string;
}

export interface SpikeEnv {
  router: SpikeTarget;
  /** Perangkat Ubiquiti; `routerHostFromDevice` = alamat router seperti terlihat DARI perangkat. */
  ubiquiti?: SpikeTarget & { routerHostFromDevice?: string };
  timeouts?: Partial<{ connectMs: number; perLineMs: number; commandMs: number }>;
  /**
   * Baris uji penanda yang MEMAKAN WAKTU. `ok` hanya bila penanda baru kembali setelah
   * `minElapsedMs`: penanda yang kembali seketika berarti ia tidak menandai selesainya baris
   * (mis. konsol menggambar ulang ketikan sehingga token muncul dua kali dari echo saja).
   * Bawaan: `:delay 2s` (RouterOS) dan `sleep 2` (BusyBox), `minElapsedMs` 1800.
   */
  probe?: Partial<{ routerLine: string; ubiquitiLine: string; minElapsedMs: number }>;
}

export interface SpikeReport {
  router: {
    sentinelEcho: CheckResult;
    sentinelPut: CheckResult;
    sftpPut: boolean;
    sftpRename: boolean;
    sftpStat: boolean;
    hostKeyType: string;
    importBlocked: boolean | 'unknown';
    deviceMode: string;
  };
  ubiquiti?: { sentinelEcho: CheckResult; scpFromRouter: boolean };
  /** Cuplikan keluaran perangkat untuk diagnosis (sudah disamarkan, pendek). */
  notes: string[];
  meta: { generatedAt: string; node: string };
}

const DEFAULT_TIMEOUTS = { connectMs: 10_000, perLineMs: 10_000, commandMs: 30_000 };
const DEFAULT_PROBE = {
  routerLine: ':delay 2s',
  ubiquitiLine: 'sleep 2',
  minElapsedMs: 1800,
};
const TEST_FILE = 'qc-spike.tmp';
const TEST_DIR = '/temp';
const TEST_SIZE = 1024;
const NOTE_MAX = 200;
const HOST_PATTERN = /^[A-Za-z0-9.:_-]+$/;
const USER_PATTERN = /^[A-Za-z0-9._@-]+$/;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---- Pembantu ssh2 berbasis promise (satu sambungan untuk SFTP + exec) ----------------------

function connectClient(target: SpikeTarget, timeoutMs: number): Promise<Client> {
  return new Promise((resolveClient, rejectClient) => {
    const client = new Client();
    let settled = false;
    client.on('error', (error: Error) => {
      if (!settled) {
        settled = true;
        rejectClient(error);
      }
    });
    client.on('ready', () => {
      if (!settled) {
        settled = true;
        resolveClient(client);
      }
    });
    client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
      finish(prompts.map(() => target.password));
    });
    client.connect({
      host: target.host,
      port: target.port ?? 22,
      username: target.username,
      password: target.password,
      tryKeyboard: true,
      readyTimeout: timeoutMs,
    });
  });
}

function openSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((done, fail) => {
    client.sftp((error, sftp) => (error ? fail(error) : done(sftp)));
  });
}

function sftpCall<T>(run: (cb: (error: Error | null | undefined, value?: T) => void) => void) {
  return new Promise<T>((done, fail) => {
    run((error, value) => (error ? fail(error) : done(value as T)));
  });
}

function writeRemote(sftp: SFTPWrapper, path: string, data: Buffer): Promise<void> {
  return sftpCall<void>((cb) => sftp.writeFile(path, data, (error) => cb(error)));
}
function renameRemote(sftp: SFTPWrapper, from: string, to: string): Promise<void> {
  return sftpCall<void>((cb) => sftp.rename(from, to, (error) => cb(error)));
}
function statRemote(sftp: SFTPWrapper, path: string): Promise<Stats> {
  return sftpCall<Stats>((cb) => sftp.stat(path, (error, stats) => cb(error, stats)));
}
function unlinkRemote(sftp: SFTPWrapper, path: string): Promise<void> {
  return sftpCall<void>((cb) => sftp.unlink(path, (error) => cb(error)));
}

/** Menjalankan satu perintah lewat exec-channel dan mengumpulkan stdout+stderr. */
function execRemote(client: Client, command: string, timeoutMs: number): Promise<string> {
  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error('perintah melewati batas waktu')), timeoutMs);
    client.exec(command, (error, stream) => {
      if (error) {
        clearTimeout(timer);
        fail(error);
        return;
      }
      let output = '';
      stream.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
      });
      stream.stderr.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
      });
      stream.on('close', () => {
        clearTimeout(timer);
        done(output);
      });
    });
  });
}

// ---- Cek ---------------------------------------------------------------------------------------

interface Session {
  timeouts: typeof DEFAULT_TIMEOUTS;
  secrets: string[];
  note(message: string): void;
}

/** Satu sesi inject berpenanda; mengembalikan hasil dan baris keluaran perangkat. */
async function injectCheck(
  session: Session,
  target: SpikeTarget,
  strategy: SentinelStrategy,
  script: string,
  perLineMs: number,
  minElapsedMs?: number,
): Promise<{ result: CheckResult; output: string[] }> {
  const output: string[] = [];
  // Waktu dihitung sejak shell dibuka (tahap `sending`), tanpa waktu koneksi dan autentikasi.
  let shellOpenedAt = 0;
  const outcome = await runInjectDetailed({
    host: target.host,
    ...(target.port !== undefined ? { port: target.port } : {}),
    username: target.username,
    password: target.password,
    script,
    sentinel: strategy,
    secrets: session.secrets,
    timeouts: { connectMs: session.timeouts.connectMs, perLineMs },
    onProgress: (p: InjectProgress) => {
      if (p.stage === 'sending') shellOpenedAt = Date.now();
      if (p.stage === 'running') output.push(p.message);
    },
  });
  const elapsedMs = Date.now() - shellOpenedAt;
  let result: CheckResult = outcome.ok ? 'ok' : outcome.reason === 'timeout' ? 'timeout' : 'error';
  if (!outcome.ok) {
    session.note(
      `penanda ${strategy} pada ${target.host}: ${outcome.reason}; keluaran terakhir: ${output.slice(-3).join(' | ') || '(kosong)'}`,
    );
  } else if (minElapsedMs !== undefined && elapsedMs < minElapsedMs) {
    // Token kembali dua kali padahal baris belum mungkin selesai: penanda tidak andal.
    result = 'error';
    session.note(
      `penanda ${strategy} pada ${target.host} kembali dalam ${elapsedMs} ms, padahal baris uji butuh >= ${minElapsedMs} ms: penanda TIDAK menandai selesainya baris`,
    );
  }
  return { result, output };
}

function classifyImport(output: string): boolean | 'unknown' {
  if (/executed successfully|loaded successfully/i.test(output)) return false;
  if (/device-mode|not allowed|permission|denied/i.test(output)) return true;
  return 'unknown';
}

export async function runChecks(env: SpikeEnv): Promise<SpikeReport> {
  const timeouts = { ...DEFAULT_TIMEOUTS, ...env.timeouts };
  const probe = { ...DEFAULT_PROBE, ...env.probe };
  const secrets = [env.router.password, env.ubiquiti?.password ?? ''].filter((s) => s !== '');
  const notes: string[] = [];
  const session: Session = {
    timeouts,
    secrets,
    note: (message) => {
      notes.push(maskSecrets(message, secrets).replace(/\s+/g, ' ').slice(0, NOTE_MAX));
    },
  };

  const router: SpikeReport['router'] = {
    sentinelEcho: 'error',
    sentinelPut: 'error',
    sftpPut: false,
    sftpRename: false,
    sftpStat: false,
    hostKeyType: 'unknown',
    importBlocked: 'unknown',
    deviceMode: 'unknown',
  };

  // 1. Host key sekaligus gerbang: kredensial salah atau router mati berhenti di sini (satu
  // percobaan login, agar tidak memicu penguncian akun di router nyata).
  let hostKey: HostKey | null = null;
  try {
    hostKey = await probeHostKey({
      host: env.router.host,
      ...(env.router.port !== undefined ? { port: env.router.port } : {}),
      username: env.router.username,
      password: env.router.password,
      timeoutMs: timeouts.connectMs,
    });
    router.hostKeyType = hostKey.type;
  } catch (error) {
    router.hostKeyType = `error:${error instanceof HostKeyError ? error.code : 'UNKNOWN'}`;
    session.note(`router ${env.router.host}: ${messageOf(error)}`);
  }

  const created = new Set<string>();
  let routerSftp: SFTPWrapper | null = null;
  let routerClient: Client | null = null;
  const finalPath = `${TEST_DIR}/${TEST_FILE}`;
  const partPath = `${finalPath}.part`;
  const rscPath = `${TEST_DIR}/qc-spike.rsc`;

  try {
    if (hostKey) {
      // 2-3. Penanda: `echo` vs `:put` pada shell interaktif router (baris uji valid RouterOS).
      const echo = await injectCheck(
        session,
        env.router,
        'echo',
        probe.routerLine,
        timeouts.perLineMs,
        probe.minElapsedMs,
      );
      router.sentinelEcho = echo.result;
      const put = await injectCheck(
        session,
        env.router,
        'put',
        probe.routerLine,
        timeouts.perLineMs,
        probe.minElapsedMs,
      );
      router.sentinelPut = put.result;

      // 4. SFTP put, rename, stat pada /temp/ dengan berkas uji 1 KB; lalu device-mode dan /import.
      try {
        routerClient = await connectClient(env.router, timeouts.connectMs);
        try {
          routerSftp = await openSftp(routerClient);
        } catch (error) {
          session.note(`SFTP tidak dapat dibuka: ${messageOf(error)}`);
        }

        if (routerSftp) {
          // Sisa uji sebelumnya (mis. proses dihentikan Ctrl+C) tidak boleh menggagalkan rename
          // (SFTP v3 menolak rename ke nama yang sudah ada): bersihkan lebih dulu.
          for (const stale of [partPath, finalPath, rscPath]) {
            await unlinkRemote(routerSftp, stale).catch(() => {});
          }
          const payload = Buffer.alloc(TEST_SIZE, 0x51);
          try {
            await writeRemote(routerSftp, partPath, payload);
            created.add(partPath);
            router.sftpPut = true;
          } catch (error) {
            session.note(`SFTP put ke ${partPath} gagal: ${messageOf(error)}`);
          }
          if (router.sftpPut) {
            try {
              await renameRemote(routerSftp, partPath, finalPath);
              created.delete(partPath);
              created.add(finalPath);
              router.sftpRename = true;
            } catch (error) {
              session.note(`SFTP rename gagal: ${messageOf(error)}`);
            }
            // Info untuk sinkron §5 (mengganti berkas yang sudah ada): apakah rename menimpa?
            if (router.sftpRename) {
              try {
                await writeRemote(routerSftp, partPath, payload);
                created.add(partPath);
                await renameRemote(routerSftp, partPath, finalPath);
                created.delete(partPath);
                session.note('SFTP rename ke nama yang sudah ada: berhasil (menimpa)');
              } catch (error) {
                session.note(
                  `SFTP rename ke nama yang sudah ada: GAGAL (${messageOf(error)}); sinkron harus unlink dulu`,
                );
              }
            }
            try {
              const stats = await statRemote(routerSftp, router.sftpRename ? finalPath : partPath);
              router.sftpStat = stats.size === TEST_SIZE;
              if (!router.sftpStat)
                session.note(`SFTP stat: ukuran ${stats.size}, diharapkan ${TEST_SIZE}`);
            } catch (error) {
              session.note(`SFTP stat gagal: ${messageOf(error)}`);
            }
          }
        }

        // device-mode: apakah `/import` dibatasi.
        try {
          const out = await execRemote(
            routerClient,
            '/system device-mode print',
            timeouts.commandMs,
          );
          const mode = /^\s*mode:\s*(\S+)/m.exec(out);
          if (mode?.[1]) router.deviceMode = mode[1];
          else session.note(`device-mode tak terbaca: ${out.trim().slice(0, 120)}`);
        } catch (error) {
          session.note(`device-mode print gagal: ${messageOf(error)}`);
        }

        if (routerSftp) {
          try {
            await writeRemote(routerSftp, rscPath, Buffer.from('# qc-spike\n', 'utf8'));
            created.add(rscPath);
            const out = await execRemote(
              routerClient,
              `/import file-name=${rscPath.slice(1)}`,
              timeouts.commandMs,
            );
            router.importBlocked = classifyImport(out);
            if (router.importBlocked === 'unknown')
              session.note(`/import: ${out.trim().slice(0, 120)}`);
          } catch (error) {
            session.note(`uji /import gagal: ${messageOf(error)}`);
          }
        }
      } catch (error) {
        session.note(`sambungan SFTP/exec ke router gagal: ${messageOf(error)}`);
      }
    }

    // 5. Ubiquiti (berkas uji router masih ada agar `scp` dapat menariknya).
    let ubiquiti: SpikeReport['ubiquiti'];
    if (env.ubiquiti) {
      const ubnt = env.ubiquiti;
      const echo = await injectCheck(
        session,
        ubnt,
        'echo',
        probe.ubiquitiLine,
        timeouts.perLineMs,
        probe.minElapsedMs,
      );
      let scpFromRouter = false;
      const routerAddress = ubnt.routerHostFromDevice ?? env.router.host;
      if (echo.result !== 'ok') {
        session.note('scp dilewati: penanda echo di Ubiquiti tidak ok');
      } else if (hostKey?.type !== 'ssh-rsa') {
        session.note('scp dilewati: host key router bukan ssh-rsa');
      } else if (!created.has(finalPath)) {
        session.note('scp dilewati: berkas uji tidak ada di router (SFTP put/rename gagal)');
      } else {
        // Meniru awal skrip produksi (known_hosts lalu scp), lalu mengukur ukuran hasil unduhan.
        const known = '/var/etc/persistent/.ssh/known_hosts';
        const script = [
          'export HOME=/var/etc/persistent',
          `mkdir -p /var/etc/persistent/.ssh && touch ${known}`,
          `grep -q "${routerAddress} ssh-rsa" ${known} || echo ${routerAddress} ssh-rsa ${hostKey.base64} >> ${known}`,
          `scp ${env.router.username}@${routerAddress}:${finalPath} /tmp/${TEST_FILE}`,
          `wc -c < /tmp/${TEST_FILE}`,
          `rm -f /tmp/${TEST_FILE}`,
        ].join('\n');
        const scp = await injectCheck(session, ubnt, 'echo', script, timeouts.commandMs);
        scpFromRouter = scp.output.some((line) => line.trim() === String(TEST_SIZE));
        if (!scpFromRouter) {
          session.note(
            `scp tidak menghasilkan ${TEST_SIZE} byte; keluaran: ${scp.output.slice(-3).join(' | ')}`,
          );
        }
      }
      ubiquiti = { sentinelEcho: echo.result, scpFromRouter };
    }

    return {
      router,
      ...(ubiquiti ? { ubiquiti } : {}),
      notes,
      meta: { generatedAt: new Date().toISOString(), node: process.versions.node },
    };
  } finally {
    // 6. Bersihkan semua berkas uji, apa pun hasilnya.
    for (const path of created) {
      try {
        await (routerSftp
          ? unlinkRemote(routerSftp, path)
          : Promise.reject(new Error('SFTP tidak tersedia')));
      } catch (error) {
        session.note(`BERKAS UJI TERSISA di router: ${path} (${messageOf(error)}); hapus manual`);
      }
    }
    try {
      routerClient?.end();
    } catch {
      // Sudah tertutup.
    }
  }
}

// ---- Gerbang dan CLI -----------------------------------------------------------------------------

/** Aturan gerbang Step 6 (rencana Task 9): kegagalan salah satunya menghentikan Fase 1. */
export function gateVerdict(report: SpikeReport): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (report.router.sentinelPut !== 'ok') reasons.push('sentinelPut bukan ok');
  if (!report.router.sftpPut) reasons.push('sftpPut gagal');
  if (!report.router.sftpRename) reasons.push('sftpRename gagal');
  if (report.router.importBlocked === true) reasons.push('/import diblokir device-mode');
  return { pass: reasons.length === 0, reasons };
}

const USAGE = `Pemakaian:
  bun run --cwd desktop spike -- --router <ip> --router-user <pengguna> [--router-port <port>]
      [--ubnt <ip> --ubnt-user <pengguna> [--ubnt-port <port>] [--router-from-ubnt <ip>]]
Kata sandi HANYA dari variabel lingkungan SPIKE_ROUTER_PASSWORD dan SPIKE_UBNT_PASSWORD.`;

const KNOWN_FLAGS = new Set([
  '--router',
  '--router-user',
  '--router-port',
  '--ubnt',
  '--ubnt-user',
  '--ubnt-port',
  '--router-from-ubnt',
]);

function requireMatch(value: string, pattern: RegExp, flag: string): string {
  if (!pattern.test(value)) throw new Error(`Nilai ${flag} tidak valid`);
  return value;
}

function parsePort(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Nilai ${flag} bukan port yang sah`);
  }
  return port;
}

/** Mengurai argumen CLI; kata sandi hanya dibaca dari `env`, tidak pernah dari argumen. */
export function parseArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): SpikeEnv {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    const eq = arg.indexOf('=');
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    if (/pass|pwd|secret/i.test(flag)) {
      throw new Error(
        'Kata sandi tidak boleh lewat argumen; pakai variabel lingkungan SPIKE_ROUTER_PASSWORD / SPIKE_UBNT_PASSWORD',
      );
    }
    if (!flag.startsWith('--')) throw new Error('Argumen posisional tidak dikenal');
    if (!KNOWN_FLAGS.has(flag)) throw new Error(`Argumen tidak dikenal: ${flag}`);
    const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
    if (value === undefined || value.startsWith('--'))
      throw new Error(`Argumen ${flag} butuh nilai`);
    values.set(flag, value);
  }

  const routerHost = values.get('--router');
  const routerUser = values.get('--router-user');
  if (!routerHost) throw new Error('Argumen --router wajib');
  if (!routerUser) throw new Error('Argumen --router-user wajib');
  const routerPassword = env.SPIKE_ROUTER_PASSWORD;
  if (!routerPassword) throw new Error('Variabel lingkungan SPIKE_ROUTER_PASSWORD belum diatur');

  const routerPort = parsePort(values.get('--router-port'), '--router-port');
  const result: SpikeEnv = {
    router: {
      host: requireMatch(routerHost, HOST_PATTERN, '--router'),
      ...(routerPort !== undefined ? { port: routerPort } : {}),
      username: requireMatch(routerUser, USER_PATTERN, '--router-user'),
      password: routerPassword,
    },
  };

  const ubntHost = values.get('--ubnt');
  if (ubntHost) {
    const ubntUser = values.get('--ubnt-user');
    if (!ubntUser) throw new Error('Argumen --ubnt-user wajib bila --ubnt dipakai');
    const ubntPassword = env.SPIKE_UBNT_PASSWORD;
    if (!ubntPassword) throw new Error('Variabel lingkungan SPIKE_UBNT_PASSWORD belum diatur');
    const ubntPort = parsePort(values.get('--ubnt-port'), '--ubnt-port');
    const fromDevice = values.get('--router-from-ubnt');
    result.ubiquiti = {
      host: requireMatch(ubntHost, HOST_PATTERN, '--ubnt'),
      ...(ubntPort !== undefined ? { port: ubntPort } : {}),
      username: requireMatch(ubntUser, USER_PATTERN, '--ubnt-user'),
      password: ubntPassword,
      ...(fromDevice
        ? { routerHostFromDevice: requireMatch(fromDevice, HOST_PATTERN, '--router-from-ubnt') }
        : {}),
    };
  } else if (
    values.has('--ubnt-user') ||
    values.has('--ubnt-port') ||
    values.has('--router-from-ubnt')
  ) {
    throw new Error('Argumen Ubiquiti butuh --ubnt');
  }
  return result;
}

async function main(): Promise<void> {
  let env: SpikeEnv;
  try {
    env = parseArgs(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(`Galat argumen: ${messageOf(error)}\n\n${USAGE}`);
    process.exit(2);
  }
  console.log('Menjalankan spike; ini dapat memakan satu-dua menit...');
  const report = await runChecks(env);
  const file = `spike-report-${report.meta.generatedAt.slice(0, 10)}.json`;
  const json = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(file, json, 'utf8');
  console.log(json);
  console.log(`Laporan ditulis ke ${resolve(file)} (tanpa kata sandi).`);
  const verdict = gateVerdict(report);
  console.log(
    verdict.pass
      ? 'GERBANG: lolos menurut aturan Step 6.'
      : `GERBANG: TIDAK lolos (${verdict.reasons.join('; ')}). Hentikan; perbarui spek bersama pemilik.`,
  );
}

// Berjalan sebagai CLI hanya bila berkas ini yang dieksekusi (bukan saat diimpor tes).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`Spike gagal: ${messageOf(error)}`);
    process.exit(1);
  });
}
