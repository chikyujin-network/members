import { describe, expect, it } from 'vitest';
import { planMemberEdit } from '../gas/src/domain/memberEdit';
import { MEMBERS } from '../gas/src/schema';

// 架空の会員
const current = {
  memberNo: '001-00123',
  status: '本登録',
  legalName: 'TEST Taro',
  kana: 'テスト タロウ',
  nickname: 'タロウ',
  membershipType: '一般',
  roles: '学習者',
  municipality: '駒ヶ根市',
  mobile: '090-0000-0000',
  joinDate: '2026-05-01',
  updatedAt: '2026-10-01 10:00:00',
};
const ctx = { membershipTypeLabels: ['一般', '賛助'] };
const plan = (changes: Record<string, unknown>, expected = current.updatedAt) =>
  planMemberEdit(MEMBERS.columns, current, changes, expected, ctx);

describe('運営スタッフによる会員の変更', () => {
  it('変わった項目だけを、列の順番で返す', () => {
    const r = plan({ mobile: '090-1111-2222', nickname: 'タロウ', municipality: '伊那市' });
    expect(r).toEqual({
      ok: true,
      diffs: [
        { key: 'municipality', header: '市町村', before: '駒ヶ根市', after: '伊那市' },
        { key: 'mobile', header: '携帯電話', before: '090-0000-0000', after: '090-1111-2222' },
      ],
    });
  });

  it('前後の空白は取り除き、同じ値なら変更なし', () => {
    expect(plan({ nickname: '  タロウ ' })).toEqual({ ok: true, diffs: [] });
  });

  it('ほかの人が先に更新していたら、上書きせずに止める', () => {
    const r = plan({ mobile: '090-1111-2222' }, '2026-09-30 09:00:00');
    expect(r.ok).toBe(false);
  });

  it('会員番号やQRトークンなど、システムが管理する項目は変えられない', () => {
    expect(plan({ memberNo: '001-00999' }).ok).toBe(false);
    expect(plan({ qrToken: 'x' }).ok).toBe(false);
    expect(plan({ updatedAt: '2026-10-02' }).ok).toBe(false);
  });

  it('知らない項目は受け付けない', () => {
    expect(plan({ password: 'x' }).ok).toBe(false);
  });

  it('必須の項目は空にできない', () => {
    expect(plan({ nickname: '' }).ok).toBe(false);
    expect(plan({ kana: '   ' }).ok).toBe(false);
  });

  it('選択肢のある項目は、選択肢の値だけ', () => {
    expect(plan({ status: '退会' })).toMatchObject({ ok: true, diffs: [{ key: 'status', after: '退会' }] });
    expect(plan({ status: '保留' }).ok).toBe(false);
  });

  it('会員種別は、設定にある名称だけ', () => {
    expect(plan({ membershipType: '賛助' }).ok).toBe(true);
    expect(plan({ membershipType: '学生' }).ok).toBe(false);
  });

  it('入会日は YYYY-MM-DD の正しい日付だけ', () => {
    expect(plan({ joinDate: '2026-02-30' }).ok).toBe(false);
    expect(plan({ joinDate: '2026/05/01' }).ok).toBe(false);
    expect(plan({ joinDate: '2026-04-15' }).ok).toBe(true);
  });

  it('役割は複数選べ、順番違いは変更と見なさない', () => {
    const r = plan({ roles: '日本語ボランティア、学習者' });
    expect(r).toMatchObject({ ok: true, diffs: [{ key: 'roles', before: '学習者', after: '学習者、日本語ボランティア' }] });
    const same = planMemberEdit(MEMBERS.columns, { ...current, roles: '学習者、日本語ボランティア' }, { roles: '日本語ボランティア、学習者' }, current.updatedAt, ctx);
    expect(same).toEqual({ ok: true, diffs: [] });
    expect(plan({ roles: '先生' }).ok).toBe(false);
  });
});
