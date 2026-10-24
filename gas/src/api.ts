import { verifyStaff } from './auth';
import { classEventToRow, planCheckin, summarizeForReception } from './domain/checkin';
import { generateClassEvents } from './domain/classSchedule';
import { planMemberEdit } from './domain/memberEdit';
import { parseQrPayload } from './domain/qr';
import { searchMembers } from './domain/search';
import { parseClassSchedule, type StaffEntry } from './domain/settingsParse';
import type { BranchSettings } from './domain/types';
import { ATTENDANCE, CHANGE_LOG, CHARGES, EVENTS, MEMBERS, SETTINGS_CLASS_SCHEDULE } from './schema';
import {
  appendRecords,
  findRowNumber,
  getSheet,
  loadBranchSettings,
  nowJst,
  openSpreadsheet,
  readRecords,
  readRows,
  todayJst,
  updateRow,
} from './sheetIO';
import { refreshViews } from './views';

/**
 * スタッフ用画面（受付・会員編集）の API。すべて「Googleでログイン」の ID トークンが必要。
 * 権限：受付 … 検索・受付。運営 … それに加えて会員の編集・会員証の再発行・ビューの更新。
 */

type Json = Record<string, unknown>;
type Body = Record<string, unknown>;
type Ctx = { staff: StaffEntry; ss: GoogleAppsScript.Spreadsheet.Spreadsheet; today: string; settings: BranchSettings };

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

/** 受付画面に返す、会員の情報（連絡先や住所は返さない） */
const SUMMARY_KEYS = ['memberNo', 'status', 'legalName', 'kana', 'nickname', 'membershipType', 'roles', 'country', 'municipality', 'activityStatus', 'joinDate', 'lastAttendedDate', 'residentInSubsidyMunicipality', 'guardianConsent'] as const;
function summary(m: Record<string, string | number>): Json {
  const o: Json = {};
  for (const k of SUMMARY_KEYS) o[k] = m[k] ?? '';
  return o;
}

const HANDLERS: Record<string, { role: '受付' | '運営'; run: (ctx: Ctx, body: Body) => Json }> = {
  'staff.bootstrap': { role: '受付', run: bootstrap },
  'members.search': { role: '受付', run: search },
  'reception.lookup': { role: '受付', run: lookup },
  'reception.checkin': { role: '受付', run: checkin },
  'member.get': { role: '運営', run: memberGet },
  'member.update': { role: '運営', run: memberUpdate },
  'member.reissueToken': { role: '運営', run: reissueToken },
  'views.refresh': { role: '運営', run: () => ({ ok: true, message: refreshViews() }) },
};

export function isStaffAction(action: string): boolean {
  return action in HANDLERS;
}

export function handleStaffAction(action: string, body: Body): Json {
  const h = HANDLERS[action];
  const auth = verifyStaff(body.idToken);
  if (!auth.ok) return { ok: false, error: auth.error, needLogin: true };
  if (h.role === '運営' && auth.staff.role !== '運営') return { ok: false, error: 'この操作は「運営」の権限が必要です' };
  const ss = openSpreadsheet();
  const today = todayJst();
  const settings = loadBranchSettings(ss, today);
  return h.run({ staff: auth.staff, ss, today, settings }, body);
}

function bootstrap(ctx: Ctx): Json {
  return {
    ok: true,
    staff: ctx.staff,
    today: ctx.today,
    events: todaysEvents(ctx),
    settings: {
      branchCode: ctx.settings.branchCode,
      membershipTypes: ctx.settings.membershipTypes.map((t) => ({ label: t.label, fee: t.feePerUnit })),
      insuranceEnabled: ctx.settings.insurance.enabled,
      insuranceSelfPay: ctx.settings.insurance.premium - ctx.settings.insurance.subsidy,
      subsidyMunicipality: ctx.settings.insurance.subsidyMunicipality,
    },
  };
}

