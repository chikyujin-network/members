import { ALL_SHEETS, type SheetDef } from './schema';

/**
 * スプレッドシートに、決められたシートと見出しを作る。
 * 何度実行しても安全（すでにあるシートやデータは消さない）。
 * Apps Script のエディタで関数「setupSpreadsheet」を選んで実行する。
 */
export function setupSpreadsheet(): string {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('スクリプトプロパティ SPREADSHEET_ID が設定されていません');
  const ss = SpreadsheetApp.openById(id);
  const log: string[] = [];

  ALL_SHEETS.forEach((def, i) => {
    let sheet = ss.getSheetByName(def.name);
    if (!sheet) {
      sheet = ss.insertSheet(def.name, i);
      log.push(`作成: ${def.name}`);
    }
    ensureHeader(sheet, def, log);
    applyFormat(sheet, def);
    seedIfEmpty(sheet, def, log);
  });

  const summary = log.length ? log.join('\n') : '変更なし（すでに最新の構成です）';
  console.log(summary);
  return summary;
}

function ensureHeader(sheet: GoogleAppsScript.Spreadsheet.Sheet, def: SheetDef, log: string[]): void {
  const headers = def.columns.map((c) => c.header);
  const lastCol = sheet.getLastColumn();
  const current = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];

  // 既存の見出しが定義と食い違っていたら、データを壊さないよう止める
  for (let i = 0; i < Math.min(current.length, headers.length); i++) {
    if (current[i] && current[i] !== headers[i]) {
      throw new Error(`${def.name} の${i + 1}列目の見出しが「${current[i]}」になっています（定義は「${headers[i]}」）。手で直してから再実行してください`);
    }
  }
  if (current.length < headers.length || current.some((h, i) => !h && headers[i])) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    log.push(`見出し: ${def.name}`);
  }
}

function applyFormat(sheet: GoogleAppsScript.Spreadsheet.Sheet, def: SheetDef): void {
  const n = def.columns.length;
  const header = sheet.getRange(1, 1, 1, n);
  header.setFontWeight('bold').setBackground('#c5cbe7').setFontColor('#242c6c');
  sheet.setFrozenRows(1);
  // 日付・時刻・番号が勝手に変換されないよう、数値の列以外は書式なしテキストにする
  const rows = Math.max(sheet.getMaxRows() - 1, 1);
  def.columns.forEach((c, i) => {
    sheet.getRange(2, i + 1, rows, 1).setNumberFormat(c.numeric ? '0' : '@');
  });

  def.columns.forEach((c, i) => {
    const col = i + 1;
    if (c.width) sheet.setColumnWidth(col, c.width);
    if (c.note) sheet.getRange(1, col).setNote(c.note);
    if (c.options) {
      const rule = SpreadsheetApp.newDataValidation().requireValueInList([...c.options], true).setAllowInvalid(false).build();
      sheet.getRange(2, col, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);
    }
  });
}

function seedIfEmpty(sheet: GoogleAppsScript.Spreadsheet.Sheet, def: SheetDef, log: string[]): void {
  if (!def.seedRows || def.seedRows.length === 0) return;
  if (sheet.getLastRow() > 1) return;
  const values = def.seedRows.map((r) => r.map((v, i) => (def.columns[i].numeric ? v : String(v))));
  sheet.getRange(2, 1, values.length, def.columns.length).setValues(values);
  log.push(`初期データ: ${def.name}（${values.length}行）`);
}
