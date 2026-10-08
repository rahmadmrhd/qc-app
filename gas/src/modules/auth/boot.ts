import { platform_ } from '@gas/core/platform';
import { signSessionToken_ } from '@gas/core/session';
import { loadUserContext_ } from '@gas/modules/access/context';
import type { BootData } from '@shared/rpc';
import { consumeLoginState_, createLoginUrl_, exchangeCodeForEmail_ } from './oauth';

/** Penanda berupa string di dalam skrip inline — komentar HTML dibuang HtmlService, string JS tidak. */
export const BOOT_MARKER = '__QC_BOOT__';

export function buildBootData_(params: Record<string, string | undefined>): BootData {
  const isCallback = Boolean(params.code || params.error);
  if (!isCallback) return { loginUrl: createLoginUrl_() };

  // state = <state-server>.<nonce-browser>; nonce mengikat callback ke browser yang memulai login.
  const [serverState, nonce] = (params.state ?? '').split('.');
  const stateOk = Boolean(nonce) && consumeLoginState_(serverState);
  if (!stateOk || params.error || !params.code) {
    return { authError: 'LOGIN_FAILED', loginUrl: createLoginUrl_() };
  }

  const result = exchangeCodeForEmail_(params.code);
  if (!result.ok) {
    platform_().logError(`Login gagal: ${result.reason}`);
    return { authError: 'LOGIN_FAILED', loginUrl: createLoginUrl_() };
  }
  if (!loadUserContext_(result.email)) {
    return { authError: 'NOT_WHITELISTED', email: result.email, loginUrl: createLoginUrl_() };
  }
  return { sessionToken: signSessionToken_(result.email), nonce, loginUrl: createLoginUrl_() };
}

const BACKSLASH = String.fromCharCode(92);

/** Aman disisipkan ke dalam <script>: tanpa '<' mentah dan tanpa pemisah baris Unicode. */
function escapeForScript_(json: string): string {
  return json
    .split('<')
    .join(`${BACKSLASH}u003c`)
    .split(String.fromCharCode(0x2028))
    .join(`${BACKSLASH}u2028`)
    .split(String.fromCharCode(0x2029))
    .join(`${BACKSLASH}u2029`);
}

export function injectBoot_(html: string, boot: BootData): string {
  const quotedMarkers = [`'${BOOT_MARKER}'`, `"${BOOT_MARKER}"`];
  const found = quotedMarkers.filter((marker) => html.includes(marker));
  const count = quotedMarkers.reduce((sum, marker) => sum + html.split(marker).length - 1, 0);
  if (count !== 1 || found.length !== 1 || !found[0]) {
    throw new Error(
      `Penanda BOOT (${BOOT_MARKER}) harus ada tepat satu kali di index.html, ditemukan ${count}`,
    );
  }
  // split/join (bukan String.replace) agar karakter '$' pada data tidak ditafsirkan sebagai pola.
  return html.split(found[0]).join(escapeForScript_(JSON.stringify(boot)));
}