/** 今日のイベント。教室は設定_教室日程から自動で作る（まだなければイベントシートに追加） */
function todaysEvents(ctx: Ctx): Json[] {
  const sheet = getSheet(ctx.ss, EVENTS);
  const existing = readRecords(ctx.ss, EVENTS);
  const rules = parseClassSchedule(readRows(ctx.ss, SETTINGS_CLASS_SCHEDULE) as (string | number)[][]);
  const missing = generateClassEvents(rules, ctx.today, ctx.today)
    .filter((e) => !existing.some((x) => str(x.eventId) === e.eventKey))
    .map((e) => classEventToRow(e, ctx.settings.branchCode));
  if (missing.length) {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const again = readRecords(ctx.ss, EVENTS);
      appendRecords(sheet, EVENTS, missing.filter((e) => !again.some((x) => str(x.eventId) === e.eventId)));
    } finally {
      lock.releaseLock();
    }
  }
  return [...existing, ...missing]
    .filter((e) => str(e.date) === ctx.today && str(e.status) === '予定')
    .sort((a, b) => str(a.startTime).localeCompare(str(b.startTime)))
    .map((e) => ({ eventId: e.eventId, title: e.title, startTime: e.startTime, endTime: e.endTime, venue: e.venue, branchCode: e.branchCode }));
}

function search(ctx: Ctx, body: Body): Json {
  const q = str(body.q);
  if (q.length > 50) return { ok: false, error: '検索の言葉が長すぎます' };
  const hits = searchMembers(readRecords(ctx.ss, MEMBERS), q, 30);
  return { ok: true, members: hits.map((m) => summary(m as Record<string, string | number>)) };
}

function findMember(ctx: Ctx, body: Body): { member: Record<string, string | number> } | { error: string } {
  const members = readRecords(ctx.ss, MEMBERS);
  if (body.qr) {
    const p = parseQrPayload(str(body.qr));
    if (!p) return { error: '会員証の QR ではありません' };
    const m = members.find((x) => str(x.memberNo) === p.memberNo);
    if (!m || str(m.qrToken) !== p.token) return { error: 'この会員証は使えません（再発行された古い会員証の可能性があります）' };
    return { member: m };
  }
  const m = members.find((x) => str(x.memberNo) === str(body.memberNo));
  return m ? { member: m } : { error: '会員が見つかりません' };
}

function lookup(ctx: Ctx, body: Body): Json {
  const found = findMember(ctx, body);
  if ('error' in found) return { ok: false, error: found.error };
  const no = str(found.member.memberNo);
  const charges = readRecords(ctx.ss, CHARGES).filter((c) => str(c.memberNo) === no);
  const attendance = readRecords(ctx.ss, ATTENDANCE).filter((a) => str(a.memberNo) === no);
  return {
    ok: true,
    member: summary(found.member),
    reception: summarizeForReception(found.member, charges, attendance, ctx.settings, ctx.today, str(body.eventId)),
  };
}

function checkin(ctx: Ctx, body: Body): Json {
  const eventId = str(body.eventId);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const event = readRecords(ctx.ss, EVENTS).find((e) => str(e.eventId) === eventId);
    if (!event) return { ok: false, error: 'イベントが見つかりません。画面を読み込み直してください' };
    const found = findMember(ctx, body);
    if ('error' in found) return { ok: false, error: found.error };
    const member = found.member;
    const no = str(member.memberNo);
    const charges = readRecords(ctx.ss, CHARGES).filter((c) => str(c.memberNo) === no);
    const attendance = readRecords(ctx.ss, ATTENDANCE).filter((a) => str(a.memberNo) === no);
    const method = str(body.method) === 'QR' ? 'QR' : str(body.method) === '新規' ? '新規' : '検索';
    const resident = str(body.residentAnswer);
    const plan = planCheckin(member, charges, attendance, ctx.settings, {
      today: ctx.today,
      now: nowJst(),
      staffEmail: ctx.staff.email,
      event: { eventId, branchCode: str(event.branchCode) },
      method,
      feeReceived: body.feeReceived === true,
      joinInsurance: body.joinInsurance === true,
      ...(resident === 'はい' || resident === 'いいえ' ? { residentAnswer: resident } : {}),
    });
    if (!plan.ok) return plan;

    appendRecords(getSheet(ctx.ss, CHARGES), CHARGES, plan.charges);
    if (plan.attendance) appendRecords(getSheet(ctx.ss, ATTENDANCE), ATTENDANCE, [plan.attendance]);
    if (Object.keys(plan.memberUpdates).length) {
      const sheet = getSheet(ctx.ss, MEMBERS);
      updateRow(sheet, MEMBERS, findRowNumber(sheet, MEMBERS, 'memberNo', no), plan.memberUpdates);
    }
    appendRecords(getSheet(ctx.ss, CHANGE_LOG), CHANGE_LOG, plan.changeLog);
    return { ok: true, messages: plan.messages };
  } finally {
    lock.releaseLock();
  }
}

