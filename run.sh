#!/bin/bash
# dictationアプリを起動するスクリプト
# サーバーを立ち上げてから、既定のブラウザで画面を開く

cd "$(dirname "$0")/app" || exit 1

python3 app.py &
SERVER_PID=$!

# サーバーが起動するまで少し待つ（Whisperモデルの読み込みに数秒〜十数秒かかる）
sleep 3
# ローカルテストはChromeで開く（-a で明示指定。Chromeが無ければ既定ブラウザにフォールバック）
open -a "Google Chrome" "http://127.0.0.1:5001" 2>/dev/null || open "http://127.0.0.1:5001"

echo "サーバーを起動しました (PID: $SERVER_PID)"
echo "終了するには Ctrl+C を押すか、'kill $SERVER_PID' を実行してください。"

wait $SERVER_PID
