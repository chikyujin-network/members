#!/usr/bin/env python3
"""
旧Excel名簿（2026年度会員名簿など）を、新しいスプレッドシートの形式（CSV）に変換する。

使い方:
  python3 migration/convert.py --input "/path/to/2026地球人名簿 .xlsx" --output-dir "/path/to/移行出力"

- 入力の Excel と出力の CSV には個人情報が含まれる。リポジトリの外のフォルダを指定すること
- 出力:
    会員.csv / 年度請求.csv       新しいシートに貼り付ける CSV（列は gas/src/schema.ts と同じ順番）
    要確認_*.csv                  人が確認するための一覧
    移行レポート.md               件数のまとめ
- 必要なライブラリ: openpyxl（pip install openpyxl）
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import difflib
import re
import secrets
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import openpyxl
from openpyxl.cell.rich_text import CellRichText, TextBlock

ROSTER_SHEET = '2026年度会員名簿（R8年）'
PAYMENT_SHEETS = {  # シート名 → 対象年度
    '2026会費納入日順名簿': 2026,
    '2027年度会費納入者名簿': 2027,
}
INSURANCE_SHEET = '2026ボランティア保険加入名簿'
INSURANCE_FY = 2026
MAX_COL = 27  # A〜AA 列だけ読む（シートの右端に不要な数式があるため）

# gas/src/schema.ts と同じ列の順番
MEMBER_COLUMNS = [
    '会員番号', '支部番号', '登録状態', '登録名', '別名（旧姓・別の表記）', 'よみ（カタカナ）', 'ニックネーム',
    '会員種別', '役割', '参加したい活動', '国・地域', '郵便番号', '市町村', '番地以降', '住民票が補填自治体にある',
    '携帯電話', '自宅電話', 'メール', 'LINE表示名', '日本語の目標', '所属・備考', '入会日', '最終参加日', '活動状態',
    'QRトークン', '個人情報の同意日時', '保護者の同意', '登録経路', '作成日時', '更新日時',
]
CHARGE_COLUMNS = [
    '請求ID', '支部番号', '会員番号', '対象年度', '種類', '口数', '金額', '本人負担額', '補填額', '補填元', '状態',
    '受領日', '受領者', '会計への引渡日', '備考', '記録日時',
]

COUNTRY_CODES = {
    '日本': 'JP', 'アメリカ': 'US', 'カナダ': 'CA', 'インド': 'IN', '韓国': 'KR', '中国': 'CN', 'タイ': 'TH',
    'ペルー': 'PE', 'チリ': 'CL', 'エクアドル': 'EC', 'スペイン': 'ES', 'メキシコ': 'MX', 'ブラジル': 'BR',
    'スリランカ': 'LK', 'フィリピン': 'PH', 'インドネシア': 'ID', 'ベトナム': 'VN', 'バヌアツ': 'VU',
    'バングラディシュ': 'BD', 'バングラデシュ': 'BD', 'ネパール': 'NP', 'モロッコ': 'MA', 'フランス': 'FR',
    'ミャンマー': 'MM', 'ミヤンマー': 'MM', 'カンボジア': 'KH', 'アルゼンチン': 'AR', 'ロシア': 'RU',
    'ウズベキスタン': 'UZ', 'イギリス': 'GB', 'ドイツ': 'DE', 'オーストラリア': 'AU', '台湾': 'TW',
    'ボリビア': 'BO', 'コロンビア': 'CO', 'パラグアイ': 'PY', 'モンゴル': 'MN', 'マレーシア': 'MY',
}
LOCAL_AREA_CODE = '0265'  # 市外局番のない自宅電話に付ける（駒ヶ根・伊那周辺）
PAID_MARKS = {'〇', '○', '◯'}

KANA_RE = re.compile(r'^[぀-ゟ゠-ヿー・\s]+$')
KANJI_RE = re.compile(r'[一-鿿々]')


def nfkc(s: str) -> str:
    return unicodedata.normalize('NFKC', s)


def text(v) -> str:
    if v is None:
        return ''
    if isinstance(v, (dt.datetime, dt.date)):
        return v.strftime('%Y-%m-%d')
    return str(v).strip()


def norm_name(s: str) -> str:
    """名寄せ用のキー。全角半角・空白・中点・カッコ書き・改行以降を除く"""
    s = nfkc(s).split('\n')[0]
    s = re.sub(r'[（(].*?[)）]', '', s)
    s = s.replace('ヶ', 'ケ')
    return re.sub(r'[\s・･]', '', s)


def hira_to_kata(s: str) -> str:
    return ''.join(chr(ord(c) + 0x60) if 'ぁ' <= c <= 'ゖ' else c for c in s)


def fiscal_year_from_header(h: str) -> int | None:
    m = re.fullmatch(r'([RH])\s*(\d+)', nfkc(h).replace('\n', '').strip())
    if not m:
        return None
    n = int(m.group(2))
    return 2018 + n if m.group(1) == 'R' else 1988 + n


def parse_date(v) -> str:
    """セルの日付を YYYY-MM-DD に。'2025/\\n6/12' のような文字列にも対応。読めなければ空"""
    if isinstance(v, (dt.datetime, dt.date)):
        return v.strftime('%Y-%m-%d')
    s = nfkc(text(v)).replace('\n', '')
    m = re.fullmatch(r'(\d{4})/(\d{1,2})/(\d{1,2})', s)
    return f'{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}' if m else ''


def normalize_phone(s: str) -> tuple[str, str]:
    """(整えた番号, 備考)。市外局番のない番号には 0265 を付ける"""
    s = nfkc(s).strip()
    if not s:
        return '', ''
    if re.fullmatch(r'\d{2}-\d{4}', s):
        return f'{LOCAL_AREA_CODE}-{s}', ''
    if re.fullmatch(r'0\d{1,4}-\d{1,4}-\d{4}', s) or re.fullmatch(r'0\d{9,10}', s):
        return s, ''
    return '', f'電話番号の形式が読めない: {s}'


def underline_text(v) -> str:
    if isinstance(v, CellRichText):
        parts = [b.text for b in v if isinstance(b, TextBlock) and b.font is not None and b.font.u]
        return nfkc(''.join(parts)).strip()
    return ''


@dataclass
class Member:
    row: int
    hidden: bool
    raw_name: str
    legal_name: str = ''
    kana: str = ''
    alt_name: str = ''
    nickname: str = ''
    country_raw: str = ''
    country: str = ''
    postal: str = ''
    municipality: str = ''
    address: str = ''
    mobile: str = ''
    home: str = ''
    email: str = ''
    notes: list[str] = field(default_factory=list)
    membership_type: str = '一般'
    years_paid: dict[int, str] = field(default_factory=dict)  # 年度 → 記号
    r8_received: str = ''
    r8_insurance: bool = False
    join_date: str = ''
    member_no: str = ''


def split_name(raw: str, m: Member, review: list[dict]) -> None:
    """氏名欄を、登録名・よみ・別名・備考に振り分ける。判断できないものは要確認に出す"""
    s = nfkc(raw).strip()
    lines = [x.strip() for x in s.split('\n') if x.strip()]
    first = lines[0] if lines else ''
    extra = lines[1:]
    parens = re.findall(r'[（(]([^)）]*)[)）]?', first)
    base = re.sub(r'[（(][^)）]*[)）]?', '', first).strip()
    base = re.sub(r'\s+', ' ', base)
    m.legal_name = base
    if base and KANA_RE.match(base):
        m.kana = hira_to_kata(base)  # カタカナ表記の名前は、よみも同じ
    suggestions = []
    for p in parens:
        p = p.strip()
        if not p:
            continue
        if KANA_RE.match(p) and KANJI_RE.search(base):
            suggestions.append(f'よみの一部かも: {hira_to_kata(p)}')
        elif KANA_RE.match(p) and len(p) <= max(3, len(base) // 2):
            suggestions.append(f'ニックネームかも: {p}')
        else:
            suggestions.append(f'別名かも: {p}')
        m.notes.append(f'旧名簿の氏名欄のカッコ書き: {p}')
    for e in extra:
        m.notes.append(f'旧名簿の氏名欄のメモ: {e}')
    if parens or extra:
        review.append({'旧名簿の行': m.row, '氏名欄（元）': raw.replace('\n', ' / '), '登録名（案）': base,
                       'よみ（案）': m.kana, '振り分けの候補': ' ／ '.join(suggestions), '改行のメモ': ' / '.join(extra)})


def read_roster(wb, review_parens, review_marks, review_country) -> tuple[list[Member], dict[int, int]]:
    ws = wb[ROSTER_SHEET]
    header = [text(ws.cell(1, c).value) for c in range(1, MAX_COL + 1)]
    year_cols: dict[int, int] = {}  # 列番号(0始まり) → 年度
    received_col = insurance_col = None
    for i, h in enumerate(header):
        hn = nfkc(h).replace('\n', '')
        if '領収日' in hn:
            received_col = i
        elif '保険' in hn:
            insurance_col = i
        else:
            fy = fiscal_year_from_header(h)
            if fy:
                year_cols[i] = fy
    members: list[Member] = []
    for r, row in enumerate(ws.iter_rows(min_row=2, max_col=MAX_COL), start=2):
        v = [c.value for c in row]
        raw = text(v[18])
        if not raw:
            continue
        m = Member(row=r, hidden=bool(ws.row_dimensions[r].hidden), raw_name=raw)
        split_name(raw, m, review_parens)
        m.nickname = underline_text(row[18].value)
        m.country_raw = nfkc(text(v[19])).split('\n')[0].strip()
        m.country = COUNTRY_CODES.get(m.country_raw, '')
        if m.country_raw and not m.country:
            review_country.append({'旧名簿の行': r, '国籍（元）': text(v[19]).replace('\n', ' / ')})
        if '\n' in text(v[19]):
            m.notes.append(f'旧名簿の国籍欄: {text(v[19]).replace(chr(10), " ")}')
        m.postal = nfkc(text(v[20]))
        m.municipality = nfkc(text(v[21])).replace('駒ケ根', '駒ヶ根')
        m.address = nfkc(text(v[22]))
        m.home, note1 = normalize_phone(text(v[23]))
        m.mobile, note2 = normalize_phone(text(v[24]))
        m.notes += [n for n in (note1, note2) if n]
        z, aa = nfkc(text(v[25])), nfkc(text(v[26]))
        if '@' in z:
            m.email = z
        elif z:
            m.notes.append(z)
        if aa and aa not in ('○', '〇'):
            m.notes.append(aa)
        if '賛助' in z or '賛助' in aa:
            m.membership_type = '賛助'
        for col, fy in year_cols.items():
            mark = nfkc(text(v[col])).strip()
            if not mark:
                continue
            if mark[0] in PAID_MARKS:
                m.years_paid[fy] = mark
                if len(mark) > 1:
                    m.notes.append(f'{fy}年度の会費欄: {mark}')
            else:
                review_marks.append({'旧名簿の行': r, '年度': fy, '記号': mark})
        if received_col is not None:
            m.r8_received = parse_date(v[received_col])
        if insurance_col is not None:
            m.r8_insurance = nfkc(text(v[insurance_col]))[:1] in PAID_MARKS
        members.append(m)
    return members, year_cols


def merge_duplicates(members: list[Member], review: list[dict]) -> list[Member]:
    """同じ名前（正規化後）の行を1人にまとめる。表示行を優先し、会費の記録は足し合わせる"""
    by_key: dict[str, list[Member]] = defaultdict(list)
    for m in members:
        by_key[norm_name(m.raw_name)].append(m)
    out: list[Member] = []
    for m in members:
        group = by_key[norm_name(m.raw_name)]
        if len(group) == 1:
            out.append(m)
            continue
        if m is not group[0]:
            continue
        group.sort(key=lambda x: (x.hidden, x.row))
        keep = group[0]
        for other in group[1:]:
            for fy, mark in other.years_paid.items():
                keep.years_paid.setdefault(fy, mark)
            for attr in ('kana', 'nickname', 'postal', 'municipality', 'address', 'mobile', 'home', 'email', 'country'):
                if not getattr(keep, attr) and getattr(other, attr):
                    setattr(keep, attr, getattr(other, attr))
            keep.notes += [n for n in other.notes if n not in keep.notes]
        review.append({'まとめた先の行': keep.row, 'まとめた行': ', '.join(str(o.row) for o in group[1:]),
                       '氏名': keep.raw_name.replace('\n', ' / '),
                       '注意': '同姓同名の別人の可能性があれば、分け直す'})
        out.append(keep)
    return out


def read_payment_sheet(wb, name: str) -> list[dict]:
    sheet_name = next((s for s in wb.sheetnames if s.strip() == name), None)
    if not sheet_name:
        return []
    ws = wb[sheet_name]
    rows = []
    for row in ws.iter_rows(min_row=4, max_col=9, values_only=True):
        nm = text(row[3])
        if not nm or nm.startswith('NO'):
            continue
        rows.append({'name': nm, 'date': parse_date(row[2]), 'new_or_cont': nfkc(text(row[5])),
                     'insurance': nfkc(text(row[6])), 'handover': nfkc(text(row[7])).replace('\n', ' '),
                     'note': nfkc(text(row[8])).replace('\n', ' ')})
    return rows


def read_insurance(wb) -> list[dict]:
    if INSURANCE_SHEET not in wb.sheetnames:
        return []
    ws = wb[INSURANCE_SHEET]
    out = []
    for row in ws.iter_rows(min_row=4, max_col=7, values_only=True):
        nm = text(row[3])
        if not nm or nm == '名前':
            continue
        out.append({'name': nm, 'date': parse_date(row[2]), 'residence': nfkc(text(row[5])).replace('駒ケ根', '駒ヶ根')})
    return out


def match(name: str, index: dict[str, Member]) -> tuple[Member | None, str]:
    key = norm_name(name)
    if key in index:
        return index[key], ''
    cand = difflib.get_close_matches(key, list(index), n=1, cutoff=0.6)
    return None, (cand[0] if cand else '')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True)
    ap.add_argument('--output-dir', required=True)
    ap.add_argument('--branch', default='001')
    ap.add_argument('--start-seq', type=int, default=100)
    args = ap.parse_args()

    out = Path(args.output_dir)
    out.mkdir(parents=True, exist_ok=True)
    wb = openpyxl.load_workbook(args.input, rich_text=True)
    now = dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    review_parens, review_marks, review_country, review_dups, review_match = [], [], [], [], []
    members, _ = read_roster(wb, review_parens, review_marks, review_country)
    total_rows = len(members)
    members = merge_duplicates(members, review_dups)

    for i, m in enumerate(members):
        m.member_no = f'{args.branch}-{args.start_seq + i:05d}'
    index = {norm_name(m.raw_name): m for m in members}
    by_no = {m.member_no: m for m in members}

    charges: dict[str, dict] = {}

    def add_charge(m: Member, fy: int, kind: str, **kw) -> dict:
        cid = f'{m.member_no}-{fy}-{"M" if kind == "会費" else "I"}'
        c = charges.get(cid)
        if c is None:
            c = {k: '' for k in CHARGE_COLUMNS}
            c.update({'請求ID': cid, '支部番号': args.branch, '会員番号': m.member_no, '対象年度': fy, '種類': kind,
                      '状態': '支払済', '記録日時': now, '備考': '旧名簿から移行'})
            charges[cid] = c
        for k, v in kw.items():
            if v != '' and v is not None:
                c[k] = v
        return c

    # 旧名簿の年度列 → 会費の記録
    for m in members:
        for fy in sorted(m.years_paid):
            c = add_charge(m, fy, '会費', 口数=1)
            if fy == 2026:
                c['金額'] = 500
                c['本人負担額'] = 500
                if m.r8_received:
                    c['受領日'] = m.r8_received

    # 会費納入の名簿 → 受領日・新規/継続・賛助・メモを補う（翌年度の前払いも）
    for sheet, fy in PAYMENT_SHEETS.items():
        for p in read_payment_sheet(wb, sheet):
            m, cand = match(p['name'], index)
            if m is None:
                review_match.append({'シート': sheet, '名前（納入名簿）': p['name'].replace('\n', ' / '),
                                     '候補（名簿）': cand, '納入日': p['date'],
                                     '対応': '同じ人なら、会員番号を確認して年度請求に手で足す'})
                continue
            if '賛助' in p['new_or_cont']:
                m.membership_type = '賛助'
            if '新規' in p['new_or_cont'] and p['date'] and not m.join_date:
                m.join_date = p['date']
            memo = ' '.join(x for x in (p['handover'], p['note']) if x)
            c = add_charge(m, fy, '会費', 口数=1, 金額=500, 本人負担額=500)
            if p['date'] and not c['受領日']:
                c['受領日'] = p['date']
            if memo:
                c['備考'] = f'旧名簿から移行。{memo}'

    # 保険（2026年度）
    ins_rows = read_insurance(wb)
    ins_res = {}
    for p in ins_rows:
        m, cand = match(p['name'], index)
        if m is None:
            review_match.append({'シート': INSURANCE_SHEET, '名前（納入名簿）': p['name'], '候補（名簿）': cand,
                                 '納入日': p['date'], '対応': '同じ人なら、保険料の行を手で足す'})
            continue
        ins_res[m.member_no] = p
    for m in members:
        p = ins_res.get(m.member_no)
        if not (m.r8_insurance or p):
            continue
        residence = (p or {}).get('residence') or m.municipality
        source = '駒ヶ根市' if residence == '駒ヶ根市' else 'ちきゅうじん'
        add_charge(m, INSURANCE_FY, '保険料', 口数=1, 金額=500, 本人負担額=330, 補填額=170, 補填元=source,
                   受領日=(p or {}).get('date', ''),
                   備考='旧名簿から移行。補填元は旧名簿の居住地から推定（住民票の確認が必要）')

    # 会員.csv
    with open(out / '会員.csv', 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(MEMBER_COLUMNS)
        for m in members:
            recent = {2025, 2026} & set(fy for fy in m.years_paid) or any(
                c['会員番号'] == m.member_no and c['対象年度'] in (2026, 2027) for c in charges.values())
            w.writerow([
                m.member_no, args.branch, '本登録', m.legal_name, m.alt_name, m.kana, m.nickname, m.membership_type,
                '', '', m.country, m.postal, m.municipality, m.address, '', m.mobile, m.home, m.email, '', '',
                ' ／ '.join(dict.fromkeys(m.notes)), m.join_date, '', '活動中' if recent else '休眠',
                secrets.token_urlsafe(12), '', '', '移行', now, now,
            ])

    # 年度請求.csv
    with open(out / '年度請求.csv', 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=CHARGE_COLUMNS)
        w.writeheader()
        for c in sorted(charges.values(), key=lambda c: (c['会員番号'], c['対象年度'], c['種類'])):
            w.writerow(c)

    # 対応表（旧名簿の行 → 会員番号）
    with open(out / '対応表_旧名簿の行と会員番号.csv', 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f)
        w.writerow(['旧名簿の行', '非表示だった', '会員番号', '氏名（元）'])
        for m in members:
            w.writerow([m.row, 'はい' if m.hidden else '', m.member_no, m.raw_name.replace('\n', ' / ')])

    def dump(name: str, rows: list[dict]) -> None:
        if not rows:
            return
        with open(out / name, 'w', newline='', encoding='utf-8-sig') as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)

    dump('要確認_名寄せ.csv', review_match)
    dump('要確認_重複.csv', review_dups)
    dump('要確認_氏名欄の振り分け.csv', review_parens)
    dump('要確認_会費欄の記号.csv', review_marks)
    dump('要確認_国名.csv', review_country)

    n_active = sum(1 for m in members if any(fy in (2025, 2026) for fy in m.years_paid))
    kinds = defaultdict(int)
    for c in charges.values():
        kinds[(c['対象年度'], c['種類'])] += 1
    lines = [
        '# 移行レポート', '', f'作成日時：{now}', '',
        '| 項目 | 件数 |', '| --- | --- |',
        f'| 旧名簿の行（氏名あり） | {total_rows} |',
        f'| 重複をまとめた後の会員 | {len(members)} |',
        f'| うち2025・2026年度に会費の記録あり（活動中の目安） | {n_active} |',
        f'| 年度請求の行 | {len(charges)} |',
        f'| 2026年度の会費 | {kinds[(2026, "会費")]} |',
        f'| 2026年度の保険料 | {kinds[(2026, "保険料")]} |',
        f'| 2027年度の会費（前払い） | {kinds[(2027, "会費")]} |',
        f'| 要確認：名寄せできなかった名前 | {len(review_match)} |',
        f'| 要確認：重複をまとめた | {len(review_dups)} |',
        f'| 要確認：氏名欄のカッコ書き・改行 | {len(review_parens)} |',
        f'| 要確認：会費欄の△▽などの記号 | {len(review_marks)} |',
        f'| 要確認：国名を変換できなかった | {len(review_country)} |',
        f'| ニックネーム（下線）を抽出 | {sum(1 for m in members if m.nickname)} |',
        f'| 賛助会員 | {sum(1 for m in members if m.membership_type == "賛助")} |',
        '', '## 注意', '',
        '- 会員番号は旧名簿の行の順に振っている（表示されていた行が先、非表示の行が後）',
        '- 2025年度以前の会費は、金額と受領日が分からないので空欄（状態は「支払済」）',
        '- 保険料の補填元は、旧名簿の居住地からの推定。住民票の確認が必要',
        '- 「住民票が補填自治体にある」「役割」「参加したい活動」は空欄。受付や復帰のときに確認する',
        '- 入会日は、2026年度に「新規」で納入した人だけ、納入日を入れている',
    ]
    (out / '移行レポート.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
