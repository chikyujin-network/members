import type { ClassScheduleRule } from './classSchedule';
import type { BranchSettings } from './types';

/**
 * 駒ヶ根支部（001）の初期設定。
 * 本番では設定シートから読み込む。ここはテストと初期データ作成のための値。
 */
export const KOMAGANE_SETTINGS: BranchSettings = {
  branchCode: '001',
  fiscalYearStartMonth: 4,
  exemptJoinMonths: [1, 2, 3],
  membershipTypes: [
    { id: 'general', label: '一般', feePerUnit: 500, allowMultipleUnits: false },
    { id: 'supporting', label: '賛助', feePerUnit: 500, allowMultipleUnits: true },
  ],
  insurance: {
    enabled: true,
    premium: 500,
    subsidy: 170,
    subsidyMunicipality: '駒ヶ根市',
    fallbackSubsidySource: 'ちきゅうじん',
  },
};

/** 駒ヶ根支部の日本語教室の日程（パンフレットより） */
export const KOMAGANE_CLASS_SCHEDULE: ClassScheduleRule[] = [
  { weekday: 2, startTime: '10:00', endTime: '11:30', venue: 'ふれあいセンター', validFrom: '2026-04-01' },
  { weekday: 3, startTime: '19:00', endTime: '20:30', venue: 'ふれあいセンター', validFrom: '2026-04-01' },
  { weekday: 6, startTime: '10:00', endTime: '11:30', venue: 'ふれあいセンター', validFrom: '2026-04-01' },
];
