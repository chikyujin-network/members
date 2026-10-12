import { addDays, fiscalYearOf, parseDate } from './dates';
import { DUMMY_SEQUENCE_FROM, formatMemberNo, parseMemberNo } from './memberNo';
import { ACTIVITIES, CHARGES, MEMBERS, ROLES } from '../schema';
import type { BranchSettings, DateString } from './types';

/**
 * テスト用のダミーデータを作る（GAS の API は使わない純粋な関数）。
 * 同じ引数なら、いつでも同じデータになる。
 * 氏名・電話・メールはすべて架空の値で、実在の人とは関係がない。
 */

/** ダミーの会員番号の連番はここから始める（これ以上ならダミー） */
export const DUMMY_SEQUENCE_START = DUMMY_SEQUENCE_FROM;
export const DUMMY_NOTE = 'ダミーデータ';

export interface DummyOptions {
  count: number;
  seed: number;
  today: DateString;
  settings: BranchSettings;
}

export interface DummyData {
  members: Record<string, string>[];
  charges: Record<string, string | number>[];
}

/** ダミーの会員番号か（連番が 90000 以上） */
export function isDummyMemberNo(memberNo: string): boolean {
  try {
    return parseMemberNo(memberNo).sequence >= DUMMY_SEQUENCE_START;
  } catch {
    return false;
  }
}

// ---- 乱数（シード付き） ----

/** mulberry32：シードが同じなら同じ並びを返す小さな乱数 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  private next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  float(): number {
    return this.next();
  }
  /** 0 以上 n 未満の整数 */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  /** min 以上 max 以下の整数 */
  between(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(list: readonly T[]): T {
    return list[this.int(list.length)];
  }
  /** 重みつきで選ぶ */
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    const total = entries.reduce((s, e) => s + e[1], 0);
    let r = this.next() * total;
    for (const [v, w] of entries) {
      r -= w;
      if (r < 0) return v;
    }
    return entries[entries.length - 1][0];
  }
  /** 重複なしで n 個選ぶ */
  sample<T>(list: readonly T[], n: number): T[] {
    const rest = [...list];
    const out: T[] = [];
    while (out.length < n && rest.length > 0) out.push(rest.splice(this.int(rest.length), 1)[0]);
    return out;
  }
}

// ---- 架空の名前（どこにでもある名前の組み合わせ） ----

type Pair = readonly [string, string]; // [表記, カタカナ]

const JP_SURNAMES: Pair[] = [
  ['佐藤', 'サトウ'], ['鈴木', 'スズキ'], ['高橋', 'タカハシ'], ['田中', 'タナカ'],
  ['伊藤', 'イトウ'], ['渡辺', 'ワタナベ'], ['山本', 'ヤマモト'], ['中村', 'ナカムラ'],
  ['小林', 'コバヤシ'], ['加藤', 'カトウ'], ['吉田', 'ヨシダ'], ['山田', 'ヤマダ'],
];
const JP_GIVEN: Pair[] = [
  ['太郎', 'タロウ'], ['花子', 'ハナコ'], ['健一', 'ケンイチ'], ['美咲', 'ミサキ'],
  ['大輔', 'ダイスケ'], ['陽子', 'ヨウコ'], ['誠', 'マコト'], ['愛', 'アイ'],
  ['翔太', 'ショウタ'], ['恵子', 'ケイコ'], ['結衣', 'ユイ'], ['拓也', 'タクヤ'],
];

