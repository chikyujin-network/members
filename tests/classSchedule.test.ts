import { describe, expect, it } from 'vitest';
import { generateClassEvents, type ClassScheduleRule } from '../gas/src/domain/classSchedule';
import { KOMAGANE_CLASS_SCHEDULE } from '../gas/src/domain/presets';

describe('日本語教室の自動生成', () => {
  it('1週間で火・水・土の3回', () => {
    // 2026-10-12 は月曜
    const events = generateClassEvents(KOMAGANE_CLASS_SCHEDULE, '2026-10-12', '2026-10-18');
    expect(events.map((e) => `${e.date} ${e.startTime}`)).toEqual([
      '2026-10-13 10:00',
      '2026-10-14 19:00',
      '2026-10-17 10:00',
    ]);
    expect(events[0].eventKey).toBe('class-2026-10-13-1000');
  });

  it('曜日が変わったら、適用開始日から新しい曜日で作る（過去の分は変わらない）', () => {
    const rules: ClassScheduleRule[] = [
      { weekday: 3, startTime: '19:00', endTime: '20:30', venue: 'A', validFrom: '2026-04-01', validTo: '2026-10-31' },
      { weekday: 4, startTime: '19:00', endTime: '20:30', venue: 'A', validFrom: '2026-11-01' },
    ];
    const events = generateClassEvents(rules, '2026-10-26', '2026-11-08');
    expect(events.map((e) => e.date)).toEqual(['2026-10-28', '2026-11-05']);
  });

  it('時刻や期間がおかしい行は例外', () => {
    const bad: ClassScheduleRule[] = [
      { weekday: 2, startTime: '11:30', endTime: '10:00', venue: 'A', validFrom: '2026-04-01' },
    ];
    expect(() => generateClassEvents(bad, '2026-10-12', '2026-10-18')).toThrow();
  });
});
