# CLAUDE.md

このファイルは、このリポジトリで作業するClaude Code (claude.ai/code) へのガイドです。

## リポジトリの目的

英語学習のための発音練習アプリ **「Listen&Talk」** を作る（2026-10-21に`Dictation`から
改名・spec.txt 1節。**リポジトリ名と公開URLは`dictation`のまま**）。
英文を音読し、Whisperで文字起こしした結果と出題文を比較して発音をチェックする。
参考にしたアプリ：Eリピ（https://qiita.com/RyumaRyama/items/bdfeff51f75b53a09e0e）

出題は3つ。**既定はスキット**（spec.txt 10-18節）。

| タブ | 内容 |
|---|---|
| スキット（既定） | 隣の`English_conversation/skit`の英会話14本。会話を選ぶと準備画面が出て、「全台詞／役を選ぶ／通しで聞く」から選んで始める（spec.txt 第10章） |
| ランダム出題 | プリセット320件から難易度別に1文ずつ |
| 自由入力 | 好きな英文を入れて練習 |

## 重要な運用ルール
将来的にWebサーバーを通して一般ユーザに使ってもらうことを考えている。詳細はspec.txtの2節に記録している。

## ドキュメント構成
- `spec.txt`：要件仕様書（生きたドキュメント。決定事項は日付付きで追記する運用）
- `UI_function.txt`：UI・機能設計書
- 新しい仕様変更が入ったら、まずこの2つのファイルに日付付きで反映してから実装に進めること

## 実装状況（2026-10-21時点）

**現行はブラウザ内で完結する静的版**（2026-08-18移行・spec.txt 9-2節）。
録音・文字起こし（Transformers.js + Whisper tiny.en）・判定・お手本読み上げ
（Web Speech API）をすべてブラウザで行い、サーバーは持たない。

- `app/templates/index.html`：画面。`app/static/script.js`：全体の制御と日英の文言辞書
- `app/static/scoring.js`：判定ロジック（**本番で動くのはこちら**）。
  `tests/reference_scoring.py`は答え合わせ用のPython版（参照実装）。
  **片方を直したらもう片方も直し、`python3 tests/compare_scoring.py` で
  一致を確認する**（spec.txt 11-2節）
- `app/static/sentences.json`：初級・中級・上級のプリセット出題文（ブラウザが`fetch`する）
- `app/static/transcriber.js`：Transformers.jsの読み込みと文字起こし
- 米・英・豪のアクセント切り替えに対応（お手本の声を切り替えるのみ。判定ロジックは共通）。
  **スキットタブではアクセントを使わず、話者A・Bの声を直接選ぶ**（spec.txt 10-16節）
- **SafariはPremiumの声をWebページへ渡さない**ため、画面に「MacのChrome推奨」と出している
  （spec.txt 10-17・10-24節）

手元で試すときは静的版をビルドして配信する（Flaskは使わない）:

```bash
./build_site.sh && python3 tests/serve.py 8099 _site
```

### 削除済み（2026-11-02）
- `app/app.py`・`Dockerfile`・`deploy.sh`・`run.sh`・`requirements.txt`：Cloud Run時代の
  Flask版。サービス停止（2026-08-18）から2か月半、静的版で問題が出なかったため削除した
  （spec.txt 11節）。**`app.py`が持っていた判定ロジックは`tests/reference_scoring.py`
  として残してある**（JavaScript版の答え合わせ相手として必要なため）
- 戻したい場合は`git checkout b48d514 -- app/app.py Dockerfile deploy.sh run.sh requirements.txt`

## Deployment（GitHub Pages・現行の公開先）

2026-08-18に、文字起こしをブラウザ内へ移して静的ホスティングへ移行した（spec.txt 9-2・9-3節）。

