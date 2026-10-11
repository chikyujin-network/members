import { describe, expect, it } from 'vitest';
import { FIRST_SEQUENCE, formatMemberNo, nextSequence, parseMemberNo } from '../gas/src/domain/memberNo';

describe('会員番号', () => {
  it('支部番号3桁＋5桁の連番', () => {
    expect(formatMemberNo('001', 123)).toBe('001-00123');
    expect(parseMemberNo('001-00123')).toEqual({ branchCode: '001', sequence: 123 });
  });

  it('支部番号が3桁の数字でなければ例外', () => {
    expect(() => formatMemberNo('1', 123)).toThrow();
    expect(() => formatMemberNo('KM1', 123)).toThrow();
  });

  it('最初の連番は 00100', () => {
    expect(nextSequence([])).toBe(FIRST_SEQUENCE);
    expect(formatMemberNo('001', nextSequence([]))).toBe('001-00100');
  });

  it('使った番号の最大＋1。退会者の番号を含め、空き番は再利用しない', () => {
    expect(nextSequence([100, 101, 105])).toBe(106);
  });
});
