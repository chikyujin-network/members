/**
 * スプレッドシートのシート構成（列の定義）。
 * 1行目は日本語の見出し。プログラムは見出しの文字ではなく、この定義の順番（列の位置）で読み書きする。
 * 列を足すときは、各シートの末尾に追加する（途中に挿入すると既存のデータとずれる）。
 *
 * データの更新は、すべて画面（GAS の API）から行う。シートはシートごと保護し、
 * 運営スタッフも直接は編集しない（うっかりシートを壊さないため）。
 *   - 新規入会：本人の登録フォーム（紙の場合はスタッフが代理入力）
 *   - 既存会員の変更：運営スタッフ用の編集画面（Googleでログインした「運営」だけ）
 *   - 会費・保険・出席：受付画面
 * 変更はすべて「変更履歴」シートに、誰がいつ何を変えたかを残す。
 */

export interface ColumnDef {
  key: string; // プログラムで使う名前
  header: string; // シートの見出し（日本語）
  /** プルダウンの選択肢（入力規則） */
  options?: readonly string[];
  /** 見出しのメモ（セルのメモとして付ける） */
  note?: string;
  width?: number;
  /** 数値の列（金額・年度・口数）。それ以外は文字列として扱う */
  numeric?: boolean;
  /** システムが管理する列。編集画面からも変えられない（会員番号、QRトークン、日時など） */
  system?: boolean;
  /** 空にできない列 */
  required?: boolean;
  /** 'YYYY-MM-DD' の日付の列 */
  date?: boolean;
  /** 「、」区切りで複数選べる列の選択肢 */
  multiOptions?: readonly string[];
}

export interface SheetDef {
  name: string;
  columns: readonly ColumnDef[];
  /** 初期データ（設定シートだけ） */
  seedRows?: readonly (readonly (string | number | boolean)[])[];
}

export const MEMBER_STATUS = ['仮登録', '本登録', '退会'] as const;
export const ACTIVITY_STATUS = ['活動中', '休眠'] as const;
export const ROLES = ['学習者', '日本語ボランティア', '運営スタッフ'] as const;
export const ACTIVITIES = ['交流イベント', '日本語教室', '講座', '農園'] as const;
export const YES_NO = ['はい', 'いいえ'] as const;
export const CHARGE_KINDS = ['会費', '保険料'] as const;
export const CHARGE_STATUS = ['支払済', '免除'] as const;
export const EVENT_KINDS = ['教室', 'イベント'] as const;
export const EVENT_STATUS = ['予定', '休講', '中止'] as const;
export const CHECKIN_METHODS = ['QR', '検索', '新規'] as const;
export const SOURCES = ['フォーム', '紙', '移行'] as const;
export const STAFF_ROLES = ['運営', '受付'] as const;
export const CHANGE_ACTIONS = ['新規', '変更', '再発行', '退会'] as const;

export const MEMBERS: SheetDef = {
  name: '会員',
  columns: [
    { key: 'memberNo', header: '会員番号', note: '支部番号＋5桁（例：001-00123）。採番後は変えない', width: 100, system: true },
    { key: 'branchCode', header: '支部番号', width: 70, system: true },
    { key: 'status', header: '登録状態', options: MEMBER_STATUS, width: 80, required: true },
    { key: 'legalName', header: '登録名', note: 'パスポート・住民票と同じ表記', width: 180, required: true },
    { key: 'altName', header: '別名（旧姓・別の表記）', note: '検索専用。画面や名簿には出さない', width: 140 },
    { key: 'kana', header: 'よみ（カタカナ）', width: 160, required: true },
    { key: 'nickname', header: 'ニックネーム', width: 100, required: true },
    { key: 'membershipType', header: '会員種別', note: '設定_会員種別の名称', width: 70, required: true },
    { key: 'roles', header: '役割', note: `複数のときは「、」区切り（${ROLES.join('、')}）`, width: 140, multiOptions: ROLES },
    { key: 'activities', header: '参加したい活動', note: `複数のときは「、」区切り（${ACTIVITIES.join('、')}）`, width: 160, multiOptions: ACTIVITIES },
    { key: 'country', header: '国・地域', note: 'ISOの2文字コード（例：VN、JP）', width: 70 },
    { key: 'postalCode', header: '郵便番号', width: 90 },
    { key: 'municipality', header: '市町村', width: 90 },
    { key: 'address', header: '番地以降', width: 200 },
    { key: 'residentInSubsidyMunicipality', header: '住民票が補填自治体にある', options: YES_NO, note: '保険料の補填元の判定に使う', width: 90 },
    { key: 'mobile', header: '携帯電話', width: 120 },
    { key: 'homePhone', header: '自宅電話', width: 120 },
    { key: 'email', header: 'メール', width: 180 },
    { key: 'japaneseGoal', header: '日本語の目標', width: 160 },
    { key: 'notes', header: '所属・備考', width: 200 },
    { key: 'joinDate', header: '入会日', note: 'YYYY-MM-DD', width: 100, date: true },
    { key: 'lastAttendedDate', header: '最終参加日', note: '自動で更新。手入力しない', width: 100, system: true },
    { key: 'activityStatus', header: '活動状態', options: ACTIVITY_STATUS, note: '自動で更新。手入力しない', width: 80, system: true },
    { key: 'qrToken', header: 'QRトークン', note: '会員証のQR用。紛失時は再発行', width: 120, system: true },
    { key: 'consentAt', header: '個人情報の同意日時', width: 150, system: true },
    { key: 'guardianConsent', header: '保護者の同意', options: YES_NO, width: 90 },
    { key: 'source', header: '登録経路', options: SOURCES, width: 80, system: true },
    { key: 'createdAt', header: '作成日時', width: 150, system: true },
    { key: 'updatedAt', header: '更新日時', width: 150, system: true },
  ],
};

