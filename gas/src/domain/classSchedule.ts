import { addDays, parseDate, weekdayOf } from './dates';
import type { DateString } from './types';

/**
 * 設定シートの「教室の日程」の1行。
 * 曜日や時間が変わったら、古い行に validTo を入れ、validFrom 付きの新しい行を足す。
 */
export interface ClassScheduleRule {
  weekday: number; // 0=日曜 … 6=土曜
  startTime: string; // 'HH:MM'
  endTime: string; // 'HH:MM'
  venue: string;
  validFrom: DateString;
  validTo?: DateString; // この日まで有効（この日を含む）。未設定なら無期限
}

/** 自動で作る教室イベント */
export interface ClassEvent {
  /** 同じ教室を二重に作らないためのキー。例: 'class-2026-10-13-1000' */
  eventKey: string;
  date: DateString;
  startTime: string;
  endTime: string;
  venue: string;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function validate(rule: ClassScheduleRule): void {
  if (!Number.isInteger(rule.weekday) || rule.weekday < 0 || rule.weekday > 6) {
    throw new Error(`曜日が正しくありません: ${rule.weekday}`);
  }
  if (!TIME_RE.test(rule.startTime) || !TIME_RE.test(rule.endTime) || rule.startTime >= rule.endTime) {
    throw new Error(`時刻が正しくありません: ${rule.startTime}〜${rule.endTime}`);
  }
  parseDate(rule.validFrom);
  if (rule.validTo) {
    parseDate(rule.validTo);
    if (rule.validTo < rule.validFrom) throw new Error(`適用期間が逆です: ${rule.validFrom}〜${rule.validTo}`);
  }
}

/**
 * from〜to（両端を含む）の教室イベントを作る。
 * 休講は、作られたイベントの側で「休講」にする（ここでは扱わない）。
 */
export function generateClassEvents(
  rules: readonly ClassScheduleRule[],
  from: DateString,
  to: DateString,
): ClassEvent[] {
  rules.forEach(validate);
  parseDate(from);
  parseDate(to);
  const events: ClassEvent[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const wd = weekdayOf(d);
    for (const r of rules) {
      if (r.weekday !== wd) continue;
      if (d < r.validFrom) continue;
      if (r.validTo && d > r.validTo) continue;
      events.push({
        eventKey: `class-${d}-${r.startTime.replace(':', '')}`,
        date: d,
        startTime: r.startTime,
        endTime: r.endTime,
        venue: r.venue,
      });
    }
  }
  return events.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
}
