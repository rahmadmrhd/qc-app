import {
  assertScriptOwner_,
  installGasPlatform_,
  isScriptOwner_,
  loadIndexHtml_,
  renderErrorPage_,
  renderHtmlPage_,
} from '@gas/core/gas-platform';
import { platform_ } from '@gas/core/platform';
import { handleRpc_ } from '@gas/core/router';
import { buildBootData_, injectBoot_ } from '@gas/modules/auth/boot';
import { getRoutes_ } from '@gas/routes';
import { runSetup_ } from '@gas/setup';

export function doGet(e: GoogleAppsScript.Events.DoGet): GoogleAppsScript.HTML.HtmlOutput {
  installGasPlatform_();
  try {
    return renderHtmlPage_(injectBoot_(loadIndexHtml_(), buildBootData_(e.parameter ?? {})));
  } catch (error) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    platform_().logError(`doGet gagal: ${detail}`);
    return renderErrorPage_(
      'Aplikasi belum dapat dibuka. Hubungi admin.',
      isScriptOwner_() ? detail : undefined,
    );
  }
}

export function api(method: unknown, payloadJson: unknown, token: unknown): string {
  installGasPlatform_();
  return JSON.stringify(handleRpc_(method, payloadJson, token, getRoutes_()));
}

export function setup(): string {
  installGasPlatform_();
  assertScriptOwner_();
  const report = runSetup_();
  console.log(report);
  return report;
}
