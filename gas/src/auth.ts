import { parseStaff, type StaffEntry } from './domain/settingsParse';
import { SETTINGS_STAFF } from './schema';

/**
 * 「Googleでログイン」で受け取った ID トークンを検証し、設定_スタッフに登録された人かを確かめる。
 *
 * スクリプトプロパティ:
 *   GOOGLE_CLIENT_ID  OAuth クライアントID（…apps.googleusercontent.com）
 *   SPREADSHEET_ID    設定_スタッフを読むスプレッドシート
 */

export type AuthResult = { ok: true; staff: StaffEntry } | { ok: false; error: string };

interface TokenInfo {
  aud?: string;
  iss?: string;
  email?: string;
  email_verified?: string | boolean;
  exp?: string;
}

export function verifyStaff(idToken: unknown): AuthResult {
  if (typeof idToken !== 'string' || idToken.length < 20) return { ok: false, error: 'ログインしてください' };
  const props = PropertiesService.getScriptProperties();
  const clientId = props.getProperty('GOOGLE_CLIENT_ID');
  if (!clientId) return { ok: false, error: 'GOOGLE_CLIENT_ID が設定されていません' };

  // Google のエンドポイントで署名と期限を検証してもらう
  const res = UrlFetchApp.fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    { muteHttpExceptions: true },
  );
  if (res.getResponseCode() !== 200) return { ok: false, error: 'ログインの有効期限が切れています。もう一度ログインしてください' };

  const info = JSON.parse(res.getContentText()) as TokenInfo;
  const issOk = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';
  const verified = info.email_verified === true || info.email_verified === 'true';
  if (info.aud !== clientId || !issOk || !verified || !info.email) {
    return { ok: false, error: 'ログイン情報を確認できませんでした' };
  }

  const id = props.getProperty('SPREADSHEET_ID');
  if (!id) return { ok: false, error: 'SPREADSHEET_ID が設定されていません' };
  const sheet = SpreadsheetApp.openById(id).getSheetByName(SETTINGS_STAFF.name);
  if (!sheet) return { ok: false, error: `${SETTINGS_STAFF.name} シートがありません` };
  const last = sheet.getLastRow();
  const rows = last > 1 ? sheet.getRange(2, 1, last - 1, SETTINGS_STAFF.columns.length).getValues() : [];
  const staff = parseStaff(rows).find((s) => s.email === info.email!.toLowerCase());
  if (!staff) return { ok: false, error: `${info.email} はスタッフとして登録されていません` };
  return { ok: true, staff };
}