export const CHARGES: SheetDef = {
  name: '年度請求',
  columns: [
    { key: 'chargeId', header: '請求ID', width: 120 },
    { key: 'branchCode', header: '支部番号', width: 70 },
    { key: 'memberNo', header: '会員番号', width: 100 },
    { key: 'fiscalYear', header: '対象年度', width: 70, numeric: true },
    { key: 'kind', header: '種類', options: CHARGE_KINDS, width: 70 },
    { key: 'units', header: '口数', width: 50, numeric: true },
    { key: 'amount', header: '金額', note: '保険料は総額', width: 70, numeric: true },
    { key: 'selfPay', header: '本人負担額', width: 80, numeric: true },
    { key: 'subsidy', header: '補填額', width: 70, numeric: true },
    { key: 'subsidySource', header: '補填元', width: 90 },
    { key: 'status', header: '状態', options: CHARGE_STATUS, width: 70 },
    { key: 'receivedDate', header: '受領日', note: 'YYYY-MM-DD。古い年度の移行分は空欄（日付不明）', width: 100 },
    { key: 'receivedBy', header: '受領者', width: 90 },
    { key: 'handedToTreasurerDate', header: '会計への引渡日', width: 110 },
    { key: 'notes', header: '備考', width: 200 },
    { key: 'recordedAt', header: '記録日時', width: 150 },
  ],
};

export const EVENTS: SheetDef = {
  name: 'イベント',
  columns: [
    { key: 'eventId', header: 'イベントID', width: 160 },
    { key: 'branchCode', header: '支部番号', width: 70 },
    { key: 'kind', header: '種別', options: EVENT_KINDS, width: 70 },
    { key: 'title', header: '名称', width: 200 },
    { key: 'date', header: '開催日', width: 100 },
    { key: 'startTime', header: '開始', width: 60 },
    { key: 'endTime', header: '終了', width: 60 },
    { key: 'venue', header: '会場', width: 140 },
    { key: 'status', header: '状態', options: EVENT_STATUS, width: 70 },
    { key: 'notes', header: '備考', width: 200 },
  ],
};

export const ATTENDANCE: SheetDef = {
  name: '出席',
  columns: [
    { key: 'attendanceId', header: '出席ID', width: 140 },
    { key: 'eventId', header: 'イベントID', width: 160 },
    { key: 'eventBranchCode', header: 'イベントの支部番号', width: 110 },
    { key: 'memberNo', header: '会員番号', width: 100 },
    { key: 'memberBranchCode', header: '会員の支部番号', width: 100 },
    { key: 'checkedInAt', header: '受付時刻', width: 150 },
    { key: 'method', header: '受付方法', options: CHECKIN_METHODS, width: 80 },
    { key: 'checkedInBy', header: '受付者', width: 160 },
  ],
};

/** 支部の基本設定（項目と値の2列） */
export const SETTINGS: SheetDef = {
  name: '設定',
  columns: [
    { key: 'key', header: '項目', width: 220 },
    { key: 'value', header: '値', width: 260 },
    { key: 'description', header: '説明', width: 360 },
  ],
  seedRows: [
    ['支部番号', '001', '3桁の数字'],
    ['支部名', '地球人ネットワークinこまがね', ''],
    ['年度の始まりの月', 4, '1〜12'],
    ['免除する入会月', '1,2,3', 'この月に入会した人は、入会した年度の会費を免除する。カンマ区切り。なければ空欄'],
    ['保険を扱う', 'はい', 'はい／いいえ'],
    ['補填する自治体', '駒ヶ根市', '住民票がこの自治体にある人は、保険料の補填元がこの自治体になる'],
    ['補填元（それ以外）', 'ちきゅうじん', '補填する自治体に住民票がない人の補填元'],
    ['フォームの言語', 'ja-easy,en,vi,id', 'カンマ区切り'],
  ],
};

