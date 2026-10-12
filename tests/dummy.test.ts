import { describe, expect, it } from 'vitest';
import { CHARGES, MEMBERS } from '../gas/src/schema';
import { parseDate, fiscalYearOf } from '../gas/src/domain/dates';
import { KOMAGANE_SETTINGS } from '../gas/src/domain/presets';
import { generateDummyData, isDummyMemberNo } from '../gas/src/domain/dummy';

const TODAY = '2026-10-12';
const opts = { count: 60, seed: 1, today: TODAY, settings: KOMAGANE_SETTINGS };
const data = generateDummyData(opts);

describe('ダミーデータの生成', () => {
  it('同じシードなら同じデータになる', () => {
    expect(generateDummyData(opts)).toEqual(generateDummyData({ ...opts }));
  });

  it('シードが違えば違うデータになる', () => {
    expect(generateDummyData({ ...opts, seed: 2 })).not.toEqual(data);
  });

  it('指定した人数の会員を作る', () => {
    expect(data.members).toHaveLength(60);
    expect(generateDummyData({ ...opts, count: 5 }).members).toHaveLength(5);
    expect(generateDummyData({ ...opts, count: 0 })).toEqual({ members: [], charges: [] });
  });

  it('会員と請求の項目が、シートの定義の列と過不足なく一致する', () => {
    const memberKeys = MEMBERS.columns.map((c) => c.key).sort();
    const chargeKeys = CHARGES.columns.map((c) => c.key).sort();
    for (const m of data.members) expect(Object.keys(m).sort()).toEqual(memberKeys);
    for (const c of data.charges) expect(Object.keys(c).sort()).toEqual(chargeKeys);
  });

  it('会員の値はすべて文字列、請求は数値の列だけ数値', () => {
    for (const m of data.members) for (const v of Object.values(m)) expect(typeof v).toBe('string');
    for (const c of data.charges) {
      for (const col of CHARGES.columns) {
        expect(typeof c[col.key]).toBe(col.numeric ? 'number' : 'string');
      }
    }
  });

  it('選択肢の列には、許された値だけが入る', () => {
    for (const col of MEMBERS.columns) {
      for (const m of data.members) {
        const v = m[col.key];
        if (col.options && v !== '') expect(col.options).toContain(v);
        if (col.multiOptions && v !== '') for (const p of v.split('、')) expect(col.multiOptions).toContain(p);
      }
    }
    for (const col of CHARGES.columns) {
      if (!col.options) continue;
      for (const c of data.charges) expect(col.options).toContain(c[col.key]);
    }
    const labels = KOMAGANE_SETTINGS.membershipTypes.map((t) => t.label);
    for (const m of data.members) expect(labels).toContain(m.membershipType);
  });

  it('必須の列は空にならない', () => {
    for (const col of MEMBERS.columns.filter((c) => c.required)) {
      for (const m of data.members) expect(m[col.key], col.key).not.toBe('');
    }
  });

  it('入会日と受領日は正しい日付で、今日より後にならない', () => {
    for (const m of data.members) {
      expect(() => parseDate(m.joinDate)).not.toThrow();
      expect(m.joinDate <= TODAY).toBe(true);
    }
    for (const c of data.charges) {
      const d = String(c.receivedDate);
      expect(() => parseDate(d)).not.toThrow();
      expect(d <= TODAY).toBe(true);
    }
  });

  it('受領日は入会日以降で、対象年度の中にある', () => {
    const joinOf = new Map(data.members.map((m) => [m.memberNo, m.joinDate]));
    for (const c of data.charges) {
      const d = String(c.receivedDate);
      expect(d >= joinOf.get(String(c.memberNo))!).toBe(true);
      expect(fiscalYearOf(d, KOMAGANE_SETTINGS.fiscalYearStartMonth)).toBe(c.fiscalYear);
    }
  });

  it('会員番号は重複せず、ダミーだと判定できる', () => {
    const nos = data.members.map((m) => m.memberNo);
    expect(new Set(nos).size).toBe(nos.length);
    expect(nos[0]).toBe('001-90000');
    for (const no of nos) expect(isDummyMemberNo(no)).toBe(true);
  });

  it('本物の会員番号や不正な文字列はダミーと判定しない', () => {
    expect(isDummyMemberNo('001-00123')).toBe(false);
    expect(isDummyMemberNo('001-89999')).toBe(false);
    expect(isDummyMemberNo('001-90000')).toBe(true);
    expect(isDummyMemberNo('')).toBe(false);
    expect(isDummyMemberNo('abc')).toBe(false);
  });

  it('請求IDは重複しない', () => {
    const ids = data.charges.map((c) => c.chargeId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('免除月に入会した人は、入会年度の会費が「免除」で金額0になる', () => {
    const exemptMembers = data.members.filter((m) =>
      KOMAGANE_SETTINGS.exemptJoinMonths.includes(parseDate(m.joinDate).month),
    );
    expect(exemptMembers.length).toBeGreaterThan(0);
    for (const m of exemptMembers) {
      const fy = fiscalYearOf(m.joinDate, KOMAGANE_SETTINGS.fiscalYearStartMonth);
      const rows = data.charges.filter((c) => c.memberNo === m.memberNo && c.kind === '会費' && c.fiscalYear === fy);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('免除');
      expect(rows[0].amount).toBe(0);
    }
  });

  it('免除月以外の入会年度の会費は「支払済」で、会費×口数になる', () => {
    for (const c of data.charges.filter((x) => x.kind === '会費' && x.status === '支払済')) {
      expect(c.amount).toBe(500 * (c.units as number));
      expect(c.selfPay).toBe(c.amount);
      expect(c.subsidy).toBe(0);
    }
  });

  it('保険料の行は、本人負担額＋補填額＝金額になる', () => {
    const rows = data.charges.filter((c) => c.kind === '保険料');
    expect(rows.length).toBeGreaterThan(0);
    for (const c of rows) {
      expect((c.selfPay as number) + (c.subsidy as number)).toBe(c.amount);
      expect(c.amount).toBe(KOMAGANE_SETTINGS.insurance.premium);
      expect(c.fiscalYear).toBe(2026);
    }
  });

  it('保険料の補填元は、住民票の所在で決まる', () => {
    const memberOf = new Map(data.members.map((m) => [m.memberNo, m]));
    for (const c of data.charges.filter((x) => x.kind === '保険料')) {
      const m = memberOf.get(String(c.memberNo))!;
      expect(c.subsidySource).toBe(
        m.residentInSubsidyMunicipality === 'はい' ? '駒ヶ根市' : 'ちきゅうじん',
      );
    }
  });

  it('携帯電話はすべて架空の番号（090-0000-）', () => {
    for (const m of data.members) expect(m.mobile.startsWith('090-0000-')).toBe(true);
  });

  it('メールは空か example.com のアドレスだけ', () => {
    for (const m of data.members) expect(m.email === '' || m.email.endsWith('@example.com')).toBe(true);
  });

  it('すべての会員の備考に「ダミーデータ」が入る', () => {
    for (const m of data.members) expect(m.notes).toContain('ダミーデータ');
  });

  it('国は日本が約半分で、外国籍の人は登録名がローマ字', () => {
    const jp = data.members.filter((m) => m.country === 'JP');
    expect(jp.length).toBeGreaterThan(15);
    expect(jp.length).toBeLessThan(45);
    for (const m of data.members.filter((x) => x.country !== 'JP')) {
      expect(m.legalName).toMatch(/^[A-Z]+ [A-Za-z ]+$/);
    }
    for (const m of data.members) expect(m.kana).toMatch(/^[ァ-ヶー ]+$/);
  });

  it('QRトークンは16文字のURL安全な文字列で、重複しない', () => {
    const tokens = data.members.map((m) => m.qrToken);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('最終参加日は受領日の最大で、活動状態は当年度か前年度の会費の有無で決まる', () => {
    for (const m of data.members) {
      const rows = data.charges.filter((c) => c.memberNo === m.memberNo);
      const last = rows.map((c) => String(c.receivedDate)).sort().pop() ?? '';
      expect(m.lastAttendedDate).toBe(last);
      const recent = rows.some((c) => c.kind === '会費' && (c.fiscalYear === 2026 || c.fiscalYear === 2025));
      expect(m.activityStatus).toBe(recent ? '活動中' : '休眠');
    }
  });

  it('日時の列は YYYY-MM-DD HH:MM:SS の形式', () => {
    const re = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
    for (const m of data.members) {
      expect(m.createdAt).toMatch(re);
      expect(m.updatedAt).toMatch(re);
      if (m.consentAt !== '') expect(m.consentAt).toMatch(re);
    }
    for (const c of data.charges) expect(c.recordedAt).toMatch(re);
  });
});
