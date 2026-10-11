import type { ClassScheduleRule } from './classSchedule';
import type { BranchSettings, MembershipTypeSetting } from './types';

/**
 * 設定シートの行（見出しを除いた値の配列）から、指定した年度の BranchSettings を作る。
 * GAS に依存しないので、単体テストできる。
 */

type Cell = string | number | boolean | Date | null | undefined;
type Row = readonly Cell[];

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function str(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

function num(v: Cell, what: string): number {
  const n = typeof v === 'number' ? v : Number(str(v));
  if (!Number.isFinite(n)) throw new Error(`${what} が数値ではありません: ${str(v)}`);
  return n;
}

function yes(v: Cell): boolean {
  const s = str(v);
  return s === 'はい' || s.toLowerCase() === 'true';
}

/** 'HH:MM' に揃える（シートが時刻型に変えてしまった場合にも対応） */
export function normalizeTime(v: Cell): string {
  if (v instanceof Date) {
    return `${String(v.getHours()).padStart(2, '0')}:${String(v.getMinutes()).padStart(2, '0')}`;
  }
  const m = /^(\d{1,2}):(\d{2})/.exec(str(v));
  if (!m) throw new Error(`時刻の形式が正しくありません: ${str(v)}`);
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

/** 'YYYY-MM-DD' に揃える（シートが日付型に変えてしまった場合にも対応） */
export function normalizeDate(v: Cell): string {
  if (v instanceof Date) {
    const y = v.getFullYear();
    const mo = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  const s = str(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`日付の形式が正しくありません: ${s}`);
  return s;
}

export interface SettingsRows {
  keyValues: readonly Row[]; // 設定: [項目, 値, 説明]
  membershipTypes: readonly Row[]; // 設定_会員種別: [種別ID, 名称, 1口の会費, 複数口, 適用開始年度]
  insurance: readonly Row[]; // 設定_保険: [適用開始年度, 保険料, 補填額]
}

function keyValueMap(rows: readonly Row[]): Map<string, Cell> {
  const map = new Map<string, Cell>();
  for (const r of rows) if (str(r[0])) map.set(str(r[0]), r[1]);
  return map;
}

/** 適用開始年度が fiscalYear 以下の行のうち、最も新しいものを選ぶ */
function latestFor<T extends { fromFiscalYear: number }>(items: T[], fiscalYear: number): T | undefined {
  return items
    .filter((i) => i.fromFiscalYear <= fiscalYear)
    .sort((a, b) => b.fromFiscalYear - a.fromFiscalYear)[0];
}

export function parseBranchSettings(rows: SettingsRows, fiscalYear: number): BranchSettings {
  const kv = keyValueMap(rows.keyValues);
  const need = (k: string): Cell => {
    if (!kv.has(k)) throw new Error(`設定シートに「${k}」がありません`);
    return kv.get(k);
  };

  const branchCode = str(need('支部番号')).padStart(3, '0');
  if (!/^\d{3}$/.test(branchCode)) throw new Error(`支部番号は3桁の数字です: ${branchCode}`);

  const exemptRaw = str(kv.get('免除する入会月'));
  const exemptJoinMonths = exemptRaw
    ? exemptRaw.split(/[,、\s]+/).filter(Boolean).map((m) => num(m, '免除する入会月'))
    : [];

  // 種別IDごとに、その年度に有効な行を選ぶ
  const allTypes = rows.membershipTypes
    .filter((r) => str(r[0]))
    .map((r) => ({
      id: str(r[0]),
      label: str(r[1]),
      feePerUnit: num(r[2], '1口の会費'),
      allowMultipleUnits: yes(r[3]),
      fromFiscalYear: num(r[4], '適用開始年度'),
    }));
  const ids = [...new Set(allTypes.map((t) => t.id))];
  const membershipTypes: MembershipTypeSetting[] = ids
    .map((id) => latestFor(allTypes.filter((t) => t.id === id), fiscalYear))
    .filter((t): t is NonNullable<typeof t> => t !== undefined)
    .map(({ fromFiscalYear: _f, ...t }) => t);
  if (membershipTypes.length === 0) throw new Error(`${fiscalYear}年度に有効な会員種別がありません`);

  const insuranceEnabled = yes(kv.get('保険を扱う'));
  const ins = latestFor(
    rows.insurance
      .filter((r) => str(r[0]))
      .map((r) => ({ fromFiscalYear: num(r[0], '適用開始年度'), premium: num(r[1], '保険料'), subsidy: num(r[2], '補填額') })),
    fiscalYear,
  );
  if (insuranceEnabled && !ins) throw new Error(`${fiscalYear}年度に有効な保険の設定がありません`);

  return {
    branchCode,
    fiscalYearStartMonth: num(need('年度の始まりの月'), '年度の始まりの月'),
    exemptJoinMonths,
    membershipTypes,
    insurance: {
      enabled: insuranceEnabled,
      premium: ins?.premium ?? 0,
      subsidy: ins?.subsidy ?? 0,
      subsidyMunicipality: str(kv.get('補填する自治体')),
      fallbackSubsidySource: str(kv.get('補填元（それ以外）')),
    },
  };
}

/** 設定_教室日程: [曜日, 開始, 終了, 会場, 適用開始日, 適用終了日] */
export function parseClassSchedule(rows: readonly Row[]): ClassScheduleRule[] {
  return rows
    .filter((r) => str(r[0]))
    .map((r) => {
      const weekday = WEEKDAYS.indexOf(str(r[0]));
      if (weekday < 0) throw new Error(`曜日が正しくありません: ${str(r[0])}`);
      const validTo = str(r[5]) ? normalizeDate(r[5]) : undefined;
      return {
        weekday,
        startTime: normalizeTime(r[1]),
        endTime: normalizeTime(r[2]),
        venue: str(r[3]),
        validFrom: normalizeDate(r[4]),
        ...(validTo ? { validTo } : {}),
      };
    });
}

export interface StaffEntry {
  email: string;
  name: string;
  role: '運営' | '受付';
}

/** 設定_スタッフ: [メール, 名前, 権限, 有効]。有効な人だけ返す */
export function parseStaff(rows: readonly Row[]): StaffEntry[] {
  return rows
    .filter((r) => str(r[0]) && yes(r[3]))
    .map((r) => {
      const role = str(r[2]);
      if (role !== '運営' && role !== '受付') throw new Error(`権限が正しくありません: ${role}`);
      return { email: str(r[0]).toLowerCase(), name: str(r[1]), role };
    });
}