export const SETTINGS_MEMBERSHIP_TYPES: SheetDef = {
  name: '設定_会員種別',
  columns: [
    { key: 'id', header: '種別ID', note: '英字。変えない', width: 100 },
    { key: 'label', header: '名称', width: 100 },
    { key: 'feePerUnit', header: '1口の会費', width: 90, numeric: true },
    { key: 'allowMultipleUnits', header: '複数口', options: YES_NO, width: 70 },
    { key: 'fromFiscalYear', header: '適用開始年度', note: '金額が変わったら、新しい年度の行を足す', width: 100, numeric: true },
  ],
  seedRows: [
    ['general', '一般', 500, 'いいえ', 2026],
    ['supporting', '賛助', 500, 'はい', 2026],
  ],
};

export const SETTINGS_INSURANCE: SheetDef = {
  name: '設定_保険',
  columns: [
    { key: 'fromFiscalYear', header: '適用開始年度', width: 100, numeric: true },
    { key: 'premium', header: '保険料（総額）', width: 110, numeric: true },
    { key: 'subsidy', header: '補填額', width: 80, numeric: true },
  ],
  seedRows: [[2026, 500, 170]],
};

export const SETTINGS_CLASS_SCHEDULE: SheetDef = {
  name: '設定_教室日程',
  columns: [
    { key: 'weekday', header: '曜日', options: ['日', '月', '火', '水', '木', '金', '土'], width: 50 },
    { key: 'startTime', header: '開始', note: 'HH:MM', width: 60 },
    { key: 'endTime', header: '終了', note: 'HH:MM', width: 60 },
    { key: 'venue', header: '会場', width: 140 },
    { key: 'validFrom', header: '適用開始日', note: 'YYYY-MM-DD', width: 100 },
    { key: 'validTo', header: '適用終了日', note: 'YYYY-MM-DD。空欄なら無期限', width: 100 },
  ],
  seedRows: [
    ['火', '10:00', '11:30', 'ふれあいセンター', '2026-04-01', ''],
    ['水', '19:00', '20:30', 'ふれあいセンター', '2026-04-01', ''],
    ['土', '10:00', '11:30', 'ふれあいセンター', '2026-04-01', ''],
  ],
};

export const SETTINGS_STAFF: SheetDef = {
  name: '設定_スタッフ',
  columns: [
    { key: 'email', header: 'Googleアカウント（メール）', width: 240 },
    { key: 'name', header: '名前', width: 120 },
    { key: 'role', header: '権限', options: STAFF_ROLES, note: '運営：名簿全体、受付：受付画面のみ', width: 70 },
    { key: 'active', header: '有効', options: YES_NO, width: 60 },
  ],
};

/** 変更履歴：画面から行った変更を1項目1行で残す。追記だけで、消したり書き換えたりしない */
export const CHANGE_LOG: SheetDef = {
  name: '変更履歴',
  columns: [
    { key: 'changedAt', header: '日時', width: 150 },
    { key: 'changedBy', header: '変更した人', width: 200 },
    { key: 'sheet', header: 'シート', width: 80 },
    { key: 'recordId', header: '対象（会員番号など）', width: 120 },
    { key: 'action', header: '操作', options: CHANGE_ACTIONS, width: 70 },
    { key: 'field', header: '項目', width: 140 },
    { key: 'before', header: '変更前', width: 200 },
    { key: 'after', header: '変更後', width: 200 },
    { key: 'reason', header: '理由・メモ', width: 200 },
  ],
};

/** 元データのシート（順番どおりに作る） */
export const ALL_SHEETS: readonly SheetDef[] = [
  MEMBERS,
  CHARGES,
  EVENTS,
  ATTENDANCE,
  SETTINGS,
  SETTINGS_MEMBERSHIP_TYPES,
  SETTINGS_INSURANCE,
  SETTINGS_CLASS_SCHEDULE,
  SETTINGS_STAFF,
  CHANGE_LOG,
];

/** 列のキーから、1始まりの列番号を返す */
export function columnIndex(sheet: SheetDef, key: string): number {
  const i = sheet.columns.findIndex((c) => c.key === key);
  if (i < 0) throw new Error(`${sheet.name} に列 ${key} はありません`);
  return i + 1;
}
