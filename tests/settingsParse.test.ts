import { describe, expect, it } from 'vitest';
import { generateClassEvents } from '../gas/src/domain/classSchedule';
import { KOMAGANE_CLASS_SCHEDULE, KOMAGANE_SETTINGS } from '../gas/src/domain/presets';
import { parseBranchSettings, parseClassSchedule, parseStaff } from '../gas/src/domain/settingsParse';
import {
  SETTINGS,
  SETTINGS_CLASS_SCHEDULE,
  SETTINGS_INSURANCE,
  SETTINGS_MEMBERSHIP_TYPES,
  ALL_SHEETS,
} from '../gas/src/schema';

const seed = {
  keyValues: SETTINGS.seedRows!,
  membershipTypes: SETTINGS_MEMBERSHIP_TYPES.seedRows!,
  insurance: SETTINGS_INSURANCE.seedRows!,
};

describe('設定シートの読み込み', () => {
  it('初期データから、駒ヶ根の設定と同じものが作られる', () => {
    expect(parseBranchSettings(seed, 2026)).toEqual(KOMAGANE_SETTINGS);
  });

  it('金額が変わったら新しい年度の行が使われ、過去の年度は元の金額のまま', () => {
    const rows = {
      ...seed,
      membershipTypes: [...seed.membershipTypes, ['general', '一般', 600, 'いいえ', 2028]],
      insurance: [...seed.insurance, [2028, 500, 200]],
    };
    const s2027 = parseBranchSettings(rows, 2027);
    const s2028 = parseBranchSettings(rows, 2028);
    expect(s2027.membershipTypes.find((t) => t.id === 'general')?.feePerUnit).toBe(500);
    expect(s2028.membershipTypes.find((t) => t.id === 'general')?.feePerUnit).toBe(600);
    expect(s2028.membershipTypes.find((t) => t.id === 'supporting')?.feePerUnit).toBe(500);
    expect(s2028.insurance.subsidy).toBe(200);
  });

  it('免除の月が空欄なら免除なし', () => {
    const rows = {
      ...seed,
      keyValues: seed.keyValues.map((r) => (r[0] === '免除する入会月' ? [r[0], '', r[2]] : r)),
    };
    expect(parseBranchSettings(rows, 2026).exemptJoinMonths).toEqual([]);
  });

  it('適用開始年度より前の年度には会員種別がないので例外', () => {
    expect(() => parseBranchSettings(seed, 2025)).toThrow();
  });

  it('教室日程の初期データは、駒ヶ根の日程と同じ', () => {
    expect(parseClassSchedule(SETTINGS_CLASS_SCHEDULE.seedRows!)).toEqual(KOMAGANE_CLASS_SCHEDULE);
    expect(generateClassEvents(parseClassSchedule(SETTINGS_CLASS_SCHEDULE.seedRows!), '2026-10-12', '2026-10-18')).toHaveLength(3);
  });

  it('シートが時刻を「10:00:00」の形にしていても読める', () => {
    const rules = parseClassSchedule([['火', '10:00:00', '11:30:00', 'A', '2026-04-01', '']]);
    expect(rules[0]).toMatchObject({ startTime: '10:00', endTime: '11:30' });
  });

  it('スタッフは「有効」の人だけ。メールは小文字に揃える', () => {
    const staff = parseStaff([
      ['Staff.A@example.com', '受付A', '受付', 'はい'],
      ['b@example.com', '運営B', '運営', 'いいえ'],
    ]);
    expect(staff).toEqual([{ email: 'staff.a@example.com', name: '受付A', role: '受付' }]);
  });
});

describe('シート定義', () => {
  it('シート名と列のキーが重複していない', () => {
    const names = ALL_SHEETS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const s of ALL_SHEETS) {
      const keys = s.columns.map((c) => c.key);
      expect(new Set(keys).size, s.name).toBe(keys.length);
      for (const row of s.seedRows ?? []) expect(row.length, s.name).toBe(s.columns.length);
    }
  });
});
