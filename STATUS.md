# STATUS

最終更新：2026-08-18

このファイルは「いま何がどうなっているか」を最短で把握するためのもの。
経緯や判断の理由は `spec.txt` に日付付きで記録してあるので、深掘りはそちらを見ること。

## これは何か

英語の発音チェックアプリ。英文（プリセット320件または自由入力）を音読し、
Whisperで文字起こしした結果と出題文を単語単位で比較して差分を色分け表示する。

## 現在地

- **公開中：https://tsuzudo.github.io/dictation/** （GitHub Pages）
- `main` へ push すると GitHub Actions が自動デプロイする。手作業は不要
- **文字起こしも判定もすべてブラウザ内で完結**。サーバーを持たないので課金の心配がない
- 音声は端末外に出ない
- Cloud Run版は**停止済み**（公開URLは403）。コードは残してあるが、動いてはいない

```
ブラウザ内で完結
  録音（MediaRecorder）
    → 16kHz PCMへ変換（Web Audio API）
    → 文字起こし（Transformers.js + Whisper tiny.en）
    → 判定（scoring.js：正規化 + 単語アライメント）
    → 差分を色分け表示
```

## 触る前に必ず知っておくこと

1. **Transformers.js は `3.8.1`、device は `wasm` に固定。変更しないこと。**
   4系はWASMで量子化モデルを読めず、3.8.1はWebGPUだと出力が壊れる。どちらも
   「WebGPUが使える環境では正常に見える」ため気づきにくい（実際に公開後の障害になった）。
   変更する場合はWebGPUを無効にした状態で**文字起こし結果まで**実機確認すること（spec.txt 9-4節）
2. **パスは相対で書くこと。** GitHub Pagesはサイトを `/dictation/` 配下に置くため、
   `/static/...` と絶対で書くと404になる（spec.txt 9-3節）
3. **`app/` が唯一の正。** 公開用のコピーは持たない。`build_site.sh` が `_site/` を組み立てる
4. **`app.py` と `app/static/scoring.js` の両方に判定ロジックがある。** 片方を直したら
   `python3 tests/compare_scoring.py` で出力が一致することを必ず確認する

## 保留・未解決

- **`app.py` / `Dockerfile` / `deploy.sh` の削除**：Cloud Run停止後も残置中。
  しばらく静的版を使って問題が無ければ削除する方針（ユーザー判断待ち）
- **複合語の分かち書き揺れ**：`seashore` を Whisper が `sea shore` と2語に分けて不一致になる。
  サーバー側のbaseモデルでも同じ結果のため移行による劣化ではない。正規化での対応は
  スコープ外と判断済み（spec.txt 9-2節）
- **初回ダウンロードの進捗率が前後する**：複数ファイルを並行取得し、ファイルごとの進捗を
  そのまま表示しているため `100% → 5%` と戻ることがある。実害は小さいと判断して未対応
- **難易度の表示と内部値**：表示は `Easy/Medium/Hard`、内部値は `beginner/intermediate/advanced`。
  意図的なマッピングで不具合ではない

## よく使うコマンド

```bash
python3 tests/compare_scoring.py              # 判定ロジックのPython版/JS版の一致確認
./build_site.sh                               # 公開用の配置を _site/ に作る
python3 tests/serve.py 8765 <配信ルート>      # 静的配信の確認用サーバー
```

ブラウザでの動作確認は `tests/browser_check.html`。モデル読み込み・文字起こし・判定に加えて、
実行デバイスとライブラリのバージョンも検査する。テスト音声の作り方はページ内に記載。

Cloud Runを再開したくなった場合：

```bash
gcloud run services add-iam-policy-binding dictation --region us-central1 \
  --member="allUsers" --role="roles/run.invoker"
```

## ドキュメント

| ファイル | 内容 |
|---|---|
| `spec.txt` | 要件仕様。決定事項を日付付きで追記する運用。移行の経緯は9-2〜9-5節 |
| `UI_function.txt` | UI・機能設計 |
| `CLAUDE.md` | 作業ルール、デプロイ手順、変更してはいけない箇所 |
| `README.md` | 使い方・仕組み・ライセンス |

ライセンスはMIT（`LICENSE`）。
