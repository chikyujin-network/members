/**
 * GAS Web アプリの入口。
 * 段階0（試作）では、疎通確認（ping）と、試作用シートへの1行追記だけを提供する。
 *
 * スクリプトプロパティ（プロジェクトの設定 → スクリプト プロパティ）:
 *   SPREADSHEET_ID  書き込み先のスプレッドシートID（テスト用のものだけを指定する）
 *   PROTO_ENABLED   'true' のときだけ試作用の書き込みを受け付ける。本番では設定しない
 *   GOOGLE_CLIENT_ID 「Googleでログイン」の OAuth クライアントID
 */

import { verifyStaff } from './auth';
export { setupSpreadsheet } from './setup';
export { refreshViews } from './views';
export { seedDummyData, clearDummyData } from './devtools';

type Json = Record<string, unknown>;

function json(body: Json): GoogleAppsScript.Content.TextOutput {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function prop(name: string): string | null {
  return PropertiesService.getScriptProperties().getProperty(name);
}

export function doGet(_e: GoogleAppsScript.Events.DoGet): GoogleAppsScript.Content.TextOutput {
  return json({ ok: true, action: 'ping', time: new Date().toISOString() });
}

export function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  try {
    // ブラウザの事前確認（CORS プリフライト）を避けるため、画面からは Content-Type: text/plain で JSON を送る
    const body = JSON.parse(e.postData?.contents ?? '{}') as Json;
    switch (body.action) {
      case 'ping':
        return json({ ok: true, action: 'ping', time: new Date().toISOString() });
      case 'proto.append':
        return json(protoAppend(String(body.text ?? '')));
      case 'auth.whoami': {
        // ログインしたスタッフの名前と権限を返す（ログイン確認用）
        const auth = verifyStaff(body.idToken);
        return json(auth.ok ? { ok: true, email: auth.staff.email, name: auth.staff.name, role: auth.staff.role } : auth);
      }
      default:
        return json({ ok: false, error: `unknown action: ${String(body.action)}` });
    }
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: String(err) });
  }
}

/** 試作用：読み取ったQRの内容を「proto」シートに1行追記する */
function protoAppend(text: string): Json {
  if (prop('PROTO_ENABLED') !== 'true') return { ok: false, error: 'proto is disabled' };
  const id = prop('SPREADSHEET_ID');
  if (!id) return { ok: false, error: 'SPREADSHEET_ID is not set' };
  if (text.length === 0 || text.length > 200) return { ok: false, error: 'invalid text' };

  const lock = LockService.getScriptLock();
  lock.waitLock(10_000);
  try {
    const ss = SpreadsheetApp.openById(id);
    const sheet = ss.getSheetByName('proto') ?? ss.insertSheet('proto');
    if (sheet.getLastRow() === 0) sheet.appendRow(['受信時刻', '読み取った内容']);
    sheet.appendRow([new Date(), text]);
    return { ok: true, row: sheet.getLastRow() };
  } finally {
    lock.releaseLock();
  }
}
