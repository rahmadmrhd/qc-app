// Spike Task 0.2 — sekali pakai, BUKAN bridge/ final.
function doPost(e) {
  var body = e && e.postData ? e.postData.contents : '';
  return ContentService.createTextOutput(
    JSON.stringify({ ok: true, len: body.length, ts: Date.now(), pad: new Array((Number(e.parameter && e.parameter.respond) || 0) + 1).join("A") })
  ).setMimeType(ContentService.MimeType.JSON);
}
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, get: true, ts: Date.now() }))
    .setMimeType(ContentService.MimeType.JSON);
}
