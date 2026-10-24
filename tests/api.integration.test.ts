import { beforeAll, describe, expect, it, vi } from 'vitest';
import { generateDummyData } from '../gas/src/domain/dummy';
import { KOMAGANE_SETTINGS } from '../gas/src/domain/presets';
import { CHARGES, MEMBERS } from '../gas/src/schema';
import { installFakeGas, type FakeSpreadsheet } from './fakes/gas';

/**
 * GAS の API を、メモリ上の模擬スプレッドシートで通しで動かす。
 * setupSpreadsheet → ダミーデータ → 受付 → 会員の編集 → 会員証の再発行 → ビューの更新。
 */

const OPERATOR = 'tok-operator-0123456789abcdef';
const RECEPTION = 'tok-reception-0123456789abcdef';
let ss: FakeSpreadsheet;
let api: typeof import('../gas/src/api');

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-13T01:00:00Z')); // 日本時間 2026-10-13（火）10:00。火曜の教室がある日
  ss = installFakeGas({
    properties: { SPREADSHEET_ID: 'test', GOOGLE_CLIENT_ID: 'client', MAINTAINER_EMAILS: 'maint@example.com' },
    staffTokens: { [OPERATOR]: 'op@example.com', [RECEPTION]: 'rc@example.com', 'tok-stranger-0123456789abcdef': 'who@example.com' },
  });
  const { setupSpreadsheet } = await import('../gas/src/setup');
  setupSpreadsheet();
  // スタッフを登録する
  ss.sheet('設定_スタッフ').data.push(['op@example.com', '運営A', '運営', 'はい'], ['rc@example.com', '受付B', '受付', 'はい']);
  // 架空の会員と会費の記録を入れる
  const d = generateDummyData({ count: 40, seed: 7, today: '2026-10-13', settings: KOMAGANE_SETTINGS });
  for (const m of d.members) ss.sheet('会員').data.push(MEMBERS.columns.map((c) => m[c.key]));
  for (const c of d.charges) ss.sheet('年度請求').data.push(CHARGES.columns.map((col) => c[col.key]));
  api = await import('../gas/src/api');
});

const call = (action: string, token: string, params: Record<string, unknown> = {}) =>
  api.handleStaffAction(action, { idToken: token, ...params }) as any;

