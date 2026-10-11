import type { DateString } from './types';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' を年・月・日に分ける。形式が違えば例外 */
export function parseDate(d: DateString): { year: number; month: number; day: number } {
  const m = DATE_RE.exec(d);
  if (!m) throw new Error(`日付の形式が正しくありません: ${d}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new Error(`存在しない日付です: ${d}`);
  }
  return { year, month, day };
}

/** 年度を返す。年度の始まりの月が4なら、2027-03-31 は 2026 年度、2027-04-01 は 2027 年度 */
export function fiscalYearOf(d: DateString, startMonth: number): number {
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new Error(`年度の始まりの月が正しくありません: ${startMonth}`);
  }
  const { year, month } = parseDate(d);
  return month >= startMonth ? year : year - 1;
}

/** UTC の Date から 'YYYY-MM-DD' を作る */
export function toDateString(date: Date): DateString {
  return date.toISOString().slice(0, 10);
}

/** 日付に日数を足す */
export function addDays(d: DateString, days: number): DateString {
  const { year, month, day } = parseDate(d);
  return toDateString(new Date(Date.UTC(year, month - 1, day + days)));
}

/** 曜日（0=日曜 … 6=土曜） */
export function weekdayOf(d: DateString): number {
  const { year, month, day } = parseDate(d);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
