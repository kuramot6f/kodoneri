compactationは最終API呼び出しの`total_tokens`で判定し、systemと直近tailは原文のまま保持する。
TODO: chatgpptの画面などで制御が奪われないようにする
TODO: ツール実行回数の上限撤廃
TODO: ローカライゼーション
TODO: アイコン設定
TODO: APIキーをBYOKできるようにする
TODO: 対応プロバイダを増やす

拡張のソースは `extension/`。リポジトリルートは Xcode プロジェクト。
生成物は `extension/dist/` で、Xcode の "Build Web Extension" フェーズが appex へ rsync する。
pbxproj の membershipExceptions を自動で消すので、生成物を置くと壊れる。

AI SDKのツール画像は`tool result -> user(file providerReference)`を正規履歴の末尾へ一度だけ追加する。過去へ再挿入せず、DeepSeekのprefix KVキャッシュを維持する。
