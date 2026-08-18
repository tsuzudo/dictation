# -*- coding: utf-8 -*-
"""静的ファイルをそのまま配る確認用サーバー（spec.txt 9-2節のフェーズ3の前段）。

GitHub Pagesと同じ「静的ファイルを配るだけ」の状態を手元で再現するために使う。
`python3 -m http.server` を使わないのは、この環境では既定値の os.getcwd() 評価で
PermissionError になるため。配信ディレクトリを明示して回避している。

実行:  python3 tests/serve.py [ポート番号] [配信ルート]
"""

import http.server
import socketserver
import sys
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
# 配信ルート。省略時はリポジトリ直下。
# GitHub Pagesは /dictation/ のようなサブパス配下に置かれるため、
# その状況を手元で再現したいときは第2引数でルートを指定する
ROOT = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else Path(__file__).resolve().parent.parent


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        # 確認のたびに古いJSを掴まないようキャッシュを無効化する
        # （Flaskのテンプレートキャッシュで「古いHTML＋新しいJS」になった過去の失敗と同種の事故を防ぐ）
        self.send_header("Cache-Control", "no-store")
        # 別ポートで動くFlask版の画面からテスト音声を取得できるようにする（確認用）
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


class Server(socketserver.TCPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    with Server(("127.0.0.1", PORT), Handler) as httpd:
        print(f"配信ルート: {ROOT}")
        print(f"http://127.0.0.1:{PORT}/tests/browser_check.html")
        httpd.serve_forever()
