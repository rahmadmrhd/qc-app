import { bridgeDeniedJson_, handleBridge_ } from './dispatch';
import { installGasBridgePlatform_ } from './gas-platform';

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