- 公開URL：**https://tsuzudo.github.io/dictation/**
- リポジトリ：`tsuzudo/dictation`（Pages利用のためパブリック）
- `main` へ push すると `.github/workflows/pages.yml` が自動デプロイする（手作業なし）
- 公開用の配置は `build_site.sh` が `app/` から作る。**`app/` が唯一の正**であり、公開用のコピーを別に持たない
- **課金の心配が無いことが移行の目的**。無料枠に依存する構成そのものを避けたいという判断（spec.txt 9-2節）

### 触るときの注意
- **パスは必ず相対で書くこと。** Pagesはサイトを`/dictation/`配下に置くため、`/static/...`と
  絶対で書くと404になる
- `sentences.json`は`app/static/`にある（ブラウザが`fetch`で取りに行くため）
- 判定ロジックは`app/static/scoring.js`（本番）と`tests/reference_scoring.py`
  （答え合わせ用のPython版）の2つがある。**どちらかを変更したら
  `python3 tests/compare_scoring.py` で出力が一致することを必ず確認する**
- **Transformers.jsは`3.8.1`、deviceは`wasm`に固定すること（spec.txt 9-4節）。**
  4系はWASMで量子化モデルを読めず、3.8.1はWebGPUだと出力が壊れる。どちらも
  「WebGPUが使える環境では正常に見える」ため、変更する場合は**WebGPUを無効にした状態で
  文字起こし結果まで**実機確認すること（`tests/browser_check.html`が両方を検査する）

## Deployment（Google Cloud Run・**完全に終了。GCPプロジェクトごと削除済み**）

> **この経路はもう存在しない。** 2026-08-18にサービスを非公開化し（spec.txt 9-5節）、
> 2026-11-02にコードを削除し（spec.txt 11節）、**同日GCPプロジェクト
> `dictation-503003`そのものを削除した（spec.txt 11-6節）。**
>
> - 削除したコード：`app/app.py`・`Dockerfile`・`deploy.sh`・`run.sh`・`requirements.txt`
>   （`git checkout b48d514 -- …` で復元はできる）
> - **ただしコードを戻してもデプロイ先が無い。** プロジェクトを消したので、再開するなら
>   GCPプロジェクトの新規作成・課金設定・API有効化からやり直すことになる
> - **旧プロジェクトID`dictation-503003`は二度と使えない**（GCPはIDの再利用を認めない）。
>   削除から30日以内に限り`gcloud projects undelete dictation-503003`で戻せる
> - 削除の理由：Artifact Registry（Dockerイメージの保管庫）に1,328MBが残っており、
>   無料枠の月0.5GBを超えて**使っていなくても保管料が発生し続ける状態**だったため
> - 当時の構成とデプロイ手順はspec.txt 5-7〜5-10節に残してあるが、**記載のプロジェクトID・
>   サービス名・リージョンはすでに実体を持たない記録である**

### 課金の前提が変わっていた場合のルール（重要・ホスティング先を問わず適用）
料金・無料枠・提供状況が記録と違っていた場合、**黙って別のリージョン・別のサービス・
別のプランに切り替えないこと。** 作業をそこで止め、2〜3案をトレードオフ（費用・手間・
性能・移行コスト）付きで提示し、ユーザーの判断を待つこと。
- 「無料だと思って進めたら課金されていた」「気づかないうちにホスティング先が変わっていた」
  という事態を避けるため
- 過去に実際に起きている：Hugging Face Spacesの Docker SDK が告知なく有料化され、
  決定済みだったホスティング先を撤回した（spec.txt 5-5節→5-7節）
- 判断が変わったら、spec.txtに日付付きで追記してからCLAUDE.mdとREADME.mdを直すこと

## 既存資産・その他
- `scripts/`：初期プロトタイプ（record.py, audio_llm.py, audio_gui.py）。Whisper+ollama(llama3)の組み合わせを試した名残だが、本アプリではollamaは使用していない
- Python実行環境：`brew`やpyenvではなく、システムの`python3`（ユーザー領域に`pip install --user`でパッケージ導入済み）を使用する