const FOREIGN_NAMES: Record<string, { surnames: Pair[]; given: Pair[] }> = {
  VN: {
    surnames: [['NGUYEN', 'グエン'], ['TRAN', 'チャン'], ['LE', 'レー'], ['PHAM', 'ファム']],
    given: [['Thi Lan', 'ティラン'], ['Van Nam', 'ヴァンナム'], ['Minh Anh', 'ミンアイン'], ['Thu Ha', 'トゥーハー']],
  },
  ID: {
    surnames: [['SUSANTO', 'スサント'], ['WIJAYA', 'ウィジャヤ'], ['PRATAMA', 'プラタマ'], ['SARI', 'サリ']],
    given: [['Budi', 'ブディ'], ['Dewi', 'デウィ'], ['Agus', 'アグス'], ['Putri', 'プトリ']],
  },
  PH: {
    surnames: [['SANTOS', 'サントス'], ['REYES', 'レイエス'], ['CRUZ', 'クルス'], ['GARCIA', 'ガルシア']],
    given: [['Maria', 'マリア'], ['Jose', 'ホセ'], ['Angela', 'アンヘラ'], ['Mark', 'マーク']],
  },
  CN: {
    surnames: [['WANG', 'ワン'], ['LI', 'リー'], ['ZHANG', 'チャン'], ['LIU', 'リュウ']],
    given: [['Wei', 'ウェイ'], ['Fang', 'ファン'], ['Jing', 'ジン'], ['Lei', 'レイ']],
  },
  TH: {
    surnames: [['SRISAWAT', 'シーサワット'], ['CHAIYA', 'チャイヤ'], ['WONGSA', 'ウォンサ'], ['PHANICH', 'パーニット']],
    given: [['Somying', 'ソムイン'], ['Anan', 'アナン'], ['Napat', 'ナパット'], ['Malee', 'マリー']],
  },
  BR: {
    surnames: [['SILVA', 'シウバ'], ['SOUZA', 'ソウザ'], ['OLIVEIRA', 'オリベイラ'], ['PEREIRA', 'ペレイラ']],
    given: [['Ana', 'アナ'], ['Lucas', 'ルーカス'], ['Juliana', 'ジュリアナ'], ['Rafael', 'ハファエル']],
  },
  PE: {
    surnames: [['QUISPE', 'キスペ'], ['FLORES', 'フロレス'], ['RAMOS', 'ラモス'], ['TORRES', 'トレス']],
    given: [['Carlos', 'カルロス'], ['Rosa', 'ロサ'], ['Luis', 'ルイス'], ['Elena', 'エレナ']],
  },
  NP: {
    surnames: [['THAPA', 'タパ'], ['SHRESTHA', 'シュレスタ'], ['GURUNG', 'グルン'], ['RAI', 'ライ']],
    given: [['Sita', 'シタ'], ['Ram', 'ラム'], ['Anita', 'アニタ'], ['Bishal', 'ビシャル']],
  },
  KR: {
    surnames: [['KIM', 'キム'], ['LEE', 'イ'], ['PARK', 'パク'], ['CHOI', 'チェ']],
    given: [['Minjun', 'ミンジュン'], ['Seoyeon', 'ソヨン'], ['Jiho', 'ジホ'], ['Yuna', 'ユナ']],
  },
  LK: {
    surnames: [['PERERA', 'ペレラ'], ['FERNANDO', 'フェルナンド'], ['JAYASINGHE', 'ジャヤシンハ'], ['WIJESEKARA', 'ウィジェセーカラ']],
    given: [['Nimal', 'ニマル'], ['Kumari', 'クマリ'], ['Sunil', 'スニル'], ['Dilani', 'ディラニ']],
  },
  US: {
    surnames: [['SMITH', 'スミス'], ['JOHNSON', 'ジョンソン'], ['BROWN', 'ブラウン'], ['MILLER', 'ミラー']],
    given: [['John', 'ジョン'], ['Emily', 'エミリー'], ['Michael', 'マイケル'], ['Sarah', 'セーラ']],
  },
};

/** 国の出現割合（JP が約半分） */
const COUNTRY_WEIGHTS: (readonly [string, number])[] = [
  ['JP', 50], ['VN', 10], ['ID', 7], ['PH', 7], ['CN', 6], ['TH', 4],
  ['BR', 4], ['PE', 3], ['NP', 3], ['KR', 2], ['LK', 2], ['US', 2],
];

const MUNICIPALITIES: (readonly [string, number])[] = [
  ['駒ヶ根市', 60], ['飯島町', 10], ['宮田村', 10], ['中川村', 6], ['伊那市', 10], ['箕輪町', 4],
];
const GOALS = ['JLPT N3', 'JLPT N2', 'JLPT N4', '日常会話', '仕事で使える日本語'];
const STAFF_NAMES = ['受付A', '受付B', '受付C'];

