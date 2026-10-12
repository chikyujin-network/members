import { generateDummyData, isDummyMemberNo } from './domain/dummy';
import { getSheet, loadBranchSettings, openSpreadsheet, todayJst } from './sheetIO';
import { ATTENDANCE, CHARGES, MEMBERS, columnIndex, type SheetDef } from './schema';

/**
 * 開発・テスト用の道具。テスト用のスプレッドシートでだけ使う。
 * 本番で誤って実行しないよう、スクリプトプロパティ ALLOW_DUMMY が 'true' のときだけ動く。
 */

function requireAllowDummy(): void {
  if (PropertiesService.getScriptProperties().getProperty('ALLOW_DUMMY') !== 'true') {
    throw new Error('ダミーデータの操作は許可されていません。テスト用のスプレッドシートで、スクリプトプロパティ ALLOW_DUMMY を true にしてください');
  }
}

/** 会員番号の列を読み、ダミーの行の行番号（1始まり・昇順）を返す */
function dummyRowNumbers(sheet: GoogleAppsScript.Spreadsheet.Sheet, def: SheetDef): number[] {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const col = columnIndex(def, 'memberNo');
  const values = sheet.getRange(2, col, last - 1, 1).getValues();
  const rows: number[] = [];
  values.forEach((v, i) => {
    if (isDummyMemberNo(String(v[0]))) rows.push(i + 2);
  });
  return rows;
}

/** 連続した行をまとめて、下から順に削除する（行番号がずれないように） */
function deleteRowsBottomUp(sheet: GoogleAppsScript.Spreadsheet.Sheet, rows: readonly number[]): void {
  const blocks: { start: number; count: number }[] = [];
  for (const r of rows) {
    const b = blocks[blocks.length - 1];
    if (b && b.start + b.count === r) b.count++;
    else blocks.push({ start: r, count: 1 });
  }
  for (let i = blocks.length - 1; i >= 0; i--) sheet.deleteRows(blocks[i].start, blocks[i].count);
}

/**
 * ダミーの会員と年度請求をテスト用シートの末尾に足す。
 * 会員番号は 001-90000 から。clearDummyData で消せる。
 */
export function seedDummyData(count = 60): string {
  requireAllowDummy();
  const ss = openSpreadsheet();
  const members = getSheet(ss, MEMBERS);
  const charges = getSheet(ss, CHARGES);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (dummyRowNumbers(members, MEMBERS).length > 0) {
      throw new Error('ダミーデータがすでにあります。先に clearDummyData を実行してください');
    }
    const today = todayJst();
    const settings = loadBranchSettings(ss, today);
    const data = generateDummyData({ count, seed: 20261012, today, settings });

    const memberRows = data.members.map((m) => MEMBERS.columns.map((c) => m[c.key]));
    const chargeRows = data.charges.map((c) => CHARGES.columns.map((col) => c[col.key]));
    if (memberRows.length > 0) {
      members.getRange(members.getLastRow() + 1, 1, memberRows.length, MEMBERS.columns.length).setValues(memberRows);
    }
    if (chargeRows.length > 0) {
      charges.getRange(charges.getLastRow() + 1, 1, chargeRows.length, CHARGES.columns.length).setValues(chargeRows);
    }
    SpreadsheetApp.flush();

    const summary = `ダミーデータを追加: 会員${memberRows.length}人、年度請求${chargeRows.length}行`;
    console.log(summary);
    return summary;
  } finally {
    lock.releaseLock();
  }
}

/** ダミーの会員と、その年度請求・出席の行を消す（会員番号の連番が 90000 以上の行） */
export function clearDummyData(): string {
  requireAllowDummy();
  const ss = openSpreadsheet();
  const targets: { def: SheetDef; label: string }[] = [
    { def: MEMBERS, label: '会員' },
    { def: CHARGES, label: '年度請求' },
    { def: ATTENDANCE, label: '出席' },
  ];

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const parts: string[] = [];
    for (const { def, label } of targets) {
      const sheet = getSheet(ss, def);
      const rows = dummyRowNumbers(sheet, def);
      deleteRowsBottomUp(sheet, rows);
      parts.push(`${label}${rows.length}行`);
    }
    SpreadsheetApp.flush();
    const summary = `ダミーデータを削除: ${parts.join('、')}`;
    console.log(summary);
    return summary;
  } finally {
    lock.releaseLock();
  }
}
