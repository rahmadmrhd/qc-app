// Hook halaman Country Lock mode tunggal (spek §6.1): memuat paket, memutar loop ping perangkat dan
// router jump (interval dari `nextPingDelayMs`), membaca info perangkat saat ping naik, menjaga
// `reduceSession`, menjalankan inject, dan mencatat pending HANYA setelah `inject.run` sukses.
// Semua efek samping ada di sini; aturan murninya di `@countrylock/*`.

import { PENDING_TARGET_BRIDGE_VERSION } from '@countrylock/bridge-channels';
import type {
  InjectProgressDto,
  InjectResult,
  PackageDto,
  QcBridge,
} from '@countrylock/bridge-contract';
import { bridgeInterfaces } from '@countrylock/config';
import type { DeviceInfo } from '@countrylock/device-info';
import { nextPingDelayMs, type PingKind } from '@countrylock/inject-plan';
import { normalizeSerial, type PendingEntry } from '@countrylock/pending';
import type { Brand } from '@countrylock/script-template';
import {
  canInject,
  INITIAL_SESSION,
  reduceSession,
  type SessionEvent,
  type SessionState,
  shouldAutoInject,
} from '@countrylock/session-machine';
import type { CatalogItemDto } from '@shared/desktop-catalog';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  appendLog,
  isCredentialFailure,
  localDate,
  safeErrorMessage,
  safeLine,
} from './lib/safe-text';
import { resolveTypeApplication, type TypeApplication } from './lib/type-firmware';
import type { PendingTarget } from './use-inject-target';

/** Jeda sebelum dialog progres menutup sendiri setelah inject sukses/dibatalkan (legacy: 1 detik). */
export const AUTO_CLOSE_MS = 1000;

export type ProgressStage = Exclude<InjectProgressDto['stage'], 'sending'>;

export interface InjectProgress {
  id: string;
  stage: ProgressStage;
  /** Pesan akhir (hasil `inject.run`); kosong selama berjalan. */
  message: string;
  running: boolean;
  outcome: 'success' | 'failed' | 'cancelled' | null;
}

export interface CredentialPrompt {
  username: string;
  password: string;
  reason: string;
}

/**
 * Tipe katalog yang dipilih di form inject (spek desktop §6.6, alur aplikasi lama: Merk -> Tipe -> Firmware). `name`
 * (model) dicatat bersama serial di antrean pending; `application` menentukan apakah Firmware terisi dan terkunci
 * (`ok`) atau dipilih manual dengan alasan.
 */
export interface TipeSelection {
  id: string;
  name: string;
  application: TypeApplication;
}

export interface CountryLockActions {
  select(brand: Brand, firmwareCode: string | null): void;
  /**
   * BU dan lokasi tujuan yang dicatat bersama serial saat inject sukses (diisi halaman dari pilihan form; hanya
   * dikirim ke jembatan v6 ke atas karena skema `pending.add` jembatan lama menolak field itu).
   */
  setTarget(target: PendingTarget): void;
  /** Memilih (atau mengosongkan, `null`) Tipe katalog; mengisi Firmware bila Tipe punya firmware yang ada di paket. */
  selectTipe(item: CatalogItemDto | null): void;
  inject(): void;
  cancel(): void;
  toggleAuto(on: boolean): void;
  submitCredentials(username: string, password: string): void;
  chooseDir(): void;
  closeProgress(): void;
  openCredentials(): void;
  dismissCredentials(): void;
}

export interface UseCountryLock {
  state: SessionState;
  pkg: PackageDto | null;
  info: DeviceInfo | null;
  /** Tipe katalog terpilih (null = belum dipilih atau dipilih manual tanpa katalog). */
  tipe: TipeSelection | null;
  /** Log baca-saja inject terakhir (sudah disamarkan dan tanpa karakter kontrol). */
  log: string[];
  pending: PendingEntry[];
  loading: boolean;
  loadError: string | null;
  progress: InjectProgress | null;
  credentialPrompt: CredentialPrompt | null;
  actions: CountryLockActions;
}

interface Credentials {
  username: string;
  password: string;
}

let injectCounter = 0;
/** Id inject: hanya huruf, angka, `_` dan `-` (skema kontrak jembatan). */
function newInjectId(): string {
  injectCounter += 1;
  return `inj-${Date.now().toString(36)}-${injectCounter}`;
}

