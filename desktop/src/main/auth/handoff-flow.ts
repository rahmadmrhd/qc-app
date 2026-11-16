// Serah-terima akun dari peramban (keputusan pemilik 2026-11-16): tautan `qc://country-lock?handoff=<tiket>&as=<email>`
// dibuka dari halaman web Country Lock; tiketnya ditukar di server (`POST /auth/desktop/handoff`) jadi token Bearer.
//
// - Belum masuk: token langsung disimpan (pilihan pemilik; tanpa konfirmasi).
// - Sudah masuk dengan akun SAMA: tidak ada yang berubah, hanya membuka Country Lock.
// - Sudah masuk dengan akun BERBEDA: dialog konfirmasi "lanjut dengan akun peramban" atau "tetap dengan akun saat
//   ini"; token baru hanya disimpan bila pengguna memilih lanjut.
// Akun yang menentukan hanyalah hasil penukaran di server; `as=` di tautan hanya petunjuk (bila sama dengan akun saat
// ini, penukaran dilewati sehingga tiket tak terbuang). Token tak pernah ke renderer, log, atau galat. Satu serah-terima
// pada satu waktu; ditolak selama inject Country Lock berjalan (mengganti akun di tengah inject membuang hasilnya).

import type { AuthStatus } from '@countrylock/bridge-contract';
import type { Settings } from '../settings';
import type { TokenStore } from './token-store';

export interface HandoffInput {
  ticket: string;
  hint: string | null;
}

export type HandoffChoice = 'switch' | 'keep';

export interface HandoffDeps {
  settings: () => Settings;
  tokens: TokenStore;
  fetchImpl?: typeof fetch;
  /** Dialog konfirmasi akun berbeda; hanya dipanggil bila akunnya berbeda. */
  confirmSwitch(current: string, next: string): Promise<HandoffChoice>;
  /** Pesan galat untuk pengguna (dialog); tanpa isi tiket/token. */
  showError(message: string): void;
  /** Inject Country Lock sedang berjalan. */
  isBusy(): boolean;
  /** Status login berubah (token baru disimpan). */
  onChange(status: AuthStatus): void;
  /** Memuat halaman Country Lock (ditunda pemanggil bila perlu). */
  openCountryLock(): void;
}

export interface HandoffFlow {
  handle(input: HandoffInput): Promise<void>;
}

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_TOKEN_LENGTH = 4096;

export const HANDOFF_MESSAGES = {
  busy: 'Country Lock sedang berjalan. Selesaikan dulu, lalu buka lagi dari peramban.',
  expired: 'Tautan dari peramban sudah kedaluwarsa atau tidak valid. Buka lagi dari peramban.',
  unreachable: 'Tidak dapat terhubung ke server. Periksa koneksi, lalu buka lagi dari peramban.',
} as const;

const normalize = (email: string): string => email.trim().toLowerCase();

export function createHandoffFlow(deps: HandoffDeps): HandoffFlow {
  const doFetch = deps.fetchImpl ?? fetch;
  let running = false;

  type Exchanged = { token: string; email: string; expiresAt: number };
  async function exchange(ticket: string): Promise<Exchanged | 'rejected' | 'unreachable'> {
    let response: Response;
    try {
      response = await doFetch(`${deps.settings().serverUrl}/auth/desktop/handoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qc' },
        body: JSON.stringify({ ticket }),
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return 'unreachable';
    }
    if (response.status >= 500) return 'unreachable';
    if (response.status !== 200) return 'rejected';
    try {
      const body = (await response.json()) as Record<string, unknown>;
      const { token, expiresAt, email } = body;
      if (
        typeof token !== 'string' ||
        token === '' ||
        token.length > MAX_TOKEN_LENGTH ||
        typeof expiresAt !== 'number' ||
        !Number.isFinite(expiresAt) ||
        typeof email !== 'string' ||
        email === ''
      ) {
        return 'rejected';
      }
      return { token, email, expiresAt };
    } catch {
      return 'rejected';
    }
  }

  function commit(result: Exchanged): void {
    deps.tokens.set({ token: result.token, email: result.email, expiresAt: result.expiresAt });
    const stored = deps.tokens.get();
    deps.onChange({
      signedIn: stored !== null,
      email: stored ? stored.email : null,
      serverUrl: deps.settings().serverUrl,
    });
  }

  async function run(input: HandoffInput): Promise<void> {
    if (deps.isBusy()) {
      deps.showError(HANDOFF_MESSAGES.busy);
      return;
    }
    const current = deps.tokens.get();
    // Petunjuk sama dengan akun saat ini: tak perlu menukar (tiket tak terbuang); petunjuk palsu paling jauh membuat
    // desktop tetap pada akunnya sendiri.
    if (current && input.hint !== null && normalize(input.hint) === normalize(current.email)) {
      deps.openCountryLock();
      return;
    }
    const result = await exchange(input.ticket);
    if (result === 'unreachable') {
      deps.showError(HANDOFF_MESSAGES.unreachable);
      return;
    }
    if (result === 'rejected') {
      deps.showError(HANDOFF_MESSAGES.expired);
      return;
    }
    // Penukaran memakan waktu: inject bisa saja dimulai pengguna di antaranya.
    if (deps.isBusy()) {
      deps.showError(HANDOFF_MESSAGES.busy);
      return;
    }
    if (!current) {
      commit(result);
      deps.openCountryLock();
      return;
    }
    if (normalize(result.email) === normalize(current.email)) {
      deps.openCountryLock();
      return;
    }
    const choice = await deps.confirmSwitch(current.email, result.email);
    if (choice === 'switch') {
      if (deps.isBusy()) {
        deps.showError(HANDOFF_MESSAGES.busy);
        return;
      }
      commit(result);
    }
    deps.openCountryLock();
  }

  return {
    async handle(input) {
      // Tautan ganda/serentak diabaikan: dialog dan penukaran tak boleh bertumpuk.
      if (running) return;
      running = true;
      try {
        await run(input);
      } catch {
        deps.showError(HANDOFF_MESSAGES.expired);
      } finally {
        running = false;
      }
    },
  };
}
