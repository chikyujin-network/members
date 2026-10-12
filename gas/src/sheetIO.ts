import { fiscalYearOf } from './domain/dates';
import { parseBranchSettings } from './domain/settingsParse';
import type { BranchSettings, DateString } from './domain/types';
import { SETTINGS, SETTINGS_INSURANCE, SETTINGS_MEMBERSHIP_TYPES, type SheetDef } from './schema';

/** スプレッドシートの読み書きで共通に使う関数 */

export function openSpreadsheet(): GoogleAppsScript.Spreadsheet.Spreadsheet {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('スクリプトプロパティ SPREADSHEET_ID が設定されていません');
  return SpreadsheetApp.openById(id);
}

/** 今日の日付（日本時間）を 'YYYY-MM-DD' で返す */
export function todayJst(): DateString {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
}

export function getSheet(ss: GoogleAppsScript.Spreadsheet.Spreadsheet, def: SheetDef): GoogleAppsScript.Spreadsheet.Sheet {
  const sheet = ss.getSheetByName(def.name);
  if (!sheet) throw new Error(`シート「${def.name}」がありません。先に setupSpreadsheet を実行してください`);
  return sheet;
}

/** 見出しを除いたデータ行を、そのまま配列で読む */
export function readRows(ss: GoogleAppsScript.Spreadsheet.Spreadsheet, def: SheetDef): unknown[][] {
  const sheet = getSheet(ss, def);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, def.columns.length).getValues();
}

/** データ行を、列のキーをもつオブジェクトとして読む（数値の列は数値、それ以外は文字列） */
export function readRecords(ss: GoogleAppsScript.Spreadsheet.Spreadsheet, def: SheetDef): Record<string, string | number>[] {
  return readRows(ss, def).map((r) => {
    const rec: Record<string, string | number> = {};
    def.columns.forEach((c, i) => {
      const v = r[i];
      rec[c.key] = c.numeric ? Number(v) || 0 : v instanceof Date ? Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd') : String(v ?? '').trim();
    });
    return rec;
  });
}

/** 設定シートから、今日が属する年度の支部設定を読む */
export function loadBranchSettings(ss: GoogleAppsScript.Spreadsheet.Spreadsheet, today: DateString): BranchSettings {
  const keyValues = readRows(ss, SETTINGS) as (string | number)[][];
  const startRow = keyValues.find((r) => String(r[0]).trim() === '年度の始まりの月');
  const startMonth = Number(startRow?.[1]) || 4;
  const fy = fiscalYearOf(today, startMonth);
  return parseBranchSettings(
    {
      keyValues,
      membershipTypes: readRows(ss, SETTINGS_MEMBERSHIP_TYPES) as (string | number)[][],
      insurance: readRows(ss, SETTINGS_INSURANCE) as (string | number)[][],
    },
    fy,
  );
}
