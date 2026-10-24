import { describe, expect, it } from 'vitest';
import { classEventToRow, planCheckin, summarizeForReception, type CheckinInput } from '../gas/src/domain/checkin';
import { generateClassEvents } from '../gas/src/domain/classSchedule';
import { KOMAGANE_CLASS_SCHEDULE, KOMAGANE_SETTINGS as S } from '../gas/src/domain/presets';
import { formatQrPayload, parseQrPayload } from '../gas/src/domain/qr';
import { normalizeForSearch, searchMembers } from '../gas/src/domain/search';

// 架空の会員
const members = [
  { memberNo: '001-00100', status: '本登録', legalName: '山田 花子', kana: 'ヤマダ ハナコ', nickname: 'ハナ', altName: '鈴木 花子' },
  { memberNo: '001-00123', status: '本登録', legalName: 'NGUYEN Thi Lan', kana: 'グエン ティ ラン', nickname: 'ラン', altName: '' },
  { memberNo: '001-00124', status: '退会', legalName: 'NGUYEN Van Nam', kana: 'グエン ヴァン ナム', nickname: 'ナム', altName: '' },
  { memberNo: '001-00200', status: '本登録', legalName: 'ｺﾊﾞﾔｼ', kana: 'コバヤシ ケン', nickname: 'ケン', altName: '' },
];

describe('会員の検索', () => {
  it('ひらがな・カタカナ、全角・半角、空白の違いを無視する', () => {
    expect(normalizeForSearch('ぐえん　てぃ')).toBe(normalizeForSearch('ｸﾞｴﾝﾃｨ'));
    expect(searchMembers(members, 'らん').map((m) => m.memberNo)).toEqual(['001-00123']);
    expect(searchMembers(members, 'nguyen thi').map((m) => m.memberNo)).toEqual(['001-00123']);
  });

  it('ニックネームの完全一致を先に、退会した人は後ろに', () => {
    expect(searchMembers(members, 'グエン').map((m) => m.memberNo)).toEqual(['001-00123', '001-00124']);
  });

  it('別名（旧姓）でも探せる', () => {
    expect(searchMembers(members, '鈴木').map((m) => m.memberNo)).toEqual(['001-00100']);
  });

  it('会員番号は、下の桁だけでも探せる', () => {
    expect(searchMembers(members, '123').map((m) => m.memberNo)).toEqual(['001-00123']);
    expect(searchMembers(members, '001-00200').map((m) => m.memberNo)).toEqual(['001-00200']);
    expect(searchMembers(members, '1')).toEqual([]);
  });

  it('空の検索では何も返さない', () => {
    expect(searchMembers(members, '  ')).toEqual([]);
  });
});

describe('会員証の QR', () => {
  it('CJN1 形式と、会員証ページの URL の両方を読める', () => {
    const p = { memberNo: '001-00123', token: 'abcDEF123_-xyz' };
    expect(parseQrPayload(formatQrPayload(p))).toEqual(p);
    expect(parseQrPayload('https://chikyujin-network.github.io/members/card/?id=001-00123&t=abcDEF123_-xyz')).toEqual(p);
  });

  it('関係ない QR は読まない', () => {
    expect(parseQrPayload('https://www.facebook.com/example')).toBeNull();
    expect(parseQrPayload('CJN1:123:abc')).toBeNull();
  });
});

const member = {
  memberNo: '001-00123',
  branchCode: '001',
  status: '本登録',
  membershipType: '一般',
  joinDate: '2024-05-01',
  residentInSubsidyMunicipality: '',
  lastAttendedDate: '2025-12-01',
  activityStatus: '休眠',
};
const input = (o: Partial<CheckinInput> = {}): CheckinInput => ({
  today: '2026-10-13',
  now: '2026-10-13 10:05:00',
  staffEmail: 'staff@example.com',
  event: { eventId: 'class-2026-10-13-1000', branchCode: '001' },
  method: '検索',
  feeReceived: true,
  joinInsurance: false,
  ...o,
});

