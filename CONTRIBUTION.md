# Kodoneri

Safari 拡張（Web Extension）本体と、それを配布する iOS / macOS アプリ。

## 構成

| パス | 役割 |
|---|---|
| `extension/` | 拡張本体のソース（TypeScript + React + Vite）。`extension/dist/` にビルドされる。`background/` が会話と実行状態を所有し、`content/` はパネル UI とページ操作 |
| `Shared (App)` | 拡張を配布し、API キーを編集する SwiftUI アプリ（iOS / macOS 共通） |
| `Shared (Extension)` | `SafariWebExtensionHandler.swift`（native messaging）と、アプリとも共有する `ApiKeyStore.swift`（Keychain） |
| `chatext.xcodeproj` | iOS / macOS それぞれのアプリ＋拡張ターゲット |
| `design/` | 設計メモ |

## 開発環境

```sh
mise install
cd extension && corepack pnpm install --frozen-lockfile
```

サーバーの URL と ID はコミットしないので、example をコピーして埋める:

```sh
cp extension/.env.example extension/.env.local
cp Secrets.example.xcconfig Secrets.xcconfig
cp gateway/wrangler.example.jsonc gateway/wrangler.jsonc
```

## ビルド

Xcode でビルドすれば、拡張ターゲットの **Build Web Extension** フェーズが
`corepack pnpm build` を実行し、`extension/dist/` の生成物を appex へコピーします。
拡張だけビルドしたいときは:

```sh
cd extension && corepack pnpm build
```

`extension/dist/` は生成物なので git 管理外です。Xcode の同期グループ
（`Shared (Extension)`）には置きません — フォルダが一瞬でも存在しないと
Xcode が pbxproj からメンバーシップを剥がしてしまうためです。

## Xcode Cloud

ワークフローの Environment に `GATEWAY_HOST` を設定します。
値はローカルの `Secrets.xcconfig` と同じホスト名だけ（`https://` やパスなし）。
iOS / macOS の両ワークフローで設定してください。

`ci_scripts/ci_post_clone.sh` が `Secrets.xcconfig` と `extension/.env.local` を生成し、
Node.js 24・Corepack と pnpm の依存関係をインストールします。
生成された設定ファイルは Git 管理外のままです。
スクリプトを含むコミットをリモートへ push してから、そのコミットでビルドを開始します。

## API キー

OpenAI / Anthropic / DeepSeek のキーはアプリの画面から入力する（iCloud Keychain で同期）。
拡張は起動時と新規会話の開始時に native messaging で Keychain から読み、`background.js` がメモリに保持する。
モデルと思考量の一覧は `extension/src/shared/models.json`。

## テスト

```sh
cd extension && corepack pnpm test
```
