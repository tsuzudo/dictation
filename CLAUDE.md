# CLAUDE.md

このファイルは、このリポジトリで作業するClaude Code (claude.ai/code) へのガイドです。

## リポジトリの目的

英語学習のための発音チェックアプリ「dictation」を作る。
自分で用意した英文（プリセットまたは自由入力）を音読し、Whisperで文字起こしした結果と
出題文を比較して発音をチェックする。参考にしたアプリ：Eリピ
（https://qiita.com/RyumaRyama/items/bdfeff51f75b53a09e0e）

## 重要な運用ルール
将来的にWebサーバーを通して一般ユーザに使ってもらうことを考えている。詳細はspec.txtの2節に記録している。

## ドキュメント構成
- `spec.txt`：要件仕様書（生きたドキュメント。決定事項は日付付きで追記する運用）
- `UI_function.txt`：UI・機能設計書
- 新しい仕様変更が入ったら、まずこの2つのファイルに日付付きで反映してから実装に進めること

## 実装状況（2026-07-14 MVP完成）
- `app/`：Flask（Python）バックエンド＋ブラウザ画面のフロントエンド
- `app/app.py`：出題API、`say`コマンドでのお手本再生、sounddeviceでの録音、Whisperでの文字起こし、difflibでの単語単位差分判定
- `app/sentences.json`：初級・中級・上級のプリセット出題文
- `run.sh`：起動スクリプト（`./run.sh` を実行するとサーバー起動＋ブラウザが開く）
- 米・英・豪のアクセント切り替えに対応（お手本の声を切り替えるのみ。判定ロジックは共通）

## Deployment（GitHub Pages・現行の公開先）

2026-08-18に、文字起こしをブラウザ内へ移して静的ホスティングへ移行した（spec.txt 9-2・9-3節）。

- 公開URL：**https://tsuzudo.github.io/dictation/**
- リポジトリ：`tsuzudo/dictation`（Pages利用のためパブリック）
- `main` へ push すると `.github/workflows/pages.yml` が自動デプロイする（手作業なし）
- 公開用の配置は `build_site.sh` が `app/` から作る。**`app/` が唯一の正**であり、公開用のコピーを別に持たない
- **課金の心配が無いことが移行の目的**。無料枠に依存する構成そのものを避けたいという判断（spec.txt 9-2節）

### 触るときの注意
- **パスは必ず相対で書くこと。** Pagesはサイトを`/dictation/`配下に置くため、`/static/...`と
  絶対で書くと404になる。相対にしておけばCloud Run版（`/`直下）とも共用できる
- `sentences.json`は`app/static/`にある（ブラウザが`fetch`で取りに行くため）
- 判定ロジックは`app/static/scoring.js`（`app.py`からの移植）。**両者を変更したら
  `python3 tests/compare_scoring.py` で出力が一致することを必ず確認する**
- **Transformers.jsは`3.8.1`、deviceは`wasm`に固定すること（spec.txt 9-4節）。**
  4系はWASMで量子化モデルを読めず、3.8.1はWebGPUだと出力が壊れる。どちらも
  「WebGPUが使える環境では正常に見える」ため、変更する場合は**WebGPUを無効にした状態で
  文字起こし結果まで**実機確認すること（`tests/browser_check.html`が両方を検査する）

## Deployment（Google Cloud Run・**2026-08-18に停止済み**）

> **現在このサービスは止まっている（公開URLは403）。** 静的版がSafari実機で動作したため、
> 課金リスクをゼロにする目的でIAMから`allUsers`を外した（spec.txt 9-5節）。削除ではないので、
> 再開したいときは次のコマンドで戻せる：
> ```
> gcloud run services add-iam-policy-binding dictation --region us-central1 \
>   --member="allUsers" --role="roles/run.invoker"
> ```
> `app.py`・`Dockerfile`・`deploy.sh`は当面残す（様子を見て問題なければ削除する方針）。
> 以下は稼働していた当時の手順で、再開する場合の参考。


一般公開はGoogle Cloud Runで行っている（決定の経緯はspec.txt 5-7節、実施記録は5-8節）。

### 構成
- Googleプロジェクト：`dictation-503003`（プロジェクト名 `dictation`）
- Cloud Runサービス名：`dictation`
- リージョン：**`us-central1`**
- 公開URL：https://dictation-1054688819377.us-central1.run.app
- 事前に有効化が必要なAPI（3つ）：`run.googleapis.com` / `cloudbuild.googleapis.com` / `artifactregistry.googleapis.com`
- **公開URLは2形式ある**（どちらも同じサービス）。`gcloud run services describe`が返すのは
  `https://dictation-mum4tce77a-uc.a.run.app` の形式で、上の記録と違っていても異常ではない（spec.txt 5-10節）

### デプロイ手順
`./deploy.sh` を実行する。中身は「設定確認 → デプロイ → 公開URLへのcurl確認」の3段。
最後のcurl確認は、**デプロイ自体は成功したのにアプリが500を返す**状態を検出するために必ず行う
（トップページのHTTP 200だけでは静的HTMLしか確かめられないため、出題APIも叩いている）。

`deploy.sh` が実行している`gcloud`コマンド（README.mdの「デプロイ（Google Cloud Run）」節と同一。
引数を変える場合は両方＋spec.txt 5-8節を揃えること）：

```bash
gcloud run deploy dictation \
  --source . \
  --region us-central1 \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300 \
  --allow-unauthenticated
```

- `--source .`：ローカルにDockerが無くてもGoogle側（Cloud Build）でイメージをビルドできる。
  開発環境にDocker Desktopは導入しない方針のため、この方式が前提
- `--allow-unauthenticated`：一般公開のため必須（外すとブラウザから開けなくなる）
- `--memory 2Gi`：Whisper（faster-whisper `base`）が512MB枠に収まらないため

### 料金プランの前提（2026-07-20時点）
- **Cloud Runの無料枠（月200万リクエスト・36万GiB秒）の範囲内で運用し、請求0円**という前提で
  この構成を選んでいる。アクセスが無い間はインスタンスが停止し課金対象外になる
- 無料枠の対象リージョンは **`us-central1` / `us-east1` / `us-west1` のみ**。
  リージョンを変えると無料枠から外れるため、勝手に変更しないこと
- 課金アカウント（クレジットカード）の登録は済んでいる（無料枠内なら請求は0円）
- コールドスタート（久しぶりの初回アクセスで十数秒）は**許容する**方針。
  最小インスタンス数1にすれば解消するが、常時起動となり無料枠を超えるため採用しない

### 前提が変わっていた場合のルール（重要）
料金・無料枠・提供状況が上記の前提と違っていた場合、**黙って別のリージョン・別のサービス・
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
