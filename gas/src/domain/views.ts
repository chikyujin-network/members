import { countryNameJa } from './countries';
import { fiscalYearOf } from './dates';
import type { BranchSettings, DateString } from './types';

/**
 * 人が見るための「ビュー」シートの中身を、元データ（会員・年度請求）から作る。
 * GAS に依存しないので、単体テストできる。シートへの書き込みは GAS 側（views.ts）で行う。
 *
 * ビューは元データから毎回作り直す。直接編集しても次の更新で消えるので、編集は画面から行う。
 * ビューの値は計算済みの値（数式ではない）なので、そのまま Excel でダウンロードできる。
 */

export type Row = Readonly<Record<string, string | number>>;
export type Cell = string | number;

export interface ViewTable {
  name: string;
  headers: string[];
  rows: Cell[][];
  /** シートの上に表示する説明（1行目の上ではなく、シートのメモに付ける） */
  description: string;
}

const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const byKana = (a: Row, b: Row) =>
  s(a.kana).localeCompare(s(b.kana), 'ja') || s(a.memberNo).localeCompare(s(b.memberNo));

function rosterRow(m: Row): Cell[] {
  return [
    s(m.memberNo),
    s(m.legalName),
    s(m.kana),
    s(m.nickname),
    s(m.membershipType),
    s(m.roles),
    s(m.municipality),
    s(m.mobile),
    s(m.activityStatus),
    s(m.joinDate),
  ];
}
const ROSTER_HEADERS = ['会員番号', '登録名', 'よみ', 'ニックネーム', '会員種別', '役割', '市町村', '携帯電話', '活動状態', '入会日'];

/** 名簿に載せる会員（退会した人は載せない） */
const current = (m: Row) => s(m.status) !== '退会';
const active = (m: Row) => current(m) && s(m.activityStatus) === '活動中';

export function buildViews(
  members: readonly Row[],
  charges: readonly Row[],
  settings: BranchSettings,
  today: DateString,
): ViewTable[] {
  const fy = fiscalYearOf(today, settings.fiscalYearStartMonth);
  const memberByNo = new Map(members.map((m) => [s(m.memberNo), m]));

  // 1. 日本人の名簿（50音順・活動中）
  const japanese: ViewTable = {
    name: '名簿（日本人・50音順）',
    headers: ROSTER_HEADERS,
    rows: members.filter((m) => active(m) && s(m.country).toUpperCase() === 'JP').sort(byKana).map(rosterRow),
    description: '活動中の日本人会員を、よみの50音順に並べたもの。自動で作り直すので、直接編集しないでください。',
  };

  // 2. 外国人の名簿（国別・活動中）
  const foreign: ViewTable = {
    name: '名簿（外国人・国別）',
    headers: ['国・地域', ...ROSTER_HEADERS],
    rows: members
      .filter((m) => active(m) && s(m.country).toUpperCase() !== 'JP')
      .sort((a, b) => countryNameJa(s(a.country)).localeCompare(countryNameJa(s(b.country)), 'ja') || byKana(a, b))
      .map((m) => [countryNameJa(s(m.country)), ...rosterRow(m)]),
    description: '活動中の外国人会員を、国ごと・よみの50音順に並べたもの。自動で作り直すので、直接編集しないでください。',
  };

  // 3. 全員の名簿（休眠・退会も含む。Excel での提出や確認用）
  const all: ViewTable = {
    name: '名簿（全員）',
    headers: ['登録状態', '国・地域', ...ROSTER_HEADERS],
    rows: [...members]
      .sort((a, b) => s(a.memberNo).localeCompare(s(b.memberNo)))
      .map((m) => [s(m.status), countryNameJa(s(m.country)), ...rosterRow(m)]),
    description: '休眠・退会を含む全員を、会員番号順に並べたもの。自動で作り直すので、直接編集しないでください。',
  };

  // 4. 今年度の会費・保険の状況
  const fyCharges = charges.filter((c) => Number(c.fiscalYear) === fy);
  const membership = new Map(fyCharges.filter((c) => s(c.kind) === '会費').map((c) => [s(c.memberNo), c]));
  const insurance = new Map(fyCharges.filter((c) => s(c.kind) === '保険料').map((c) => [s(c.memberNo), c]));
  const fees: ViewTable = {
    name: `会費・保険（${fy}年度）`,
    headers: ['会員番号', '登録名', 'ニックネーム', '会員種別', '会費', '金額', '口数', '受領日', '受領者', '会計への引渡日', '保険', '保険の受領日'],
    rows: members
      .filter((m) => current(m) && (active(m) || membership.has(s(m.memberNo)) || insurance.has(s(m.memberNo))))
      .sort((a, b) => s(a.memberNo).localeCompare(s(b.memberNo)))
      .map((m) => {
        const c = membership.get(s(m.memberNo));
        const i = insurance.get(s(m.memberNo));
        return [
          s(m.memberNo),
          s(m.legalName),
          s(m.nickname),
          s(m.membershipType),
          c ? s(c.status) : '未',
          c ? Number(c.amount) || 0 : '',
          c ? Number(c.units) || 1 : '',
          c ? s(c.receivedDate) : '',
          c ? s(c.receivedBy) : '',
          c ? s(c.handedToTreasurerDate) : '',
          i ? '加入' : '',
          i ? s(i.receivedDate) : '',
        ];
      }),
    description: `${fy}年度（${settings.fiscalYearStartMonth}月始まり）の会費と保険の状況。「未」はまだ受け取っていない人（今年度に参加していなければ請求しない）。`,
  };

  // 5. 今年度の保険の名簿（総額と内訳。提出用の金額は、市内＝本人負担額、市外＝総額）
  const ins = settings.insurance;
  const insuranceList: ViewTable = {
    name: `保険名簿（${fy}年度）`,
    headers: ['NO', '申込日', '会員番号', '登録名', '出身国', '居住地', '保険料（総額）', '本人負担額', '補填額', '補填元', '提出用の金額'],
    rows: fyCharges
      .filter((c) => s(c.kind) === '保険料')
      .sort((a, b) => s(a.receivedDate).localeCompare(s(b.receivedDate)) || s(a.memberNo).localeCompare(s(b.memberNo)))
      .map((c, idx) => {
        const m = memberByNo.get(s(c.memberNo));
        const amount = Number(c.amount) || 0;
        const selfPay = Number(c.selfPay) || 0;
        return [
          idx + 1,
          s(c.receivedDate),
          s(c.memberNo),
          m ? s(m.legalName) : '',
          m ? countryNameJa(s(m.country)) : '',
          m ? s(m.municipality) : '',
          amount,
          selfPay,
          Number(c.subsidy) || 0,
          s(c.subsidySource),
          s(c.subsidySource) === ins.subsidyMunicipality ? selfPay : amount,
        ];
      }),
    description: `${fy}年度のボランティア保険の加入者。保険料は総額と内訳で表示。「提出用の金額」は、補填元が${ins.subsidyMunicipality || '自治体'}なら本人負担額、それ以外は総額（提出書式の指定は運営に確認中）。`,
  };

  return [japanese, foreign, all, fees, insuranceList];
}
