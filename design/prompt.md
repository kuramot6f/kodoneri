現在の system prompt / memory update prompt / browser tools 周辺を確認し、以下の方針を満たすように改善してください。

## 目的

エージェントの自由度は維持しつつ、以下を改善する。

* 不必要なタブ作成・切替によるユーザー混乱
* ユーザーが今見ている内容と回答対象のズレ
* 過去会話検索の過剰利用を避ける
* 永続的に有用な情報のメモリ取りこぼし
* メモリが上限付近まで肥大化する傾向
* 日付・地域・回答言語など実行時コンテキストの不足

プロンプト本文はこちらで固定しない。既存実装を読み、最小限で明確なルールになるよう設計すること。

## ブラウザ操作

基本優先順位は以下。

**現在のタブを維持 → 既存タブを再利用 → backgroundで新規タブ → 必要な場合のみswitch**

* 調査目的だけでユーザーの表示タブを頻繁に切り替えない。
* 新しいタブを開くこと自体は禁止しない。
* read/grep等でbackground tabを処理できるならswitchしない。
* screenshot、視覚確認、実際のinteractionなどactive状態が必要なときだけswitchする。
* エージェントが作った一時タブを無秩序に増やさない。不要になれば再利用またはcloseする。
* 特にiOSでは表示コンテキストの維持を重視する。

固定的な「最大Nタブ」のようなルールより、ユーザーの表示状態を乱さないという目的を優先する。

## Page reading

質問対象を最初から「ページ全体」と決めつけない。

短い文脈依存質問では、ユーザーが現在見ている部分を最優先する。

例:

* 「これどういう意味？」
* 「これほんと？」
* 「日本語にして」
* 「これは何？」
* 「この部分について教えて」

基本優先順位:

**selection → current viewport → 周辺のDOM/context → whole page**

selection取得機能が現在なければ、追加する価値を検討する。

ただし、viewportだけに情報を制限しない。強いLLMでは詳細なHTMLや周辺コンテキストが有効な場合があるため、

* 表示部分を回答のanchorにする
* 解釈・検証に必要なら周辺やページ全体を追加取得する

というprogressive retrievalにする。

一方、

* 「この記事を要約して」
* 「このページについて説明して」
* 「この論文の主張は？」

など明示的に文書全体を対象とする依頼ではwhole-page retrievalを使う。

## Retrieval

大量のコンテキストを最初から入れない。

**必要な情報を必要になった時点で取得する just-in-time / progressive retrieval** を基本とする。

大きなHTML等は、

**grep/search → bounded read → 必要なら追加取得**

を維持する。

保存済み会話の検索頻度が低いこと自体は問題ではない。

session/history searchは、

* 過去の会話を明示的に参照している
* 前回の作業を続けたい
* 現在のmemoryだけでは必要情報が不足している

などの場合に使う。

## Memory

現在の「基本は更新なし」という設計は維持してよいが、**one-off = 保存不要** と判断しないようにする。

保存判断は出現回数ではなく **future utility / durability** で行う。

1回しか出ていなくても、以下は保存候補:

* 継続プロジェクトの重要な決定
* 今後も使う制約
* 明確な好み
* 設計方針
* 計画
* ユーザーによる重要な訂正
* 将来の会話で再利用する可能性が高い状態

反対に、その場だけの質問・一般知識・一時的なDOM情報などは保存しない。

## Memory size / forgetting

1000文字は**容量上限であり目標ではない**。

メモリを上限近くまで言い換えて詰め込む挙動を避ける。

目安として:

* 通常は300〜600文字程度のhigh-signalな内容
* 長くなってきたら圧縮だけでなく情報を削除する
* 700〜800文字を超える場合は、古い・低価値・重複・置換済み情報を積極的に見直す
* 1000文字ぎりぎりへ調整しない

memory maintenanceでは以下を区別する。

* add/update
* correction
* superseded information
* stale / low-value information
* duplicate

自然なforgettingを許可し、低価値な古い情報を永久に蓄積しない。

## Compaction

現在のcheckpoint型compactionの方向性は維持する。

残すべきもの:

* 目的
* 現在の作業状態
* 重要な判断と理由
* 確認済み事実
* side effect / 完了済み操作
* unresolved issue
* 次に行うべきこと
* 復元困難な識別子・正確な値

削るもの:

* 生のtool output
* 重複探索
* 一時DOM ref
* 不要になった仮説
* 後続作業に影響しない細部

「最大限情報を残す」ではなく、**次のエージェントが作業を復元できる最小のhigh-signal checkpoint** を目標にする。

## Runtime context

以下はmemoryではなく、各request/sessionでsystem側からruntime contextとして与える。

* current date
* timezone
* country / region（信頼できる場合。推定ならそのことが分かる表現）
* preferred answer language

日付のように頻繁に変化する情報を永続memoryへ保存しない。

## 設計原則

詳細なルールを大量に追加してLLMを縛りすぎない。

目指すのは、

* high-signal context
* progressive retrieval
* visible user stateの保護
* selective memory
* explicit forgetting
* bounded working state

である。

既存プロンプト・tool descriptionと重複するルールは統合し、できるだけ短くする。

実装後、少なくとも以下のケースで期待挙動を確認すること。

1. 「これどういう意味？」→ viewport/selection中心
2. 「この記事を要約して」→ whole page
3. Web検索 → background tabs中心で現在タブを維持
4. interactionが必要 → 必要時のみswitch
5. 1回だけ提示された重要な設計判断 → memory更新
6. 一時的な質問 → memory更新なし
7. memoryが肥大化 → 上限へ詰め込まず不要情報を削除
8. 過去会話が不要な質問 → session searchをしない
