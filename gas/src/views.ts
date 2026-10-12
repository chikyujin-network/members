import { buildViews } from './domain/views';
import { CHARGES, MEMBERS, ALL_SHEETS } from './schema';
import { protectSheetRaw, readMaintainers } from './setup';
import { loadBranchSettings, openSpreadsheet, readRecords, todayJst } from './sheetIO';

/**
 * 名簿や会費状況などの「ビュー」シートを作り直す。
 * 元データ（会員・年度請求）から計算した値を書き込む（数式ではないので、そのまま Excel でダウンロードできる）。
 * Apps Script のエディタで関数「refreshViews」を実行する。今後、画面からの更新のあとや毎日の自動実行でも呼ぶ。
 */
export function refreshViews(): string {
  const ss = openSpreadsheet();
  const today = todayJst();
  const settings = loadBranchSettings(ss, today);
  const members = readRecords(ss, MEMBERS);
  const charges = readRecords(ss, CHARGES);
  const views = buildViews(members, charges, settings, today);
  const maintainers = readMaintainers();
  const log: string[] = [];

  views.forEach((v, i) => {
    let sheet = ss.getSheetByName(v.name);
    if (!sheet) sheet = ss.insertSheet(v.name, ALL_SHEETS.length + i);
    sheet.clear();
    sheet.clearNotes();
    const width = v.headers.length;
    const values = [v.headers, ...v.rows];
    // 番号や日付が勝手に変換されないよう、文字列の列は書式なしテキストにする
    sheet.getRange(1, 1, values.length, width).setNumberFormat('@');
    v.rows[0]?.forEach((cell, c) => {
      if (typeof cell === 'number') sheet!.getRange(2, c + 1, v.rows.length, 1).setNumberFormat('0');
    });
    sheet.getRange(1, 1, values.length, width).setValues(values);
    sheet.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#c5cbe7').setFontColor('#242c6c').setNote(v.description);
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, width);
    sheet.setTabColor('#5893d1');
    protectSheetRaw(sheet, `${v.name}：自動で作り直すビュー。直接編集しない`, maintainers);
    log.push(`${v.name}: ${v.rows.length}行`);
  });

  const summary = `ビューを更新しました（${today}）\n${log.join('\n')}`;
  console.log(summary);
  return summary;
}