export function useCountryLock(bridge: QcBridge): UseCountryLock {
  const [pkg, setPkg] = useState<PackageDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<SessionState>(INITIAL_SESSION);
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const [tipe, setTipe] = useState<TipeSelection | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingEntry[]>([]);
  const [progress, setProgress] = useState<InjectProgress | null>(null);
  const [credentialPrompt, setCredentialPrompt] = useState<CredentialPrompt | null>(null);

  // Salinan sinkron untuk penjaga re-entry dan loop async (state React baru terlihat setelah render).
  const stateRef = useRef<SessionState>(INITIAL_SESSION);
  const pkgRef = useRef<PackageDto | null>(null);
  /** Salinan sinkron `tipe`: dibaca saat inject selesai untuk dicatat ke pending. */
  const tipeRef = useRef<TipeSelection | null>(null);
  const targetRef = useRef<PendingTarget>({});
  const credentialsRef = useRef<Credentials>({ username: '', password: '' });
  /** Kredensial ditolak: pembacaan info berhenti sampai kredensial baru atau perangkat berganti. */
  const deniedRef = useRef(false);
  const injectIdRef = useRef<string | null>(null);
  const secretsRef = useRef<string[]>([]);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  /** Serial yang sudah berhasil di-inject pada sesi ini (jaring pengaman bila pencatatan pending gagal). */
  const injectedSerialsRef = useRef<Set<string>>(new Set());
  /** Auto inject hanya sekali per serial; dilepas saat serial kosong atau Auto Inject diganti. */
  const lastAutoSerialRef = useRef<string | null>(null);

  const apply = useCallback((event: SessionEvent) => {
    const current = pkgRef.current;
    const server = current?.config.server;
    const interfaceCount = server ? bridgeInterfaces(server).length : 0;
    const next = reduceSession(stateRef.current, event, { interfaceCount });
    stateRef.current = next;
    setState(next);
  }, []);

  const defaultCredentials = useCallback((brand: Brand | null): Credentials => {
    const config = brand ? pkgRef.current?.config.brands[brand] : undefined;
    return { username: config?.username ?? '', password: config?.password ?? '' };
  }, []);

  const requestCredentials = useCallback((reason: string) => {
    deniedRef.current = true;
    const { username, password } = credentialsRef.current;
    setCredentialPrompt({ username, password, reason });
  }, []);

  const refreshPending = useCallback(async () => {
    try {
      const list = await bridge.pending.list();
      setPending(list);
    } catch {
      // Daftar lama dipertahankan; pencatatan berikutnya mencoba lagi.
    }
  }, [bridge]);

  // --- Muat paket dan antrean pending -----------------------------------------------------
  useEffect(() => {
    mountedRef.current = true;
    let alive = true;
    void (async () => {
      try {
        const loaded = await bridge.package.load();
        if (!alive) return;
        pkgRef.current = loaded;
        setPkg(loaded);
      } catch {
        if (alive) setLoadError('Paket skrip tidak dapat dimuat');
      }
      await refreshPending();
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
      mountedRef.current = false;
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, [bridge, refreshPending]);

  // --- Progres inject dari proses utama ---------------------------------------------------
  useEffect(
    () =>
      bridge.inject.onProgress((event) => {
        if (event.id !== injectIdRef.current) return;
        // Teks dari shell perangkat: dibersihkan lagi di sini dan hanya dirender sebagai teks.
        const line = safeLine(event.message, secretsRef.current);
        if (line !== '') setLog((previous) => appendLog(previous, line));
        // Tahap `sending` tidak mengubah judul (perilaku lama).
        if (event.stage !== 'sending') {
          const stage = event.stage;
          setProgress((current) =>
            current && current.id === event.id && current.running ? { ...current, stage } : current,
          );
        }
      }),
    [bridge],
  );

  // --- Loop ping perangkat dan baca info --------------------------------------------------
  const brand = state.brand;
  useEffect(() => {
    const brandConfig = brand ? pkg?.config.brands[brand] : undefined;
    const host = brandConfig?.single.ip ?? '';
    if (!brand || host === '') return;

    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      });

    // Perangkat/merk baru: mulai dari keadaan bersih.
    apply({ type: 'ping-device', ok: false, serial: '' });
    setInfo(null);
    deniedRef.current = false;

    const readInfo = async () => {
      const current = stateRef.current;
      if (current.injecting || current.serial !== '' || deniedRef.current) return;
      const { username, password } = credentialsRef.current;
      if (username === '') {
        requestCredentials('Username perangkat belum diisi.');
        return;
      }
      let result: Awaited<ReturnType<QcBridge['device']['readInfo']>>;
      try {
        result = await bridge.device.readInfo({ brand, host, username, password });
      } catch {
        return; // dicoba lagi pada ping berikutnya
      }
      if (!alive) return;
      if (result.ok) {
        setInfo(result.info);
        apply({ type: 'ping-device', ok: true, serial: result.info.serial });
      } else if (result.error === 'PERMISSION_DENIED') {
        requestCredentials('Perangkat menolak username atau password.');
      }
      // UNAVAILABLE (SSH belum siap): dicoba lagi pada ping berikutnya.
    };

    void (async () => {
      while (alive) {
        let ok = false;
        let kind: PingKind = 'error';
        try {
          const result = await bridge.device.ping(host);
          ok = result.ok;
          kind = result.kind;
        } catch {
          // galat jaringan/IPC = ping gagal
        }
        if (!alive) return;
        if (ok) {
          if (!stateRef.current.devicePingable) {
            apply({ type: 'ping-device', ok: true, serial: stateRef.current.serial });
          }
          await readInfo();
          if (!alive) return;
        } else if (stateRef.current.devicePingable || stateRef.current.serial !== '') {
          apply({ type: 'ping-device', ok: false, serial: '' });
          setInfo(null);
          deniedRef.current = false;
        }
        await sleep(nextPingDelayMs(kind));
      }
    })();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [bridge, brand, pkg, apply, requestCredentials]);

  // --- Loop ping router jump --------------------------------------------------------------
  useEffect(() => {
    const host = pkg?.config.server.ip ?? '';
    if (!brand || host === '') return;

    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      });
    apply({ type: 'ping-router', ok: false });

    void (async () => {
      while (alive) {
        let ok = false;
        let kind: PingKind = 'error';
        try {
          const result = await bridge.device.ping(host);
          ok = result.ok;
          kind = result.kind;
        } catch {
          // galat jaringan/IPC = ping gagal
        }
        if (!alive) return;
        apply({ type: 'ping-router', ok });
        await sleep(nextPingDelayMs(kind));
      }
    })();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [bridge, brand, pkg, apply]);

  // --- Inject -----------------------------------------------------------------------------
  const runInject = useCallback(async () => {
    const start = stateRef.current;
    const brandName = start.brand;
    const config = brandName ? pkgRef.current?.config.brands[brandName] : undefined;
    if (!canInject(start) || !brandName || !start.firmwareCode || !config) return;
    const host = config.single.ip;
    if (host === '') return;

    // Penjaga re-entry: diklaim sinkron sebelum kerja async apa pun.
    apply({ type: 'inject-start' });
    if (!stateRef.current.injecting) return;

    const serial = start.serial;
    // Tipe dicatat sesuai pilihan saat inject dimulai (bukan saat selesai), agar tak berubah di tengah jalan.
    const tipeName = tipeRef.current?.name ?? '';
    // BU/lokasi mengikuti pilihan saat inject dimulai juga; jembatan lama tidak menerimanya.
    const target = bridge.version >= PENDING_TARGET_BRIDGE_VERSION ? { ...targetRef.current } : {};
    const credentials = credentialsRef.current;
    const id = newInjectId();
    injectIdRef.current = id;
    secretsRef.current = [credentials.password];
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setLog([]);
    setProgress({ id, stage: 'connecting', message: '', running: true, outcome: null });

    let result: InjectResult;
    try {
      result = await bridge.inject.run({
        id,
        brand: brandName,
        firmwareCode: start.firmwareCode,
        target: { ip: host, username: credentials.username, password: credentials.password },
      });
    } catch (error) {
      result = {
        ok: false,
        stage: 'failed',
        message: safeErrorMessage(error, secretsRef.current),
      };
    }

    const outcome = result.ok ? 'success' : result.stage === 'cancelled' ? 'cancelled' : 'failed';
    const message = safeLine(result.message, secretsRef.current);

    if (outcome === 'success') {
      // Dicatat HANYA setelah sukses; `injecting` tetap menyala sampai pencatatan selesai agar
      // pembacaan serial berikutnya (perangkat yang sama) sudah melihat daftar pending terbaru.
      injectedSerialsRef.current.add(normalizeSerial(serial));
      try {
        await bridge.pending.add({
          serial,
          brand: brandName,
          tipe: tipeName,
          ...target,
          date: localDate(),
          timestamp: new Date().toISOString(),
        });
      } catch {
        setLog((previous) => appendLog(previous, 'Peringatan: serial gagal dicatat ke antrean.'));
      }
      await refreshPending();
    }
    apply({ type: 'inject-done', outcome });
    if (outcome === 'success') setInfo(null); // dibaca ulang pada ping berikutnya

    if (outcome === 'failed' && isCredentialFailure(result.message)) {
      // Kredensial ditolak: dialog progres ditutup dan pengguna diminta mengisi kredensial baru.
      setProgress(null);
      requestCredentials('Perangkat menolak username atau password.');
      return;
    }

    setProgress({
      id,
      stage: outcome === 'success' ? 'completed' : outcome === 'cancelled' ? 'cancelled' : 'failed',
      message,
      running: false,
      outcome,
    });
    if (outcome !== 'failed' && mountedRef.current) {
      closeTimerRef.current = setTimeout(() => {
        setProgress((current) => (current?.id === id ? null : current));
      }, AUTO_CLOSE_MS);
    }
  }, [bridge, apply, refreshPending, requestCredentials]);

  // --- Auto inject ------------------------------------------------------------------------
  useEffect(() => {
    if (state.serial === '') {
      lastAutoSerialRef.current = null;
      return;
    }
    if (!shouldAutoInject(state, pending)) return;
    const key = normalizeSerial(state.serial);
    if (injectedSerialsRef.current.has(key) || lastAutoSerialRef.current === key) return;
    lastAutoSerialRef.current = key;
    void runInject();
  }, [state, pending, runInject]);

  // --- Aksi -------------------------------------------------------------------------------
  const clearTipe = useCallback(() => {
    tipeRef.current = null;
    setTipe(null);
  }, []);

  const select = useCallback(
    (nextBrand: Brand, firmwareCode: string | null) => {
      if (stateRef.current.brand !== nextBrand) {
        // Daftar Tipe milik satu merk: Tipe lama tak berlaku lagi (aplikasi lama mengganti daftarnya).
        clearTipe();
        credentialsRef.current = defaultCredentials(nextBrand);
        deniedRef.current = false;
        setCredentialPrompt(null);
        setInfo(null);
      }
      apply({ type: 'select', brand: nextBrand, firmwareCode });
    },
    [apply, clearTipe, defaultCredentials],
  );

  const setTarget = useCallback((target: PendingTarget) => {
    targetRef.current = target;
  }, []);

  const selectTipe = useCallback(
    (item: CatalogItemDto | null) => {
      const currentBrand = stateRef.current.brand;
      if (!item || !currentBrand) {
        clearTipe();
        return;
      }
      const application = resolveTypeApplication(item, pkgRef.current);
      const next: TipeSelection = { id: item.id, name: item.model, application };
      tipeRef.current = next;
      setTipe(next);
      // Firmware ikut Tipe bila berlaku; selain itu dikosongkan dan dipilih manual (perilaku aplikasi lama).
      apply({
        type: 'select',
        brand: currentBrand,
        firmwareCode: application.ok ? application.firmwareCode : null,
      });
    },
    [apply, clearTipe],
  );

  const toggleAuto = useCallback(
    (on: boolean) => {
      lastAutoSerialRef.current = null;
      apply({ type: 'toggle-auto', on });
    },
    [apply],
  );

  const cancel = useCallback(() => {
    const id = injectIdRef.current;
    if (id) void bridge.inject.cancel(id).catch(() => undefined);
  }, [bridge]);

  const submitCredentials = useCallback((username: string, password: string) => {
    credentialsRef.current = { username, password };
    deniedRef.current = false;
    setCredentialPrompt(null);
  }, []);

  const chooseDir = useCallback(() => {
    void (async () => {
      let next: PackageDto | null;
      try {
        next = await bridge.package.chooseDir();
      } catch {
        setLoadError('Folder paket tidak dapat dibaca');
        return;
      }
      if (!next) return; // dibatalkan: paket lama dipertahankan
      setLoadError(null);
      pkgRef.current = next;
      credentialsRef.current = { username: '', password: '' };
      deniedRef.current = false;
      setCredentialPrompt(null);
      setInfo(null);
      clearTipe();
      apply({ type: 'reset' });
      setPkg(next);
    })();
  }, [bridge, apply, clearTipe]);

  const closeProgress = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setProgress((current) => (current && !current.running ? null : current));
  }, []);

  const openCredentials = useCallback(() => {
    const { username, password } = credentialsRef.current;
    setCredentialPrompt({ username, password, reason: '' });
  }, []);

  const dismissCredentials = useCallback(() => setCredentialPrompt(null), []);

  return {
    state,
    pkg,
    info,
    tipe,
    log,
    pending,
    loading,
    loadError,
    progress,
    credentialPrompt,
    actions: {
      select,
      selectTipe,
      setTarget,
      inject: () => {
        void runInject();
      },
      cancel,
      toggleAuto,
      submitCredentials,
      chooseDir,
      closeProgress,
      openCredentials,
      dismissCredentials,
    },
  };
}