describe('スタッフ用 API（模擬スプレッドシート）', () => {
  it('シートがすべて作られ、保護されている', () => {
    for (const name of ['会員', '年度請求', 'イベント', '出席', '設定', '変更履歴']) {
      expect(ss.sheet(name).protections.length, name).toBe(1);
      expect(ss.sheet(name).protections[0].editors).toEqual(['maint@example.com']);
    }
  });

  it('登録されていない人はログインできない。受付の人は運営の操作ができない', () => {
    expect(call('staff.bootstrap', 'tok-stranger-0123456789abcdef')).toMatchObject({ ok: false, needLogin: true });
    expect(call('member.get', RECEPTION, { memberNo: '001-90000' })).toMatchObject({ ok: false });
  });

  it('起動：今日の教室が自動で作られる（2回呼んでも1つだけ）', () => {
    const r1 = call('staff.bootstrap', RECEPTION);
    const r2 = call('staff.bootstrap', RECEPTION);
    expect(r1.ok).toBe(true);
    expect(r1.events).toEqual([expect.objectContaining({ eventId: 'class-2026-10-13-1000', title: '日本語教室' })]);
    expect(r2.events).toHaveLength(1);
    expect(ss.sheet('イベント').records()).toHaveLength(1);
    expect(r1.settings).toMatchObject({ insuranceEnabled: true, insuranceSelfPay: 330, subsidyMunicipality: '駒ヶ根市' });
  });

  it('検索：連絡先や住所は返さない', () => {
    const r = call('members.search', RECEPTION, { q: '90001' });
    expect(r.ok).toBe(true);
    expect(r.members.length).toBeGreaterThan(0);
    expect(Object.keys(r.members[0])).not.toContain('mobile');
    expect(Object.keys(r.members[0])).not.toContain('address');
    expect(Object.keys(r.members[0])).not.toContain('qrToken');
  });

  it('受付：会費と保険を受け取り、出席・会員・変更履歴を書き込む', () => {
    // 今年度の会費が未の、本登録の会員を探す
    const members = ss.sheet('会員').records();
    const charges = ss.sheet('年度請求').records();
    const target = members.find(
      (m) =>
        m['登録状態'] === '本登録' &&
        m['会員種別'] === '一般' &&
        !charges.some((c) => c['会員番号'] === m['会員番号'] && Number(c['対象年度']) === 2026),
    )!;
    const no = String(target['会員番号']);
    const before = call('reception.lookup', RECEPTION, { memberNo: no, eventId: 'class-2026-10-13-1000' });
    expect(before.reception.fee).toMatchObject({ status: 'due', amount: 500 });

    const r = call('reception.checkin', RECEPTION, {
      memberNo: no, eventId: 'class-2026-10-13-1000', method: '検索', feeReceived: true, joinInsurance: true, residentAnswer: 'はい',
    });
    expect(r.ok).toBe(true);
    const mine = ss.sheet('年度請求').records().filter((c) => c['会員番号'] === no && Number(c['対象年度']) === 2026);
    expect(mine.map((c) => [c['種類'], c['金額'], c['本人負担額'], c['補填元'], c['受領者']])).toEqual([
      ['会費', 500, 500, '', 'rc@example.com'],
      ['保険料', 500, 330, '駒ヶ根市', 'rc@example.com'],
    ]);
    expect(ss.sheet('出席').records().filter((a) => a['会員番号'] === no)).toHaveLength(1);
    const m = ss.sheet('会員').records().find((x) => x['会員番号'] === no)!;
    expect(m['最終参加日']).toBe('2026-10-13');
    expect(m['活動状態']).toBe('活動中');

    // もう一度受付しても、会費・保険・出席は増えない
    const again = call('reception.checkin', RECEPTION, { memberNo: no, eventId: 'class-2026-10-13-1000', method: '検索', feeReceived: true, joinInsurance: true });
    expect(again.ok).toBe(true);
    expect(ss.sheet('年度請求').records().filter((c) => c['会員番号'] === no && Number(c['対象年度']) === 2026)).toHaveLength(2);
    expect(ss.sheet('出席').records().filter((a) => a['会員番号'] === no)).toHaveLength(1);
  });

  it('QR で受付できる。古いトークンの QR は使えない', () => {
    const m = ss.sheet('会員').records().find((x) => x['登録状態'] === '本登録')!;
    const qr = `CJN1:${m['会員番号']}:${m['QRトークン']}`;
    expect(call('reception.lookup', RECEPTION, { qr, eventId: 'class-2026-10-13-1000' }).ok).toBe(true);
    expect(call('reception.lookup', RECEPTION, { qr: `CJN1:${m['会員番号']}:wrongtoken123`, eventId: 'x' }).ok).toBe(false);
  });

  it('会員の編集：変更点だけを書き込み、変更履歴に残す。古い画面からの保存は止める', () => {
    const no = '001-90001';
    const got = call('member.get', OPERATOR, { memberNo: no });
    expect(got.ok).toBe(true);
    expect(Object.keys(got.member)).not.toContain('qrToken');
    const r = call('member.update', OPERATOR, {
      memberNo: no, changes: { mobile: '090-0000-9999', nickname: got.member.nickname }, expectedUpdatedAt: got.member.updatedAt, reason: '電話番号の変更の連絡',
    });
    expect(r).toMatchObject({ ok: true, diffs: [{ key: 'mobile', after: '090-0000-9999' }] });
    const log = ss.sheet('変更履歴').records().filter((l) => l['対象（会員番号など）'] === no);
    expect(log[log.length - 1]).toMatchObject({ '変更した人': 'op@example.com', '項目': '携帯電話', '変更後': '090-0000-9999', '理由・メモ': '電話番号の変更の連絡' });

    const stale = call('member.update', OPERATOR, { memberNo: no, changes: { mobile: '090-0000-1111' }, expectedUpdatedAt: got.member.updatedAt });
    expect(stale.ok).toBe(false);
    expect(call('member.update', OPERATOR, { memberNo: no, changes: { qrToken: 'x' }, expectedUpdatedAt: r.updatedAt }).ok).toBe(false);
  });

  it('会員証の再発行：トークンが変わり、古い QR は使えなくなる', () => {
    const no = '001-90002';
    const old = String(ss.sheet('会員').records().find((x) => x['会員番号'] === no)!['QRトークン']);
    const r = call('member.reissueToken', OPERATOR, { memberNo: no, reason: 'スマホを替えた' });
    expect(r.ok).toBe(true);
    expect(r.token).not.toBe(old);
    expect(call('reception.lookup', RECEPTION, { qr: `CJN1:${no}:${old}`, eventId: 'x' }).ok).toBe(false);
    expect(call('reception.lookup', RECEPTION, { qr: `CJN1:${no}:${r.token}`, eventId: 'x' }).ok).toBe(true);
  });

  it('ビューの更新：名簿と会費のシートができる', () => {
    expect(call('views.refresh', OPERATOR).ok).toBe(true);
    expect(ss.getSheetByName('名簿（全員）')?.records()).toHaveLength(40);
    expect(ss.getSheetByName('会費・保険（2026年度）')).not.toBeNull();
  });
});
