import { bridgeDeniedJson_, handleBridge_ } from './dispatch';
import { assertBridgeOwner_, installGasBridgePlatform_ } from './gas-platform';
import { runBridgeSetup_ } from './setup';

function jsonOutput_(json: string): GoogleAppsScript.Content.TextOutput {
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

/** Satu-satunya pintu masuk jembatan: badan `{ action, ts, sig, payload }` bertanda tangan HMAC. */
export function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  installGasBridgePlatform_();
  return jsonOutput_(handleBridge_(e?.postData?.contents));
}

/** GET tidak melayani apa pun dan tidak membocorkan apa pun. */
export function doGet(): GoogleAppsScript.Content.TextOutput {
  return jsonOutput_(bridgeDeniedJson_());
}

/**
 * Laporan konfigurasi (tanpa rahasia) untuk pemilik: jalankan dari editor setelah mengisi Script properties.
 * Bukan titik masuk web app (doPost/doGet tidak memanggilnya) dan menolak pemanggil selain pemilik.
 */
export function setup(): string {
  assertBridgeOwner_();
  installGasBridgePlatform_();
  const report = runBridgeSetup_();
  console.log(report);
  return report;
}
