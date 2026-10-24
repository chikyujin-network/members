/**
 * 受付と会員編集の画面で使う、会員の検索。GAS に依存しない純粋な関数。
 * 会員番号（下の桁だけでもよい）、ニックネーム、よみ、登録名、別名で探す。
 * 全角・半角、ひらがな・カタカナ、大文字・小文字、空白や「・」の違いは無視する。
 */

export type SearchRow = Readonly<Record<string, string | number>>;

const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** 検索用に文字をそろえる */
export function normalizeForSearch(text: string): string {
  return s(text)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)) // ひらがな → カタカナ
    .replace(/ヶ/g, 'ケ')
    .replace(/[\s・･.\-‐_]/g, ''); // 空白・中点・記号は除く（長音「ー」は残す）
}

const NAME_FIELDS = ['nickname', 'kana', 'legalName', 'altName'] as const;

/**
 * @returns 当てはまる会員を、よく当てはまる順に最大 limit 件。退会した人は後ろに回す
 */
export function searchMembers(members: readonly SearchRow[], query: string, limit = 30): SearchRow[] {
  const raw = s(query).normalize('NFKC').trim();
  if (raw === '') return [];

  // 数字だけ（またはハイフン付き）なら会員番号で探す。「123」で 001-00123 に当たる
  if (/^[\d-]+$/.test(raw)) {
    const digits = raw.replace(/-/g, '');
    const hits = members.filter((m) => {
      const no = s(m.memberNo);
      const flat = no.replace(/-/g, '');
      return no === raw || flat === digits || (digits.length >= 2 && flat.endsWith(digits));
    });
    return sortHits(hits.map((m) => ({ m, score: s(m.memberNo) === raw ? 100 : 50 })), limit);
  }

  const q = normalizeForSearch(raw);
  if (q === '') return [];
  const scored: { m: SearchRow; score: number }[] = [];
  for (const m of members) {
    let best = 0;
    for (const f of NAME_FIELDS) {
      const v = normalizeForSearch(s(m[f]));
      if (!v) continue;
      if (v === q) best = Math.max(best, f === 'nickname' ? 100 : 90);
      else if (v.startsWith(q)) best = Math.max(best, f === 'nickname' ? 80 : 70);
      else if (v.includes(q)) best = Math.max(best, 40);
    }
    if (best > 0) scored.push({ m, score: best });
  }
  return sortHits(scored, limit);
}

function sortHits(hits: { m: SearchRow; score: number }[], limit: number): SearchRow[] {
  const retired = (m: SearchRow) => (s(m.status) === '退会' ? 1 : 0);
  return hits
    .sort((a, b) => retired(a.m) - retired(b.m) || b.score - a.score || s(a.m.kana).localeCompare(s(b.m.kana), 'ja'))
    .slice(0, limit)
    .map((h) => h.m);
}
