/** 支部の中の連番は 00100 から始める */
export const FIRST_SEQUENCE = 100;
const MAX_SEQUENCE = 99999;

const BRANCH_RE = /^\d{3}$/;
const MEMBER_NO_RE = /^(\d{3})-(\d{5})$/;

/** 正式な会員番号を作る。例: ('001', 123) → '001-00123' */
export function formatMemberNo(branchCode: string, sequence: number): string {
  if (!BRANCH_RE.test(branchCode)) throw new Error(`支部番号は3桁の数字です: ${branchCode}`);
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > MAX_SEQUENCE) {
    throw new Error(`連番が範囲外です: ${sequence}`);
  }
  return `${branchCode}-${String(sequence).padStart(5, '0')}`;
}

/** 会員番号を支部番号と連番に分ける */
export function parseMemberNo(memberNo: string): { branchCode: string; sequence: number } {
  const m = MEMBER_NO_RE.exec(memberNo);
  if (!m) throw new Error(`会員番号の形式が正しくありません: ${memberNo}`);
  return { branchCode: m[1], sequence: Number(m[2]) };
}

/**
 * 次の連番を返す。退会した人の番号も含めて、使った番号は再利用しない。
 * 実際の採番は、同時に2人分振らないよう GAS の LockService の中で呼ぶこと。
 */
export function nextSequence(usedSequences: readonly number[]): number {
  const max = usedSequences.reduce((a, b) => Math.max(a, b), FIRST_SEQUENCE - 1);
  const next = max + 1;
  if (next > MAX_SEQUENCE) throw new Error('会員番号の連番が上限に達しました');
  return next;
}
