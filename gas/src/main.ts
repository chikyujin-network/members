/**
 * GAS Web アプリの入口。画面（web/）から JSON で呼ばれる。
 *
 * スクリプトプロパティ（プロジェクトの設定 → スクリプト プロパティ）:
 *   SPREADSHEET_ID     読み書きするスプレッドシートID
 *   GOOGLE_CLIENT_ID   「Googleでログイン」の OAuth クライアントID
 *   MAINTAINER_EMAILS  シートを直接編集できる保守担当（カンマ区切り）
 *   ALLOW_DUMMY        'true' のときだけダミーデータの関数が動く。本番では設定しない
 */

import { handleStaffAction, isStaffAction } from './api';
import { verifyStaff } from './auth';
export { setupSpreadsheet } from './setup';
export { refreshViews } from './views';
export { seedDummyData, clearDummyData } from './devtools';

type Json = Record<string, unknown>;

declare const __BUILD__: string;
/** ビルドした日時（UTC）。Web アプリの URL を開くと表示され、公開中のコードが最新か確かめられる */
const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';

function json(body: Json): GoogleAppsScript.Content.TextOutput {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

export function doGet(_e: GoogleAppsScript.Events.DoGet): GoogleAppsScript.Content.TextOutput {
  return json({ ok: true, action: 'ping', build: BUILD, time: new Date().toISOString() });
}

export function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  try {
    // ブラウザの事前確認（CORS プリフライト）を避けるため、画面からは Content-Type: text/plain で JSON を送る
    const body = JSON.parse(e.postData?.contents ?? '{}') as Json;
    const action = String(body.action ?? '');
    if (action === 'ping') return json({ ok: true, action: 'ping', build: BUILD, time: new Date().toISOString() });
    if (action === 'auth.whoami') {
      // ログインしたスタッフの名前と権限を返す（ログイン確認用）
      const auth = verifyStaff(body.idToken);
      return json(auth.ok ? { ok: true, email: auth.staff.email, name: auth.staff.name, role: auth.staff.role } : auth);
    }
    if (isStaffAction(action)) return json(handleStaffAction(action, body));
    return json({ ok: false, error: `unknown action: ${action}` });
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: String(err instanceof Error ? err.message : err) });
  }
}
