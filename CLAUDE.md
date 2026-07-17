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

## 既存資産・その他
- `scripts/`：初期プロトタイプ（record.py, audio_llm.py, audio_gui.py）。Whisper+ollama(llama3)の組み合わせを試した名残だが、本アプリではollamaは使用していない
- Python実行環境：`brew`やpyenvではなく、システムの`python3`（ユーザー領域に`pip install --user`でパッケージ導入済み）を使用する
