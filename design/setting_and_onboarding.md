# 設定画面について
でかいアイコン+chatextの文字列は削除
Safari etension onは意味わかんないので有効化されているか無効な状態か。有効化ボタンはmanage in SafariでSafariの設定画面を開く感じで。無効なときはenable in safari settingsみたいな感じで。
それと現状、iosではステータス表示とか有効にするボタンがないので、有効にするapiがあるなら可能なバージョンでMacOSと同様にそれを出すようにしたい。
ない場合は、Settings > Safari > Extensions > Chatext で有効化するように説明して。
Apple IDでサインインして無料で始めるか、BYOKで無料で始めるかを選べるよっていう説明文を出す。
## apple idの部分
apple idとか、サインインしているユーザーの名前を見えるようにしたい。
APIkeyのところ、shared with怪しいので、...encrypted and kept...みたいな感じにしてshared with消したい。

# Safari側について。
apiキーもなくapple idでサインインしてもいない場合、新規チャットの画面では設定画面を開くように誘導する。
メッセージ....
設定ボタンみたいな。
そのため上側のメニューはそのまま残して下側のチャット系は全部disableにするみたいな。
メッセージは、apple idでサインインして無料でstartできるか、bring your own keyして無料で使えるか。みたいな感じ。適当に考えて。
チャット履歴とかの画面はいじらなくていい。
