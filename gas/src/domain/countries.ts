/**
 * 国・地域コード（ISO 3166-1 の2文字）と日本語名。名簿の表示に使う。
 * 一覧にないコードは、コードのまま表示する。支部ごとの違いはないので、ここで持つ。
 */
export const COUNTRY_NAMES_JA: Readonly<Record<string, string>> = {
  JP: '日本',
  VN: 'ベトナム',
  ID: 'インドネシア',
  PH: 'フィリピン',
  CN: '中国',
  TW: '台湾',
  KR: '韓国',
  TH: 'タイ',
  MM: 'ミャンマー',
  KH: 'カンボジア',
  MY: 'マレーシア',
  MN: 'モンゴル',
  NP: 'ネパール',
  IN: 'インド',
  LK: 'スリランカ',
  BD: 'バングラデシュ',
  UZ: 'ウズベキスタン',
  BR: 'ブラジル',
  PE: 'ペルー',
  BO: 'ボリビア',
  CL: 'チリ',
  EC: 'エクアドル',
  AR: 'アルゼンチン',
  CO: 'コロンビア',
  PY: 'パラグアイ',
  MX: 'メキシコ',
  US: 'アメリカ',
  CA: 'カナダ',
  GB: 'イギリス',
  FR: 'フランス',
  DE: 'ドイツ',
  ES: 'スペイン',
  RU: 'ロシア',
  MA: 'モロッコ',
  AU: 'オーストラリア',
  VU: 'バヌアツ',
};

export function countryNameJa(code: string): string {
  const c = code.trim().toUpperCase();
  return COUNTRY_NAMES_JA[c] ?? c;
}
