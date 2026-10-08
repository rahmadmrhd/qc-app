import { platform_ } from '@gas/core/platform';
import { signSessionToken_ } from '@gas/core/session';
import { loadUserContext_ } from '@gas/modules/access/context';
import type { BootData } from '@shared/rpc';
import { consumeLoginState_, createLoginUrl_, exchangeCodeForEmail_ } from './oauth';

export const BOOT_PLACEHOLDER = '<!--BOOT-->';

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

export function injectBoot_(html: string, boot: BootData): string {
  const parts = html.split(BOOT_PLACEHOLDER);
  if (parts.length !== 2) {
    throw new Error(`Placeholder ${BOOT_PLACEHOLDER} harus ada tepat satu kali di index.html`);
  }
  const json = JSON.stringify(boot)
    .replace(/</g, '\\u003c')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
  return `${parts[0]}<script>window.__BOOT__=${json};</script>${parts[1]}`;
}
