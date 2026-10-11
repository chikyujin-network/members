/**
 * ドメインの型定義。
 * 日付はすべて 'YYYY-MM-DD' 形式の文字列で扱う（タイムゾーンのずれを避けるため）。
 */

/** 'YYYY-MM-DD' 形式の日付文字列 */
export type DateString = string;

/** 請求の種類 */
export type ChargeKind = 'membership' | 'insurance';

/** 年度請求の状態 */
export type ChargeStatus = 'paid' | 'exempt';

/** 年度請求シートの1行（判定に必要な項目だけ） */
export interface Charge {
  fiscalYear: number;
  kind: ChargeKind;
  status: ChargeStatus;
}

/** 会員種別の設定（支部ごと） */
export interface MembershipTypeSetting {
  id: string; // 例: 'general', 'supporting'
  label: string; // 例: '一般', '賛助'
  feePerUnit: number; // 1口あたりの会費（円）
  allowMultipleUnits: boolean; // 複数口を認めるか（賛助など）
}

/** 保険の設定（支部ごと・年度ごと） */
export interface InsuranceSetting {
  enabled: boolean;
  premium: number; // 保険料の総額（円）
  subsidy: number; // 補填額（円）
  /** 補填する自治体の名前。例: '駒ヶ根市' */
  subsidyMunicipality: string;
  /** 補填元が自治体でない場合の名前。例: 'ちきゅうじん' */
  fallbackSubsidySource: string;
}

/** 支部の設定（設定シートから読み込む） */
export interface BranchSettings {
  branchCode: string; // 3桁。例: '001'
  /** 年度の始まりの月（1〜12）。駒ヶ根は 4 */
  fiscalYearStartMonth: number;
  /** この月に入会した人は、入会した年度の会費を免除する。駒ヶ根は [1, 2, 3] */
  exemptJoinMonths: number[];
  membershipTypes: MembershipTypeSetting[];
  insurance: InsuranceSetting;
}

/** 会費判定に使う会員情報 */
export interface MemberForFee {
  joinDate: DateString;
  membershipTypeId: string;
  /** 口数。一般は 1 */
  units: number;
}
