/**
 * 会員証の QR の中身。会員番号と QR トークンだけを入れ、氏名や連絡先は入れない。
 *   形式1：CJN1:001-00123:トークン
 *   形式2：会員証ページの URL（…/card/?id=001-00123&t=トークン）
 */

export interface QrPayload {
  memberNo: string;
  token: string;
}

const MEMBER_NO = /^\d{3}-\d{5}$/;
const TOKEN = /^[A-Za-z0-9_-]{8,64}$/;

export function formatQrPayload(p: QrPayload): string {
  return `CJN1:${p.memberNo}:${p.token}`;
}

export function parseQrPayload(text: string): QrPayload | null {
  const t = String(text ?? '').trim();
  let memberNo = '';
  let token = '';
  const m = /^CJN1:([^:]+):([^:]+)$/.exec(t);
  if (m) {
    memberNo = m[1];
    token = m[2];
  } else if (/^https?:\/\//i.test(t)) {
    const q = t.split('?')[1]?.split('#')[0] ?? '';
    for (const part of q.split('&')) {
      const [k, v] = part.split('=');
      if (k === 'id') memberNo = decodeURIComponent(v ?? '');
      if (k === 't') token = decodeURIComponent(v ?? '');
    }
  }
  if (!MEMBER_NO.test(memberNo) || !TOKEN.test(token)) return null;
  return { memberNo, token };
}