// ---- 日付・日時の補助 ----

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 2つの日付の差（日数）。b - a */
function daysBetween(a: DateString, b: DateString): number {
  const pa = parseDate(a);
  const pb = parseDate(b);
  return Math.round((Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / 86400000);
}

const maxDate = (a: DateString, b: DateString): DateString => (a >= b ? a : b);
const minDate = (a: DateString, b: DateString): DateString => (a <= b ? a : b);

/** 日付から 'YYYY-MM-DD HH:MM:SS' を作る（時刻は乱数で決める） */
function dateTime(date: DateString, rng: Rng): string {
  return `${date} ${pad2(rng.between(9, 17))}:${pad2(rng.int(60))}:${pad2(rng.int(60))}`;
}

/** 年度の最初の日と最後の日 */
function fiscalYearRange(fy: number, startMonth: number): { start: DateString; end: DateString } {
  const start = `${fy}-${pad2(startMonth)}-01`;
  const end = addDays(`${fy + 1}-${pad2(startMonth)}-01`, -1);
  return { start, end };
}

/** 今日より前で、いちばん最近の「免除する入会月」の日付を全部集める（最大1年分さかのぼる） */
function recentExemptDates(today: DateString, exemptMonths: readonly number[]): DateString[] {
  if (exemptMonths.length === 0) return [];
  const out: DateString[] = [];
  // 免除月が連続する直近のまとまりだけを取るため、最初に見つけた月から数日ずつ集める
  let found = false;
  for (let back = 0; back <= 366; back++) {
    const d = addDays(today, -back);
    if (exemptMonths.includes(parseDate(d).month)) {
      out.push(d);
      found = true;
    } else if (found) {
      break;
    }
  }
  return out;
}

// ---- 本体 ----

export function generateDummyData(opts: DummyOptions): DummyData {
  const { count, seed, today, settings } = opts;
  const rng = new Rng(seed);
  const startMonth = settings.fiscalYearStartMonth;
  const currentFy = fiscalYearOf(today, startMonth);
  const exemptDates = recentExemptDates(today, settings.exemptJoinMonths);

  const generalType = settings.membershipTypes[0];
  const supportingType = settings.membershipTypes.find((t) => t.allowMultipleUnits) ?? generalType;
  if (!generalType) throw new Error('会員種別の設定がありません');

  const members: Record<string, string>[] = [];
  const charges: Record<string, string | number>[] = [];

  for (let i = 0; i < count; i++) {
    const memberNo = formatMemberNo(settings.branchCode, DUMMY_SEQUENCE_START + i);

    // 名前
    const country = rng.weighted(COUNTRY_WEIGHTS);
    const isJapanese = country === 'JP';
    let legalName: string;
    let kana: string;
    let nickname: string;
    let altName = '';
    const wantAlt = rng.chance(0.1);
    if (isJapanese) {
      const sur = rng.pick(JP_SURNAMES);
      const giv = rng.pick(JP_GIVEN);
      legalName = `${sur[0]} ${giv[0]}`;
      kana = `${sur[1]} ${giv[1]}`;
      nickname = giv[1];
      if (wantAlt) altName = `${rng.pick(JP_SURNAMES)[0]} ${giv[0]}`;
    } else {
      const names = FOREIGN_NAMES[country];
      const sur = rng.pick(names.surnames);
      const giv = rng.pick(names.given);
      legalName = `${sur[0]} ${giv[0]}`;
      kana = `${sur[1]} ${giv[1]}`;
      nickname = rng.chance(0.5) ? giv[0].split(' ')[0] : giv[1];
      if (wantAlt) altName = `${rng.pick(names.surnames)[0]} ${giv[0]}`;
    }

    // 住所・連絡先
    const municipality = rng.weighted(MUNICIPALITIES);
    const inSubsidy = municipality === settings.insurance.subsidyMunicipality;
    const resident = inSubsidy ? (rng.chance(0.9) ? 'はい' : 'いいえ') : 'いいえ';
    const postalCode = `399-${String(rng.int(10000)).padStart(4, '0')}`;
    const address = `${rng.between(1, 9)}-${rng.between(1, 30)}-${rng.between(1, 20)}`;
    const mobile = `090-0000-${String(rng.int(10000)).padStart(4, '0')}`;
    const homePhone = rng.chance(0.15) ? `0265-00-${String(rng.int(10000)).padStart(4, '0')}` : '';
    const email = rng.chance(0.15) ? `user${i}@example.com` : '';

    // 会員種別・役割・活動
    const isSupporting = rng.chance(0.05);
    const type = isSupporting ? supportingType : generalType;
    let roleSet: string[];
    if (isJapanese) {
      roleSet = rng.weighted<string[]>([
        [['日本語ボランティア'], 80],
        [['運営スタッフ'], 6],
        [['日本語ボランティア', '運営スタッフ'], 10],
        [['学習者'], 4],
      ]);
    } else {
      roleSet = rng.weighted<string[]>([
        [['学習者'], 85],
        [['学習者', '運営スタッフ'], 5],
        [['日本語ボランティア'], 10],
      ]);
    }
    const roles = ROLES.filter((r) => roleSet.includes(r)).join('、');
    const actSet = rng.sample(ACTIVITIES, rng.between(1, 3));
    const activities = ACTIVITIES.filter((a) => actSet.includes(a)).join('、');
    const japaneseGoal = !isJapanese && rng.chance(0.4) ? rng.pick(GOALS) : '';

    // 状態・登録経路
    const forcedExempt = exemptDates.length > 0 && i % 8 === 3;
    let status = rng.weighted<string>([['本登録', 90], ['仮登録', 5], ['退会', 5]]);
    const source = rng.weighted<string>([['移行', 70], ['フォーム', 20], ['紙', 10]]);
    const guardianConsent = i % 29 === 7 ? 'はい' : '';

    // 入会日：直近6年に散らす。一部は免除月（1〜3月）の入会にする
    let joinDate: DateString;
    const randomOffset = rng.int(6 * 365);
    if (forcedExempt) {
      joinDate = rng.pick(exemptDates);
      status = '本登録';
    } else {
      joinDate = addDays(today, -randomOffset);
    }
    const joinFy = fiscalYearOf(joinDate, startMonth);
    const joinMonth = parseDate(joinDate).month;

    // 年度請求
    const engagement = 0.4 + rng.float() * 0.6;
    const memberCharges: Record<string, string | number>[] = [];
    for (let fy = joinFy; fy <= currentFy; fy++) {
      const isJoinFy = fy === joinFy;
      // 入会した年度は必ず参加している。ほかの年度は、新しい年度ほど参加しやすい
      const recency = 0.45 + 0.1 * (fy - (currentFy - 5));
      const active = isJoinFy || (rng.chance(Math.min(0.95, recency * engagement + 0.2)) && !(status === '退会' && fy === currentFy));
      if (!active) continue;

      const range = fiscalYearRange(fy, startMonth);
      const lo = maxDate(range.start, joinDate);
      const hi = minDate(range.end, today);
      const receivedDate = addDays(lo, rng.int(Math.max(daysBetween(lo, hi), 0) + 1));
      const receivedBy = rng.pick(STAFF_NAMES);
      const exempt = isJoinFy && settings.exemptJoinMonths.includes(joinMonth);
      const units = !exempt && type.allowMultipleUnits ? rng.between(1, 3) : 1;
      const amount = exempt ? 0 : type.feePerUnit * units;
      const handed =
        fy < currentFy || rng.chance(0.4) ? minDate(addDays(receivedDate, rng.int(15)), today) : '';

      memberCharges.push({
        chargeId: `${memberNo}-${fy}-M`,
        branchCode: settings.branchCode,
        memberNo,
        fiscalYear: fy,
        kind: '会費',
        units,
        amount,
        selfPay: amount,
        subsidy: 0,
        subsidySource: '',
        status: exempt ? '免除' : '支払済',
        receivedDate,
        receivedBy,
        handedToTreasurerDate: exempt ? '' : handed,
        notes: DUMMY_NOTE,
        recordedAt: dateTime(receivedDate, rng),
      });

      // 当年度に会費を払った人の約2割は、保険にも入る
      if (fy === currentFy && !exempt && settings.insurance.enabled && rng.chance(0.2)) {
        const ins = settings.insurance;
        memberCharges.push({
          chargeId: `${memberNo}-${fy}-I`,
          branchCode: settings.branchCode,
          memberNo,
          fiscalYear: fy,
          kind: '保険料',
          units: 1,
          amount: ins.premium,
          selfPay: ins.premium - ins.subsidy,
          subsidy: ins.subsidy,
          subsidySource: resident === 'はい' ? ins.subsidyMunicipality : ins.fallbackSubsidySource,
          status: '支払済',
          receivedDate,
          receivedBy,
          handedToTreasurerDate: handed,
          notes: DUMMY_NOTE,
          recordedAt: dateTime(receivedDate, rng),
        });
      }
    }

    // 会員の自動更新項目
    const receivedDates = memberCharges.map((c) => String(c.receivedDate)).sort();
    const lastAttendedDate = receivedDates.length > 0 ? receivedDates[receivedDates.length - 1] : '';
    const activityStatus = memberCharges.some(
      (c) => c.kind === '会費' && ((c.fiscalYear as number) === currentFy || (c.fiscalYear as number) === currentFy - 1),
    )
      ? '活動中'
      : '休眠';
    let qrToken = '';
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    for (let k = 0; k < 16; k++) qrToken += alphabet[rng.int(alphabet.length)];
    const createdAt = dateTime(joinDate, rng);
    const consentAt = source === '移行' ? '' : dateTime(joinDate, rng);
    const updatedAt = dateTime(maxDate(joinDate, lastAttendedDate), rng);

    const member: Record<string, string> = {
      memberNo,
      branchCode: settings.branchCode,
      status,
      legalName,
      altName,
      kana,
      nickname,
      membershipType: type.label,
      roles,
      activities,
      country,
      postalCode,
      municipality,
      address,
      residentInSubsidyMunicipality: resident,
      mobile,
      homePhone,
      email,
      japaneseGoal,
      notes: DUMMY_NOTE,
      joinDate,
      lastAttendedDate,
      activityStatus,
      qrToken,
      consentAt,
      guardianConsent,
      source,
      createdAt,
      updatedAt,
    };
    // 定義にない列・足りない列があれば気づけるよう、定義の列順で作り直す
    members.push(Object.fromEntries(MEMBERS.columns.map((c) => [c.key, member[c.key] ?? ''])));
    for (const ch of memberCharges) {
      charges.push(Object.fromEntries(CHARGES.columns.map((c) => [c.key, ch[c.key] ?? (c.numeric ? 0 : '')])));
    }
  }

  return { members, charges };
}
