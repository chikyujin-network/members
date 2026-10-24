import type { ClassEvent } from './classSchedule';
import { fiscalYearOf } from './dates';
import { decideMembershipFee, insuranceBreakdown, type MembershipFeeDecision } from './fees';
import type { BranchSettings, Charge, DateString } from './types';

/**
 * 受付（出席・会費・保険）で、シートに何を書くかを決める。GAS に依存しない純粋な関数。
 * 実際の書き込みは GAS 側（api.ts）で、ここが返した行をそのまま追記・更新する。
 */

export type Rec = Readonly<Record<string, string | number>>;

const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

function toCharges(charges: readonly Rec[], memberNo: string): Charge[] {
  return charges
    .filter((c) => s(c.memberNo) === memberNo)
    .map((c) => ({
      fiscalYear: Number(c.fiscalYear),
      kind: s(c.kind) === '保険料' ? 'insurance' : 'membership',
      status: s(c.status) === '免除' ? 'exempt' : 'paid',
    }));
}

function typeIdOf(member: Rec, settings: BranchSettings): string {
  const label = s(member.membershipType);
  return settings.membershipTypes.find((t) => t.label === label || t.id === label)?.id ?? '';
}

/** 受付画面に出す、会員のその日の状況 */
export interface ReceptionSummary {
  fiscalYear: number;
  fee: MembershipFeeDecision;
  /** その年度の保険に入っているか */
  insuranceJoined: boolean;
  /** 保険を扱う支部で、まだ入っていなければ、入るときの内訳の目安（補填元は住民票の答えで決まる） */
  insuranceSelfPay: number | null;
  /** 保険に入るとき、住民票の確認が必要か（会員シートに答えがない） */
  needsResidentAnswer: boolean;
  alreadyCheckedIn: boolean;
  warnings: string[];
}

export function summarizeForReception(
  member: Rec,
  charges: readonly Rec[],
  attendance: readonly Rec[],
  settings: BranchSettings,
  today: DateString,
  eventId: string,
): ReceptionSummary {
  const memberNo = s(member.memberNo);
  const fy = fiscalYearOf(today, settings.fiscalYearStartMonth);
  const mine = toCharges(charges, memberNo);
  const typeId = typeIdOf(member, settings);
  const joinDate = s(member.joinDate) || today;
  const fee = typeId
    ? decideMembershipFee(today, { joinDate, membershipTypeId: typeId, units: 1 }, mine, settings)
    : ({ status: 'due', fiscalYear: fy, amount: 0, units: 1 } as MembershipFeeDecision);
  const insuranceJoined = mine.some((c) => c.kind === 'insurance' && c.fiscalYear === fy);
  const warnings: string[] = [];
  if (!typeId) warnings.push(`会員種別「${s(member.membershipType)}」が設定にありません。運営に確認してください`);
  if (s(member.status) === '退会') warnings.push('退会した会員です。復帰する場合は、運営が登録状態を直してから受付してください');
  if (s(member.status) === '仮登録') warnings.push('仮登録の会員です。名前を確認して受付すると本登録になります');
  return {
    fiscalYear: fy,
    fee,
    insuranceJoined,
    insuranceSelfPay: settings.insurance.enabled && !insuranceJoined ? settings.insurance.premium - settings.insurance.subsidy : null,
    needsResidentAnswer: s(member.residentInSubsidyMunicipality) === '',
    alreadyCheckedIn: attendance.some((a) => s(a.eventId) === eventId && s(a.memberNo) === memberNo),
    warnings,
  };
}

export interface CheckinInput {
  today: DateString;
  /** 'YYYY-MM-DD HH:MM:SS'（日本時間） */
  now: string;
  staffEmail: string;
  event: { eventId: string; branchCode: string };
  method: 'QR' | '検索' | '新規';
  /** 会費が必要なとき、この場で受け取ったか。受け取らなければ出席だけ記録し、会費は次回に持ち越す */
  feeReceived: boolean;
  /** 保険に入るか */
  joinInsurance: boolean;
  /** 住民票が補填する自治体にあるか（会員シートに答えがないときだけ使う） */
  residentAnswer?: 'はい' | 'いいえ';
}

export interface CheckinPlan {
  /** 追記する出席の行（すでに出席済みなら null） */
  attendance: Record<string, string> | null;
  /** 追記する年度請求の行 */
  charges: Record<string, string | number>[];
  /** 会員シートで書き換える項目 */
  memberUpdates: Record<string, string>;
  /** 変更履歴に追記する行 */
  changeLog: Record<string, string>[];
  /** 画面に出す結果の説明 */
  messages: string[];
}

export type CheckinResult = ({ ok: true } & CheckinPlan) | { ok: false; error: string };

