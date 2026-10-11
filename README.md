# 地球人ネットワーク 会員管理システム

地球人ネットワークinこまがね（支部番号 001）の会員名簿・受付・会費管理のためのシステムです。将来、他の支部でも同じコードを設定だけ変えて使えるようにしています。

設計と実装計画は「会員管理」プロジェクトの `docs/設計提案書.md` と `docs/実装計画.md` を参照してください。

## 構成

| フォルダ | 内容 |
| --- | --- |
| `gas/` | Google Apps Script（TypeScript）。スプレッドシートの読み書きと API |
| `gas/src/domain/` | 会費判定・会員番号・教室日程などのロジック（GAS に依存しない純粋な関数。単体テストの対象） |
| `web/` | 画面（静的ページ）。GitHub Pages で公開する |
| `tests/` | ロジックの単体テスト（Vitest） |
| `migration/` | 旧Excelからの移行スクリプト（段階1で作成） |
| `scripts/` | ビルド用のスクリプト |

## はじめに

```bash
npm ci            # 依存を入れる
npm test          # 単体テスト
npm run typecheck # 型チェック
npm run build     # gas/dist/Code.js を作る
```

## GAS への反映（clasp）

1. 団体用アカウント（chikyujin.network@gmail.com）で `clasp login` しておく
2. Apps Script でテスト用・本番用のプロジェクトを作り、スクリプトIDを `gas/.clasp.dev.json` / `gas/.clasp.prod.json` に書く
3. `npm run push:dev`（テスト用）／ `npm run push:prod`（本番用）
4. Apps Script の画面で「デプロイ → デプロイを管理」から Web アプリを更新する（URL は変わらない）

**注意：** push するときは、Apps Script のエディタのタブを閉じておく（または push 後に必ず再読み込みする）。開いたままのエディタは古い中身を自動保存して、push した内容を上書きしてしまうことがある。コードはエディタで直接書き換えず、必ずこのリポジトリで変更して push する。

スクリプトプロパティ：

| 名前 | 内容 |
| --- | --- |
| `SPREADSHEET_ID` | 書き込み先のスプレッドシートID |
| `PROTO_ENABLED` | `true` のときだけ試作用の書き込みを受け付ける。本番では設定しない |

## 画面の公開（GitHub Pages）

リポジトリの Settings → Pages → Source を「GitHub Actions」にすると、`web/` の変更が main に入るたびに自動で公開されます。公開先は `https://chikyujin-network.github.io/members/` です。

## 守ること

- **会員データ（Excel、CSV、氏名・連絡先）をリポジトリに入れない。** このリポジトリは公開されている
- **支部ごとの値（会費、年度の始まり、教室の日程など）をコードに書かない。** 設定シートから読む
- **会費判定などのロジックを変えたら、テストを足してから変える**
