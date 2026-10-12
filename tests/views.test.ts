import { describe, expect, it } from 'vitest';
import { generateDummyData } from '../gas/src/domain/dummy';
import { KOMAGANE_SETTINGS as S } from '../gas/src/domain/presets';
import { buildViews, type Row } from '../gas/src/domain/views';

// 架空の会員
const m = (o: Partial<Record<string, string>>): Row => ({
  memberNo: '001-00100',
  status: '本登録',
  legalName: 'TEST',
  kana: 'テスト',
  nickname: 'テスト',
  membershipType: '一般',
  roles: '学習者',
  country: 'JP',
  municipality: '駒ヶ根市',
  mobile: '090-0000-0000',
  activityStatus: '活動中',
  joinDate: '2024-05-01',
  ...o,
});
const today = '2026-10-12';
const view = (views: ReturnType<typeof buildViews>, prefix: string) => views.find((v) => v.name.startsWith(prefix))!;

describe('ビュー用シート', () => {
  const members = [
    m({ memberNo: '001-00100', kana: 'ヤマダ ハナコ' }),
    m({ memberNo: '001-00101', kana: 'アオキ タロウ' }),
    m({ memberNo: '001-00102', kana: 'イトウ ジロウ', activityStatus: '休眠' }),
    m({ memberNo: '001-00103', kana: 'ウエノ サブロウ', status: '退会' }),
    m({ memberNo: '001-00104', kana: 'グエン ティ ラン', country: 'VN' }),
    m({ memberNo: '001-00105', kana: 'アデ', country: 'ID' }),
    m({ memberNo: '001-00106', kana: 'アナ', country: 'VN', municipality: '伊那市' }),
  ];
  const charges: Row[] = [
    { memberNo: '001-00100', fiscalYear: 2026, kind: '会費', status: '支払済', amount: 500, units: 1, receivedDate: '2026-04-10', receivedBy: '受付A' },
    { memberNo: '001-00100', fiscalYear: 2026, kind: '保険料', status: '支払済', amount: 500, selfPay: 330, subsidy: 170, subsidySource: '駒ヶ根市', receivedDate: '2026-04-10' },
    { memberNo: '001-00106', fiscalYear: 2026, kind: '保険料', status: '支払済', amount: 500, selfPay: 330, subsidy: 170, subsidySource: 'ちきゅうじん', receivedDate: '2026-04-01' },
    { memberNo: '001-00101', fiscalYear: 2025, kind: '会費', status: '支払済', amount: 500, units: 1, receivedDate: '2025-06-01' },
  ];
  const views = buildViews(members, charges, S, today);

  it('日本人の名簿は、活動中の人だけを50音順に並べる（休眠・退会は載せない）', () => {
    const v = view(views, '名簿（日本人');
    expect(v.rows.map((r) => r[0])).toEqual(['001-00101', '001-00100']);
  });

  it('外国人の名簿は、国名の50音順、その中でよみの50音順', () => {
    const v = view(views, '名簿（外国人');
    expect(v.rows.map((r) => [r[0], r[1]])).toEqual([
      ['インドネシア', '001-00105'],
      ['ベトナム', '001-00106'],
      ['ベトナム', '001-00104'],
    ]);
  });

  it('全員の名簿には、休眠・退会の人も入る', () => {
    expect(view(views, '名簿（全員').rows).toHaveLength(members.length);
  });

  it('会費・保険の状況は今年度の分。記録がない活動中の人は「未」', () => {
    const v = view(views, '会費・保険（2026年度）');
    const byNo = new Map(v.rows.map((r) => [r[0], r]));
    expect(byNo.get('001-00100')?.slice(4, 6)).toEqual(['支払済', 500]);
    expect(byNo.get('001-00100')?.[10]).toBe('加入');
    expect(byNo.get('001-00101')?.[4]).toBe('未'); // 前年度だけ払った人
    expect(byNo.has('001-00102')).toBe(false); // 休眠で今年度の記録なし
    expect(byNo.has('001-00103')).toBe(false); // 退会
  });

  it('保険名簿は申込日順。提出用の金額は、市が補填する人は本人負担額、それ以外は総額', () => {
    const v = view(views, '保険名簿（2026年度）');
    expect(v.rows.map((r) => [r[0], r[2], r[6], r[7], r[9], r[10]])).toEqual([
      [1, '001-00106', 500, 330, 'ちきゅうじん', 500],
      [2, '001-00100', 500, 330, '駒ヶ根市', 330],
    ]);
  });

  it('ダミーデータからでも作れ、見出しと列の数がそろっている', () => {
    const d = generateDummyData({ count: 80, seed: 1, today, settings: S });
    for (const v of buildViews(d.members, d.charges, S, today)) {
      for (const r of v.rows) expect(r.length, v.name).toBe(v.headers.length);
    }
  });
});
