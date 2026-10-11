import { fiscalYearOf, parseDate } from './dates';
import type { BranchSettings, Charge, DateString, MemberForFee } from './types';

/** 会費判定の結果 */
export type MembershipFeeDecision =
  | { status: 'recorded'; fiscalYear: number } // その年度の記録がすでにある（支払済・免除・前払い）
  | { status: 'exempt'; fiscalYear: number; reason: 'joined-in-exempt-months' } // 免除として記録する
  | { status: 'due'; fiscalYear: number; amount: number; units: number }; // この場で受け取る

/**
 * 受付の日に、その年度の会費をどう扱うかを判定する。
 *
 * - その年度の会費の記録（支払済・免除）がすでにあれば 'recorded'
 * - 入会した年度で、入会月が免除の月（駒ヶ根は1〜3月）なら 'exempt'
 * - それ以外は 'due'（会費 × 口数）
 *
 * 1回も参加しない年度は、この判定が呼ばれないので請求も発生しない。
 */
export function decideMembershipFee(
  today: DateString,
  member: MemberForFee,
  charges: readonly Charge[],
  settings: BranchSettings,
): MembershipFeeDecision {
  const fy = fiscalYearOf(today, settings.fiscalYearStartMonth);

  const hasRecord = charges.some((c) => c.kind === 'membership' && c.fiscalYear === fy);
  if (hasRecord) return { status: 'recorded', fiscalYear: fy };

  const joinFy = fiscalYearOf(member.joinDate, settings.fiscalYearStartMonth);
  const joinMonth = parseDate(member.joinDate).month;
  if (joinFy === fy && settings.exemptJoinMonths.includes(joinMonth)) {
    return { status: 'exempt', fiscalYear: fy, reason: 'joined-in-exempt-months' };
  }

  const type = settings.membershipTypes.find((t) => t.id === member.membershipTypeId);
  if (!type) throw new Error(`会員種別が設定にありません: ${member.membershipTypeId}`);

  const units = type.allowMultipleUnits ? member.units : 1;
  if (!Number.isInteger(units) || units < 1) throw new Error(`口数が正しくありません: ${member.units}`);

  return { status: 'due', fiscalYear: fy, amount: type.feePerUnit * units, units };
}

/** 保険料の内訳 */
export interface InsuranceBreakdown {
  premium: number; // 総額
  selfPay: number; // 本人負担額
  subsidy: number; // 補填額
  subsidySource: string; // 補填元
}

/**
 * 保険料の内訳を出す。保険料に免除はない。
 * 補填元は、住民票が補填する自治体にあればその自治体、なければ団体。
 */
export function insuranceBreakdown(
  settings: BranchSettings,
  residentRegisteredInSubsidyMunicipality: boolean,
): InsuranceBreakdown {
  const ins = settings.insurance;
  if (!ins.enabled) throw new Error('この支部では保険を扱っていません');
  if (ins.subsidy < 0 || ins.subsidy > ins.premium) throw new Error('補填額の設定が正しくありません');
  return {
    premium: ins.premium,
    selfPay: ins.premium - ins.subsidy,
    subsidy: ins.subsidy,
    subsidySource: residentRegisteredInSubsidyMunicipality ? ins.subsidyMunicipality : ins.fallbackSubsidySource,
  };
}