describe('受付', () => {
  it('今年度はじめての参加：会費500円を受け取り、出席を記録し、活動中にする', () => {
    const r = planCheckin(member, [], [], S, input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.charges).toHaveLength(1);
    expect(r.charges[0]).toMatchObject({ chargeId: '001-00123-2026-M', kind: '会費', amount: 500, status: '支払済', receivedDate: '2026-10-13' });
    expect(r.attendance).toMatchObject({ attendanceId: 'class-2026-10-13-1000-001-00123', method: '検索' });
    expect(r.memberUpdates).toMatchObject({ lastAttendedDate: '2026-10-13', activityStatus: '活動中' });
  });

  it('今年度の会費が記録済みなら、出席だけ', () => {
    const charges = [{ memberNo: '001-00123', fiscalYear: 2026, kind: '会費', status: '支払済' }];
    const r = planCheckin(member, charges, [], S, input());
    expect(r.ok && r.charges).toEqual([]);
  });

  it('会費をその場で受け取れなかったときは、出席だけ記録して次回に持ち越す', () => {
    const r = planCheckin(member, [], [], S, input({ feeReceived: false }));
    expect(r.ok && r.charges).toEqual([]);
    expect(r.ok && r.attendance).toBeTruthy();
  });

  it('同じ会に2回受付しても、出席は1回だけ', () => {
    const att = [{ eventId: 'class-2026-10-13-1000', memberNo: '001-00123' }];
    const charges = [{ memberNo: '001-00123', fiscalYear: 2026, kind: '会費', status: '支払済' }];
    const r = planCheckin(member, charges, att, S, input());
    expect(r.ok && r.attendance).toBeNull();
  });

  it('保険に入るとき、住民票の答えがなければ止める。答えがあれば会員シートにも残す', () => {
    expect(planCheckin(member, [], [], S, input({ joinInsurance: true })).ok).toBe(false);
    const r = planCheckin(member, [], [], S, input({ joinInsurance: true, residentAnswer: 'いいえ' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.charges.find((c) => c.kind === '保険料')).toMatchObject({ amount: 500, selfPay: 330, subsidy: 170, subsidySource: 'ちきゅうじん' });
    expect(r.memberUpdates.residentInSubsidyMunicipality).toBe('いいえ');
    expect(r.changeLog.map((l) => l.field)).toContain('住民票が補填自治体にある');
  });

  it('1〜3月に入会した人は、その年度は免除として記録する', () => {
    const m = { ...member, joinDate: '2027-01-20' };
    const r = planCheckin(m, [], [], S, input({ today: '2027-01-20', now: '2027-01-20 10:00:00' }));
    expect(r.ok && r.charges[0]).toMatchObject({ status: '免除', amount: 0, fiscalYear: 2026 });
  });

  it('会費なし（中学生以下）の会員は、免除として記録する', () => {
    const m = { ...member, membershipType: '会費なし（中学生以下）' };
    const r = planCheckin(m, [], [], S, input());
    expect(r.ok && r.charges[0]).toMatchObject({ status: '免除', amount: 0 });
  });

  it('仮登録の人は、受付で本登録になり、入会日がなければ今日にする', () => {
    const m = { ...member, status: '仮登録', joinDate: '' };
    const r = planCheckin(m, [], [], S, input());
    expect(r.ok && r.memberUpdates).toMatchObject({ status: '本登録', joinDate: '2026-10-13' });
    expect(r.ok && r.changeLog.map((l) => l.after)).toEqual(['本登録', '2026-10-13']);
  });

  it('退会した会員は受付できない', () => {
    expect(planCheckin({ ...member, status: '退会' }, [], [], S, input()).ok).toBe(false);
  });

  it('受付画面の表示：会費が要るか、保険に入っているか、受付済みか', () => {
    const v = summarizeForReception(member, [], [], S, '2026-10-13', 'class-2026-10-13-1000');
    expect(v.fee).toMatchObject({ status: 'due', amount: 500 });
    expect(v).toMatchObject({ insuranceJoined: false, insuranceSelfPay: 330, needsResidentAnswer: true, alreadyCheckedIn: false });
  });
});

describe('教室のイベント', () => {
  it('その日の教室をイベントシートの行にする', () => {
    const [e] = generateClassEvents(KOMAGANE_CLASS_SCHEDULE, '2026-10-13', '2026-10-13');
    expect(classEventToRow(e, '001')).toMatchObject({ eventId: 'class-2026-10-13-1000', kind: '教室', title: '日本語教室', status: '予定' });
  });
});
