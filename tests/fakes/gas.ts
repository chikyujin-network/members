/**
 * テスト用の、Google Apps Script の模擬環境（メモリ上のスプレッドシート）。
 * 実際の GAS のうち、このリポジトリのコードが使う部分だけを真似する。
 * 書式やメモなど見た目の操作は、何もしないで受け流す。
 */

type Cell = string | number | boolean | Date | null;

/** どのメソッドを呼んでも自分自身を返す（書式設定などの受け流し用） */
function chain(): any {
  const p: any = new Proxy(function () {}, {
    get: (_t, prop) => (prop === 'then' ? undefined : () => p),
    apply: () => p,
  });
  return p;
}

class FakeProtection {
  editors: string[] = [];
  setDescription() { return this; }
  setWarningOnly() { return this; }
  getEditors() { return this.editors.map((e) => ({ getEmail: () => e })); }
  removeEditors(users: { getEmail(): string }[]) {
    const drop = new Set(users.map((u) => u.getEmail()));
    this.editors = this.editors.filter((e) => !drop.has(e));
    return this;
  }
  addEditors(emails: string[]) { this.editors.push(...emails); return this; }
  canDomainEdit() { return false; }
  setDomainEdit() { return this; }
}

export class FakeSheet {
  data: Cell[][] = [];
  protections: FakeProtection[] = [];
  constructor(public name: string) {
    // 定義していないメソッド（書式・列幅・固定行など）は、何もしないで受け流す
    const self = this;
    return new Proxy(this, { get: (t: any, prop) => (prop in t ? t[prop] : () => self) });
  }
  getName() { return this.name; }
  getLastRow() {
    for (let r = this.data.length; r > 0; r--) if (this.data[r - 1]?.some((v) => v !== '' && v !== null && v !== undefined)) return r;
    return 0;
  }
  getLastColumn() { return this.data.reduce((m, r) => Math.max(m, r.length), 0); }
  getMaxRows() { return Math.max(1000, this.data.length); }
  getRange(row: number, col: number, numRows = 1, numCols = 1) {
    const sheet = this;
    const range: any = {
      getValues: () =>
        Array.from({ length: numRows }, (_, i) => Array.from({ length: numCols }, (_, j) => sheet.data[row - 1 + i]?.[col - 1 + j] ?? '')),
      setValues: (vals: Cell[][]) => {
        if (vals.length !== numRows || vals.some((r) => r.length !== numCols)) throw new Error('範囲と値の大きさが合いません');
        vals.forEach((r, i) => r.forEach((v, j) => sheet.set(row + i, col + j, v)));
        return proxy;
      },
      setValue: (v: Cell) => { sheet.set(row, col, v); return proxy; },
    };
    const proxy: any = new Proxy(range, { get: (t, prop) => (prop in t ? t[prop] : () => proxy) });
    return proxy;
  }
  set(r: number, c: number, v: Cell) {
    while (this.data.length < r) this.data.push([]);
    const rowArr = this.data[r - 1];
    while (rowArr.length < c) rowArr.push('');
    rowArr[c - 1] = v;
  }
  clear() { this.data = []; return this; }
  getProtections() { return this.protections; }
  protect() { const p = new FakeProtection(); this.protections.push(p); return p; }
  /** 見出しを除いたデータ行を、見出しをキーにしたオブジェクトで返す（テストの確認用） */
  records(): Record<string, Cell>[] {
    const [h, ...rows] = this.data;
    return rows.filter((r) => r.some((v) => v !== '')).map((r) => Object.fromEntries((h ?? []).map((k, i) => [String(k), r[i] ?? ''])));
  }
}

export class FakeSpreadsheet {
  sheets: FakeSheet[] = [];
  getSheetByName(name: string) { return this.sheets.find((s) => s.name === name) ?? null; }
  insertSheet(name: string, index?: number) {
    const s = new FakeSheet(name);
    if (index === undefined) this.sheets.push(s);
    else this.sheets.splice(index, 0, s);
    return s;
  }
  sheet(name: string): FakeSheet {
    const s = this.getSheetByName(name);
    if (!s) throw new Error(`no sheet ${name}`);
    return s;
  }
}

function jst(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { y: g('year'), M: g('month'), d: g('day'), H: g('hour'), m: g('minute'), s: g('second') };
}

/** 模擬環境を作り、GAS のグローバル（SpreadsheetApp など）に入れる */
export function installFakeGas(opts: { properties: Record<string, string>; staffTokens: Record<string, string> }) {
  const ss = new FakeSpreadsheet();
  let uuid = 0;
  const g = globalThis as any;
  g.PropertiesService = { getScriptProperties: () => ({ getProperty: (k: string) => opts.properties[k] ?? null }) };
  g.SpreadsheetApp = {
    openById: () => ss,
    ProtectionType: { SHEET: 'SHEET' },
    newDataValidation: () => chain(),
    flush: () => {},
  };
  g.LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };
  g.Utilities = {
    formatDate: (date: Date, _tz: string, fmt: string) => {
      const t = jst(date);
      return fmt.replace('yyyy', t.y).replace('MM', t.M).replace('dd', t.d).replace('HH', t.H).replace('mm', t.m).replace('ss', t.s);
    },
    getUuid: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`,
  };
  // ID トークンの検証：staffTokens に登録したトークンだけ、そのメールアドレスとして通す
  g.UrlFetchApp = {
    fetch: (url: string) => {
      const token = decodeURIComponent(url.split('id_token=')[1] ?? '');
      const email = opts.staffTokens[token];
      const body = email
        ? { aud: opts.properties.GOOGLE_CLIENT_ID, iss: 'https://accounts.google.com', email, email_verified: 'true' }
        : { error: 'invalid_token' };
      return { getResponseCode: () => (email ? 200 : 400), getContentText: () => JSON.stringify(body) };
    },
  };
  g.console = console;
  return ss;
}