export function planCheckin(
  member: Rec,
  charges: readonly Rec[],
  attendance: readonly Rec[],
  settings: BranchSettings,
  input: CheckinInput,
): CheckinResult {
  const memberNo = s(member.memberNo);
  if (!memberNo) return { ok: false, error: '会員番号がありません' };
  if (s(member.status) === '退会') {
    return { ok: false, error: '退会した会員です。復帰する場合は、運営が登録状態を直してから受付してください' };
  }
  const summary = summarizeForReception(member, charges, attendance, settings, input.today, input.event.eventId);
  if (summary.warnings.some((w) => w.startsWith('会員種別'))) return { ok: false, error: summary.warnings[0] };

  const fy = summary.fiscalYear;
  const base = {
    branchCode: settings.branchCode,
    memberNo,
    fiscalYear: fy,
    receivedDate: input.today,
    receivedBy: input.staffEmail,
    handedToTreasurerDate: '',
    recordedAt: input.now,
  };
  const newCharges: Record<string, string | number>[] = [];
  const messages: string[] = [];
  const memberUpdates: Record<string, string> = {};
  const changeLog: Record<string, string>[] = [];
  const log = (field: string, header: string, before: string, after: string) => {
    memberUpdates[field] = after;
    changeLog.push({
      changedAt: input.now,
      changedBy: input.staffEmail,
      sheet: '会員',
      recordId: memberNo,
      action: '変更',
      field: header,
      before,
      after,
      reason: '受付',
    });
  };

  // 会費
  const fee = summary.fee;
  if (fee.status === 'exempt') {
    newCharges.push({
      ...base,
      chargeId: `${memberNo}-${fy}-M`,
      kind: '会費',
      units: 1,
      amount: 0,
      selfPay: 0,
      subsidy: 0,
      subsidySource: '',
      status: '免除',
      notes: fee.reason === 'no-fee-type' ? '会費なしの会員種別' : '1〜3月の入会のため今年度は免除',
    });
    messages.push(`${fy}年度の会費は免除です`);
  } else if (fee.status === 'due') {
    if (input.feeReceived) {
      newCharges.push({
        ...base,
        chargeId: `${memberNo}-${fy}-M`,
        kind: '会費',
        units: fee.units,
        amount: fee.amount,
        selfPay: fee.amount,
        subsidy: 0,
        subsidySource: '',
        status: '支払済',
        notes: '',
      });
      messages.push(`${fy}年度の会費 ${fee.amount}円を受け取りました`);
    } else {
      messages.push(`${fy}年度の会費 ${fee.amount}円は、まだ受け取っていません（次回の受付でまた表示されます）`);
    }
  }

  // 保険
  if (input.joinInsurance) {
    if (!settings.insurance.enabled) return { ok: false, error: 'この支部では保険を扱っていません' };
    if (summary.insuranceJoined) {
      messages.push(`${fy}年度の保険には、もう入っています`);
    } else {
      let resident = s(member.residentInSubsidyMunicipality);
      if (resident === '') {
        if (!input.residentAnswer) {
          return { ok: false, error: `保険に入るには、住民票が${settings.insurance.subsidyMunicipality}にあるかの確認が必要です` };
        }
        resident = input.residentAnswer;
        log('residentInSubsidyMunicipality', '住民票が補填自治体にある', '', resident);
      }
      const b = insuranceBreakdown(settings, resident === 'はい');
      newCharges.push({
        ...base,
        chargeId: `${memberNo}-${fy}-I`,
        kind: '保険料',
        units: 1,
        amount: b.premium,
        selfPay: b.selfPay,
        subsidy: b.subsidy,
        subsidySource: b.subsidySource,
        status: '支払済',
        notes: '',
      });
      messages.push(`${fy}年度の保険料 ${b.selfPay}円を受け取りました（補填元：${b.subsidySource}）`);
    }
  }

  // 出席
  let attendanceRow: Record<string, string> | null = null;
  if (summary.alreadyCheckedIn) {
    messages.push('この会にはもう受付済みです');
  } else {
    attendanceRow = {
      attendanceId: `${input.event.eventId}-${memberNo}`,
      eventId: input.event.eventId,
      eventBranchCode: input.event.branchCode,
      memberNo,
      memberBranchCode: s(member.branchCode) || settings.branchCode,
      checkedInAt: input.now,
      method: input.method,
      checkedInBy: input.staffEmail,
    };
    messages.push('出席を記録しました');
  }

  // 会員シート：仮登録は本登録に、入会日がなければ今日、最終参加日と活動状態
  if (s(member.status) === '仮登録') log('status', '登録状態', '仮登録', '本登録');
  if (s(member.joinDate) === '') log('joinDate', '入会日', '', input.today);
  if (s(member.lastAttendedDate) < input.today) memberUpdates.lastAttendedDate = input.today;
  if (s(member.activityStatus) !== '活動中') memberUpdates.activityStatus = '活動中';
  if (Object.keys(memberUpdates).length > 0) memberUpdates.updatedAt = input.now;

  return { ok: true, attendance: attendanceRow, charges: newCharges, memberUpdates, changeLog, messages };
}

/** 自動で作る教室のイベントを、イベントシートの行にする */
export function classEventToRow(e: ClassEvent, branchCode: string): Record<string, string> {
  return {
    eventId: e.eventKey,
    branchCode,
    kind: '教室',
    title: '日本語教室',
    date: e.date,
    startTime: e.startTime,
    endTime: e.endTime,
    venue: e.venue,
    status: '予定',
    notes: '',
  };
}
