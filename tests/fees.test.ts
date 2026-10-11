import { describe, expect, it } from 'vitest';
import { fiscalYearOf } from '../gas/src/domain/dates';
import { decideMembershipFee, insuranceBreakdown } from '../gas/src/domain/fees';
import { KOMAGANE_SETTINGS as S } from '../gas/src/domain/presets';
import type { BranchSettings, Charge } from '../gas/src/domain/types';

const general = (joinDate: string) => ({ joinDate, membershipTypeId: 'general', units: 1 });

describe('年度の判定（4月始まり）', () => {
  it('3月31日は前の年度、4月1日は新しい年度', () => {
    expect(fiscalYearOf('2027-03-31', 4)).toBe(2026);
    expect(fiscalYearOf('2027-04-01', 4)).toBe(2027);
  });
  it('1月始まりの支部では暦年と同じ', () => {
    expect(fiscalYearOf('2027-01-01', 1)).toBe(2027);
    expect(fiscalYearOf('2026-12-31', 1)).toBe(2026);
  });
  it('存在しない日付や形式違いは例外', () => {
    expect(() => fiscalYearOf('2027-02-30', 4)).toThrow();
    expect(() => fiscalYearOf('2027/04/01', 4)).toThrow();
  });
});

describe('会費の判定', () => {
  it('その年度に初めて来た一般会員は500円', () => {
    expect(decideMembershipFee('2026-10-13', general('2020-05-01'), [], S)).toEqual({
      status: 'due',
      fiscalYear: 2026,
      amount: 500,
      units: 1,
    });
  });

  it('同じ年度に支払済みなら受け取らない', () => {
    const charges: Charge[] = [{ fiscalYear: 2026, kind: 'membership', status: 'paid' }];
    expect(decideMembershipFee('2026-10-13', general('2020-05-01'), charges, S).status).toBe('recorded');
  });

  it('前払い（翌年度分が記録済み）なら翌年度に来ても受け取らない', () => {
    const charges: Charge[] = [
      { fiscalYear: 2026, kind: 'membership', status: 'paid' },
      { fiscalYear: 2027, kind: 'membership', status: 'paid' },
    ];
    expect(decideMembershipFee('2027-04-10', general('2020-05-01'), charges, S).status).toBe('recorded');
  });

  it('保険料の記録だけでは会費の記録にならない', () => {
    const charges: Charge[] = [{ fiscalYear: 2026, kind: 'insurance', status: 'paid' }];
    expect(decideMembershipFee('2026-10-13', general('2020-05-01'), charges, S).status).toBe('due');
  });

  it('1〜3月に入会した人は、その年度は免除', () => {
    expect(decideMembershipFee('2027-01-20', general('2027-01-15'), [], S)).toEqual({
      status: 'exempt',
      fiscalYear: 2026,
      reason: 'joined-in-exempt-months',
    });
    expect(decideMembershipFee('2027-03-31', general('2027-03-31'), [], S).status).toBe('exempt');
  });

  it('1〜3月に入会した人も、次の年度（4月以降）は支払う', () => {
    expect(decideMembershipFee('2027-04-01', general('2027-02-10'), [], S).status).toBe('due');
  });

  it('4〜12月に入会した人は、入会した年度から支払う', () => {
    expect(decideMembershipFee('2026-12-20', general('2026-12-20'), [], S).status).toBe('due');
  });

  it('賛助会員は 500円 × 口数', () => {
    const m = { joinDate: '2020-05-01', membershipTypeId: 'supporting', units: 3 };
    expect(decideMembershipFee('2026-10-13', m, [], S)).toMatchObject({ status: 'due', amount: 1500, units: 3 });
  });

  it('一般会員は口数が入っていても1口として扱う', () => {
    const m = { joinDate: '2020-05-01', membershipTypeId: 'general', units: 2 };
    expect(decideMembershipFee('2026-10-13', m, [], S)).toMatchObject({ amount: 500, units: 1 });
  });

  it('口数が0や小数なら例外', () => {
    const m = { joinDate: '2020-05-01', membershipTypeId: 'supporting', units: 0 };
    expect(() => decideMembershipFee('2026-10-13', m, [], S)).toThrow();
  });

  it('設定にない会員種別は例外', () => {
    const m = { joinDate: '2020-05-01', membershipTypeId: 'student', units: 1 };
    expect(() => decideMembershipFee('2026-10-13', m, [], S)).toThrow();
  });

  it('免除の月がない支部では、1〜3月入会でも支払う', () => {
    const other: BranchSettings = { ...S, branchCode: '002', exemptJoinMonths: [] };
    expect(decideMembershipFee('2027-01-20', general('2027-01-15'), [], other).status).toBe('due');
  });
});

describe('保険料の内訳', () => {
  it('駒ヶ根市に住民票がある人は、補填元が駒ヶ根市', () => {
    expect(insuranceBreakdown(S, true)).toEqual({
      premium: 500,
      selfPay: 330,
      subsidy: 170,
      subsidySource: '駒ヶ根市',
    });
  });

  it('それ以外の人は、補填元がちきゅうじん。本人負担は同じ330円', () => {
    expect(insuranceBreakdown(S, false)).toEqual({
      premium: 500,
      selfPay: 330,
      subsidy: 170,
      subsidySource: 'ちきゅうじん',
    });
  });

  it('補填額が変わっても設定だけで対応できる', () => {
    const changed: BranchSettings = { ...S, insurance: { ...S.insurance, subsidy: 200 } };
    expect(insuranceBreakdown(changed, true)).toMatchObject({ selfPay: 300, subsidy: 200 });
  });

  it('保険を扱わない支部では例外', () => {
    const none: BranchSettings = { ...S, insurance: { ...S.insurance, enabled: false } };
    expect(() => insuranceBreakdown(none, true)).toThrow();
  });
});
