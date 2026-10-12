import type { ColumnDef } from '../schema';
import { parseDate } from './dates';

/**
 * 運営スタッフの編集画面から来た「会員の変更」を確かめ、変更する項目の一覧を作る。
 * GAS に依存しないので、単体テストできる。実際の書き込みと変更履歴の追記は GAS 側で行う。
 */

export type MemberRecord = Readonly<Record<string, string>>;

export interface FieldDiff {
  key: string;
  header: string;
  before: string;
  after: string;
}

export interface EditContext {
  /** 設定_会員種別にある名称（例：['一般', '賛助']）。会員種別の値の確認に使う */
  membershipTypeLabels: readonly string[];
}

export type EditPlan = { ok: true; diffs: FieldDiff[] } | { ok: false; error: string };

const MULTI_SEP = /[、,]\s*/;

function normalize(col: ColumnDef, raw: unknown): string {
  const v = String(raw ?? '').trim();
  if (!col.multiOptions) return v;
  // 複数選択は、選択肢の順番にそろえて「、」でつなぐ（順番違いを変更と見なさないため）
  const picked = new Set(v.split(MULTI_SEP).filter(Boolean));
  return col.multiOptions.filter((o) => picked.has(o)).join('、');
}

function validate(col: ColumnDef, value: string, ctx: EditContext): string | null {
  if (col.required && value === '') return `「${col.header}」は空にできません`;
  if (value === '') return null;
  if (col.options && !col.options.includes(value)) return `「${col.header}」の値が選択肢にありません: ${value}`;
  if (col.key === 'membershipType' && !ctx.membershipTypeLabels.includes(value)) {
    return `「${col.header}」の値が設定にありません: ${value}`;
  }
  if (col.date) {
    try {
      parseDate(value);
    } catch {
      return `「${col.header}」は YYYY-MM-DD の形で入れてください: ${value}`;
    }
  }
  return null;
}

/**
 * @param columns  会員シートの列定義
 * @param current  今のシートの値（列のキー → 値）
 * @param changes  画面から来た変更（列のキー → 新しい値）。変えない項目は含めなくてよい
 * @param expectedUpdatedAt  画面で編集を始めたときの「更新日時」。今の値と違えば、ほかの人が先に更新している
 */
export function planMemberEdit(
  columns: readonly ColumnDef[],
  current: MemberRecord,
  changes: Readonly<Record<string, unknown>>,
  expectedUpdatedAt: string,
  ctx: EditContext,
): EditPlan {
  if ((current.updatedAt ?? '') !== expectedUpdatedAt) {
    return { ok: false, error: 'ほかの人が先にこの会員を更新しました。画面を読み込み直してから、もう一度変更してください' };
  }
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const diffs: FieldDiff[] = [];
  for (const [key, raw] of Object.entries(changes)) {
    const col = byKey.get(key);
    if (!col) return { ok: false, error: `会員シートに項目 ${key} はありません` };
    if (col.system) return { ok: false, error: `「${col.header}」はシステムが管理する項目なので変更できません` };
    const after = normalize(col, raw);
    if (col.multiOptions && String(raw ?? '').trim() !== '' && after === '') {
      return { ok: false, error: `「${col.header}」の値が選択肢にありません: ${String(raw)}` };
    }
    const error = validate(col, after, ctx);
    if (error) return { ok: false, error };
    const before = normalize(col, current[key]);
    if (before !== after) diffs.push({ key, header: col.header, before: String(current[key] ?? ''), after });
  }
  // 列の並び順にそろえる（変更履歴を読みやすくするため）
  const order = new Map(columns.map((c, i) => [c.key, i]));
  diffs.sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
  return { ok: true, diffs };
}
