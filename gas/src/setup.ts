import { ALL_SHEETS, type SheetDef } from './schema';

/**
 * スプレッドシートに、決められたシートと見出しを作り、シートを保護する。
 * 何度実行しても安全（すでにあるシートやデータは消さない）。
 * Apps Script のエディタで関数「setupSpreadsheet」を選んで実行する（スプレッドシートの持ち主＝団体用アカウントで）。
 *
 * 保護：すべてのシートを、持ち主とスクリプトプロパティ MAINTAINER_EMAILS（カンマ区切り）の人だけが
 * 直接編集できるようにする。運営スタッフには「閲覧者」として共有し、変更は画面から行う。
 * 画面からの書き込みは GAS が持ち主の権限で行うので、保護されていても書き込める。
 */
export function setupSpreadsheet(): string {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('スクリプトプロパティ SPREADSHEET_ID が設定されていません');
  const ss = SpreadsheetApp.openById(id);
  const log: string[] = [];
  const maintainers = readMaintainers();

  ALL_SHEETS.forEach((def, i) => {
    let sheet = ss.getSheetByName(def.name);
    if (!sheet) {
      sheet = ss.insertSheet(def.name, i);
      log.push(`作成: ${def.name}`);
    }
    ensureHeader(sheet, def, log);
    applyFormat(sheet, def);
    seedIfEmpty(sheet, def, log);
    protectSheet(sheet, def, maintainers);
  });
  log.push(`保護: 全シート（直接編集できるのは持ち主${maintainers.length ? `と ${maintainers.join(', ')}` : 'だけ'}）`);

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

/** スクリプトプロパティ MAINTAINER_EMAILS（カンマ区切り）を読む */
export function readMaintainers(): string[] {
  return (PropertiesService.getScriptProperties().getProperty('MAINTAINER_EMAILS') ?? '')
    .split(/[,\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function protectSheet(sheet: GoogleAppsScript.Spreadsheet.Sheet, def: SheetDef, maintainers: string[]): void {
  protectSheetRaw(sheet, `${def.name}：画面からだけ更新する。直接編集できるのは保守担当だけ`, maintainers);
}

/** シート全体を保護し、直接編集できる人を持ち主と保守担当だけにする */
export function protectSheetRaw(sheet: GoogleAppsScript.Spreadsheet.Sheet, description: string, maintainers: string[]): void {
  const protection = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET)[0] ?? sheet.protect();
  protection.setDescription(description);
  protection.setWarningOnly(false);
  const others = protection.getEditors().filter((u) => !maintainers.includes(u.getEmail().toLowerCase()));
  if (others.length) protection.removeEditors(others);
  if (maintainers.length) protection.addEditors(maintainers);
  if (protection.canDomainEdit()) protection.setDomainEdit(false);
}
