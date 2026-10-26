// GAS 用のビルド。gas/src/main.ts を1つの Code.js にまとめ、gas/dist に出力する。
// GAS は ES モジュールを読めないので IIFE にまとめ、doGet/doPost をトップレベルの関数として公開する。
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('gas/dist', { recursive: true });
await build({
  entryPoints: ['gas/src/main.ts'],
  outfile: 'gas/dist/Code.js',
  bundle: true,
  format: 'iife',
  globalName: 'App',
  target: 'es2020',
  charset: 'utf8',
  // どのコードが公開中かを確かめられるよう、ビルドの日時を埋め込む（URL を開くと表示される）
  define: { __BUILD__: JSON.stringify(new Date().toISOString()) },
  footer: {
    js: [
      'function doGet(e) { return App.doGet(e); }',
      'function doPost(e) { return App.doPost(e); }',
      '/** シートと見出しを作る（エディタから実行） */',
      'function setupSpreadsheet() { return App.setupSpreadsheet(); }',
      '/** 名簿・会費状況などのビューを作り直す（エディタから実行） */',
      'function refreshViews() { return App.refreshViews(); }',
      '/** テスト用：ダミーデータを入れる／消す（ALLOW_DUMMY=true のときだけ） */',
      'function seedDummyData() { return App.seedDummyData(); }',
      'function clearDummyData() { return App.clearDummyData(); }',
    ].join('\n'),
  },
});
copyFileSync('gas/appsscript.json', 'gas/dist/appsscript.json');
console.log('built gas/dist/Code.js');
