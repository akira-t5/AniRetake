# AniRetake — コマンド・セットアップ

> 画面での使い方は [README.md](./README.md) を見てください。  
> 変更履歴は [CHANGELOG.md](./CHANGELOG.md) です。

## やりたいこと → 見る場所

| やりたいこと | 見る場所 |
|---|---|
| 画面の操作・ショートカット | [README.md](./README.md) |
| ローカルで開く／公開する | このファイル |
| 何が変わったか確認する | [CHANGELOG.md](./CHANGELOG.md) |

## 対応環境

- OS：Windows / macOS
- ブラウザ：最新の Chrome / Edge / Safari
- ランタイム：不要（単一の `index.html`）

## 起動（ローカル）

1. このフォルダの `index.html` をブラウザで開く  
2. またはローカルサーバー例：

```bash
python -m http.server 8765
```

ブラウザで `http://127.0.0.1:8765/` を開く。

## 公開（GitHub Pages）

- リポジトリ：https://github.com/akira-t5/AniRetake
- Pages：`main` ブランチのルート（`/`）
- URL：https://akira-t5.github.io/AniRetake/

変更を反映するときは `main` に push するだけで足ります（数分かかる場合があります）。

## フォルダ構成

```
AniRetake/
├── index.html      # 本体（UI・ロジックすべて）
├── README.md       # 使う人向け
├── COMMANDS.md     # 入れる人・作る人向け（このファイル）
├── CHANGELOG.md    # 版ごとの変更
├── LICENSE         # MIT
└── .gitignore
```

## 設定データの場所

ブラウザの **localStorage** キー：`retake.v7`  
（サイトごと／オリジンごとに保存されます。GitHub Pages と `file://` では別データになります）

バックアップはアプリ内の「JSON保存」を使ってください。

## 配布形態

このツールは **単一 HTML** が配布本体です。

| 形態 | 内容 |
|---|---|
| オンライン | GitHub Pages の URL を共有 |
| オフライン | `index.html`（必要なら README / COMMANDS / CHANGELOG / LICENSE も同梱）を渡す |

Windows インストーラや Mac DMG は不要です（ブラウザで動くため）。

## 開発メモ

- バージョンは `index.html` 内の `APP_VERSION` が正。表示やタイトルもここから反映します。
- 機能追加時は `CHANGELOG.md` を更新し、必要なら `APP_VERSION` を上げてください。
