#!/bin/bash
# dictationアプリを起動するスクリプト
# サーバーを立ち上げてから、既定のブラウザで画面を開く

cd "$(dirname "$0")/app" || exit 1

python3 app.py &
SERVER_PID=$!

# サーバーが起動するまで少し待つ（Whisperモデルの読み込みに数秒〜十数秒かかる）
sleep 3
open "http://127.0.0.1:5001"

echo "サーバーを起動しました (PID: $SERVER_PID)"
echo "終了するには Ctrl+C を押すか、'kill $SERVER_PID' を実行してください。"

wait $SERVER_PID