/** 編集画面で使う列の情報 */
function editableColumns(): Json[] {
  return MEMBERS.columns.map((c) => ({
    key: c.key,
    header: c.header,
    system: !!c.system,
    required: !!c.required,
    date: !!c.date,
    options: c.options ?? null,
    multiOptions: c.multiOptions ?? null,
    note: c.note ?? '',
  }));
}

function memberGet(ctx: Ctx, body: Body): Json {
  const found = findMember(ctx, body);
  if ('error' in found) return { ok: false, error: found.error };
  const { qrToken: _hidden, ...member } = found.member;
  return {
    ok: true,
    member,
    columns: editableColumns().filter((c) => c.key !== 'qrToken'),
    membershipTypes: ctx.settings.membershipTypes.map((t) => t.label),
  };
}

function memberUpdate(ctx: Ctx, body: Body): Json {
  const changes = (body.changes && typeof body.changes === 'object' ? body.changes : {}) as Record<string, unknown>;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet(ctx.ss, MEMBERS);
    const found = findMember(ctx, body);
    if ('error' in found) return { ok: false, error: found.error };
    const current = Object.fromEntries(Object.entries(found.member).map(([k, v]) => [k, String(v)]));
    const plan = planMemberEdit(MEMBERS.columns, current, changes, str(body.expectedUpdatedAt), {
      membershipTypeLabels: ctx.settings.membershipTypes.map((t) => t.label),
    });
    if (!plan.ok) return plan;
    if (plan.diffs.length === 0) return { ok: true, diffs: [], message: '変更はありませんでした' };
    const now = nowJst();
    const updates: Record<string, string> = Object.fromEntries(plan.diffs.map((d) => [d.key, d.after]));
    updates.updatedAt = now;
    updateRow(sheet, MEMBERS, findRowNumber(sheet, MEMBERS, 'memberNo', current.memberNo), updates);
    const reason = str(body.reason).slice(0, 200);
    appendRecords(
      getSheet(ctx.ss, CHANGE_LOG),
      CHANGE_LOG,
      plan.diffs.map((d) => ({
        changedAt: now,
        changedBy: ctx.staff.email,
        sheet: '会員',
        recordId: current.memberNo,
        action: d.key === 'status' && d.after === '退会' ? '退会' : '変更',
        field: d.header,
        before: d.before,
        after: d.after,
        reason,
      })),
    );
    return { ok: true, diffs: plan.diffs, updatedAt: now };
  } finally {
    lock.releaseLock();
  }
}

function reissueToken(ctx: Ctx, body: Body): Json {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet(ctx.ss, MEMBERS);
    const found = findMember(ctx, body);
    if ('error' in found) return { ok: false, error: found.error };
    const no = str(found.member.memberNo);
    const token = Utilities.getUuid().replace(/-/g, '');
    const now = nowJst();
    updateRow(sheet, MEMBERS, findRowNumber(sheet, MEMBERS, 'memberNo', no), { qrToken: token, updatedAt: now });
    appendRecords(getSheet(ctx.ss, CHANGE_LOG), CHANGE_LOG, [
      { changedAt: now, changedBy: ctx.staff.email, sheet: '会員', recordId: no, action: '再発行', field: 'QRトークン', before: '（非表示）', after: '（非表示）', reason: str(body.reason).slice(0, 200) },
    ]);
    return { ok: true, memberNo: no, token, updatedAt: now };
  } finally {
    lock.releaseLock();
  }
}
