import {
  assertScriptOwner_,
  installGasPlatform_,
  isScriptOwner_,
  loadIndexHtml_,
  renderErrorPage_,
  renderHtmlPage_,
  renderJsonOutput_,
} from '@gas/core/gas-platform';
import { platform_, withRequestCache_ } from '@gas/core/platform';
import { handleRpc_, handleRpcBatch_ } from '@gas/core/router';
import { buildBootData_, injectBoot_ } from '@gas/modules/auth/boot';
import { cleanupQrDocuments_ } from '@gas/modules/qrcode/service';
import { handleSync_ } from '@gas/modules/sync/handler';
import { getSyncRoutes_ } from '@gas/modules/sync/routes';
import { getRoutes_ } from '@gas/routes';
import { runSetup_ } from '@gas/setup';

export function doGet(e: GoogleAppsScript.Events.DoGet): GoogleAppsScript.HTML.HtmlOutput {
  installGasPlatform_();
  try {
    return renderHtmlPage_(
      injectBoot_(
        loadIndexHtml_(),
        withRequestCache_(() => buildBootData_(e.parameter ?? {})),
      ),
    );
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
  if (method === 'batch') return JSON.stringify(handleRpcBatch_(payloadJson, token, getRoutes_()));
  return JSON.stringify(handleRpc_(method, payloadJson, token, getRoutes_()));
}

/** Endpoint sinkronisasi QC Desktop (docs/api/desktop-sync.md). Jalur terpisah dari `api` (RPC sesi web). */
export function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  installGasPlatform_();
  return renderJsonOutput_(JSON.stringify(handleSync_(e?.postData?.contents, getSyncRoutes_())));
}

/**
 * Pembersihan PDF sumber QR yang tidak terpakai (mencabut berbagi publik unggahan yatim setelah masa tenggang).
 * Dipasang sebagai trigger berbasis waktu di editor Apps Script (disarankan tiap jam); lihat docs/setup-google.md.
 */
export function cleanupQrPdfs(): string {
  installGasPlatform_();
  assertScriptOwner_();
  const revoked = cleanupQrDocuments_();
  console.log(`cleanupQrPdfs: ${revoked} PDF dicabut berbaginya`);
  return `${revoked}`;
}

export function setup(): string {
  installGasPlatform_();
  assertScriptOwner_();
  const report = runSetup_();
  console.log(report);
  return report;
}
