// AniRetake スプレッドシート共有：通信の確認用スクリプト（開発用・本番では使いません）
// 使い方は同じフォルダの README.md を見てください。
// 下の KEY を好きな文字に変えてから「デプロイ」してください。
const KEY = "test-aikotoba";

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// GET：接続テスト（?key=…）
function doGet(e) {
  if ((e.parameter.key || "") !== KEY) return json_({ ok: false, error: "合言葉が違います" });
  return json_({ ok: true, method: "GET", sheet: SpreadsheetApp.getActive().getName(), time: new Date().toISOString() });
}

// POST：「probe」タブに1行書き込む（本文は JSON の文字列）
function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: "本文が JSON ではありません" });
  }
  if ((body.key || "") !== KEY) return json_({ ok: false, error: "合言葉が違います" });
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActive();
    const sh = ss.getSheetByName("probe") || ss.insertSheet("probe");
    if (sh.getLastRow() === 0) sh.appendRow(["日時", "開き方", "メッセージ"]);
    sh.appendRow([new Date(), String(body.from || ""), String(body.message || "")]);
    return json_({ ok: true, method: "POST", rows: sh.getLastRow() });
  } finally {
    lock.releaseLock();
  }
}
