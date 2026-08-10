#!/bin/bash
# dictation を Google Cloud Run へデプロイし、公開URLが実際に応答するところまで確認する。
# 前提・料金プランについては CLAUDE.md の「Deployment」節を参照。
set -euo pipefail

# --- 設定（spec.txt 5-7／5-8節・README.md「デプロイ（Google Cloud Run）」節が正） ---
EXPECTED_PROJECT="dictation-503003"
SERVICE="dictation"
REGION="us-central1"            # 無料枠対象は us-central1 / us-east1 / us-west1 のみ
EXPECTED_URL="https://dictation-1054688819377.us-central1.run.app"
BODY_MARKER="Dictation - Pronunciation Check"   # index.html の <title>
REQUIRED_APIS="run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com"

cd "$(dirname "$0")"

# =====================================================================
# 1. gcloud のプロジェクト設定を確認して表示
# =====================================================================
echo "=== 1. gcloud の設定確認 ==="

if ! command -v gcloud >/dev/null 2>&1; then
  echo "エラー: gcloud コマンドが見つかりません。Google Cloud SDK を導入してください。" >&2
  exit 1
fi

ACCOUNT="$(gcloud config get-value account 2>/dev/null || true)"
PROJECT="$(gcloud config get-value project 2>/dev/null || true)"

echo "  アカウント : ${ACCOUNT:-（未設定）}"
echo "  プロジェクト: ${PROJECT:-（未設定）}"
echo "  リージョン  : ${REGION}（無料枠対象）"
echo "  サービス名  : ${SERVICE}"

if [ -z "$ACCOUNT" ]; then
  echo "エラー: gcloud にログインしていません。'gcloud auth login' を実行してください。" >&2
  exit 1
fi

if [ "$PROJECT" != "$EXPECTED_PROJECT" ]; then
  echo "エラー: 想定と違うプロジェクトが設定されています。" >&2
  echo "  想定: ${EXPECTED_PROJECT} / 実際: ${PROJECT:-（未設定）}" >&2
  echo "  意図した切り替えなら、このスクリプトの EXPECTED_PROJECT を直してください。" >&2
  echo "  そうでなければ: gcloud config set project ${EXPECTED_PROJECT}" >&2
  exit 1
fi

# 必要なAPIの有効化チェック（失敗しても続行できるよう参考情報の扱いにする）
ENABLED="$(gcloud services list --enabled --format='value(config.name)' 2>/dev/null || true)"
if [ -n "$ENABLED" ]; then
  for api in $REQUIRED_APIS; do
    if printf '%s\n' "$ENABLED" | grep -qx "$api"; then
      echo "  API 有効: ${api}"
    else
      echo "  警告: API が無効の可能性があります: ${api}" >&2
      echo "        有効化: gcloud services enable ${api}" >&2
    fi
  done
else
  echo "  （APIの有効化状況は確認できませんでした。必要なAPI: ${REQUIRED_APIS}）"
fi

echo
printf "上記の設定で %s へデプロイします。よろしいですか? [y/N]: " "$EXPECTED_PROJECT"
read -r REPLY_CONFIRM
case "$REPLY_CONFIRM" in
  [yY]|[yY][eE][sS]) ;;
  *) echo "中止しました。"; exit 1 ;;
esac

# =====================================================================
# 2. デプロイ（README.md と同じ引数）
# =====================================================================
echo
echo "=== 2. Cloud Run へデプロイ ==="

gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300 \
  --allow-unauthenticated

# =====================================================================
# 3. 公開URLの動作確認（「デプロイは成功したのに500を返す」を検出する）
# =====================================================================
echo
echo "=== 3. 公開URLの動作確認 ==="

DESCRIBED_URL="$(gcloud run services describe "$SERVICE" --region "$REGION" \
                  --format='value(status.url)' 2>/dev/null || true)"
# Cloud Runは1つのサービスに2種類のホスト名を割り当てる（どちらも同じサービスを指す）：
#   ・https://<サービス>-<プロジェクト番号>.<リージョン>.run.app … spec.txt 5-8節に記録した公開URL
#   ・https://<サービス>-<ハッシュ>-<略記>.a.run.app          … describe が返すのはこちらの形式
# したがって describe の結果と記録が食い違っても異常ではない。
# 利用者が実際に開くのは記録側のURLなので、そちらを主として確認する。
URL="$EXPECTED_URL"
echo "  公開URL（記録） : ${URL}"
if [ -n "$DESCRIBED_URL" ]; then
  echo "  describeのURL   : ${DESCRIBED_URL}"
else
  echo "  （describeでURLを取得できませんでした。記録済みURLのみ確認します）"
fi

BODY_FILE="$(mktemp)"
API_BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE" "$API_BODY_FILE"' EXIT

# トップページを確認する。コールドスタートでモデル読み込みに十数秒かかることがあるため、
# 余裕をもって待ち、数回まで再試行する。
check_top_page() {
  local url="$1"
  local code=""
  local attempt
  for attempt in 1 2 3; do
    code="$(curl -sS -o "$BODY_FILE" -w '%{http_code}' --max-time 120 "$url" || echo "000")"
    [ "$code" = "200" ] && break
    echo "  HTTP ${code} でした。5秒後に再試行します（${attempt}/3）"
    sleep 5
  done

  if [ "$code" != "200" ]; then
    echo "  → 失敗: ${url} が HTTP ${code} を返しました。" >&2
    echo "  ----- レスポンス本文（先頭20行）-----" >&2
    head -n 20 "$BODY_FILE" >&2 || true
    echo "  -------------------------------------" >&2
    return 1
  fi

  # HTTP 200 でも中身がエラーページのことがあるため本文まで見る
  if ! grep -q "$BODY_MARKER" "$BODY_FILE"; then
    echo "  → 失敗: HTTP 200 でしたが、本文に期待する文字列がありません: ${BODY_MARKER}" >&2
    echo "  ----- レスポンス本文（先頭20行）-----" >&2
    head -n 20 "$BODY_FILE" >&2 || true
    echo "  -------------------------------------" >&2
    return 1
  fi

  echo "  OK: ${url} トップページ HTTP 200 ／ 本文に \"${BODY_MARKER}\" を確認"
  return 0
}

if ! check_top_page "$URL"; then
  if [ -n "$DESCRIBED_URL" ] && check_top_page "$DESCRIBED_URL"; then
    echo "記録済みの公開URLが応答しませんが、describeのURLは正常です。" >&2
    echo "公開URLが変わった可能性があります。spec.txt 5-8節・README.md・CLAUDE.mdと" >&2
    echo "このスクリプトの EXPECTED_URL を ${DESCRIBED_URL} に更新してください。" >&2
  fi
  echo "ログ: gcloud run services logs read ${SERVICE} --region ${REGION} --limit 50" >&2
  exit 1
fi

if [ -n "$DESCRIBED_URL" ] && [ "$DESCRIBED_URL" != "$URL" ]; then
  check_top_page "$DESCRIBED_URL" || echo "  （参考情報のため続行します）"
fi

# サーバー側の処理（出題API）も通るか確認する。トップページは静的HTMLを返すだけなので、
# ここが500を返していてもトップページのHTTP 200だけでは気づけない。
API_CODE="$(curl -sS -o "$API_BODY_FILE" -w '%{http_code}' --max-time 120 \
             -X POST "${URL}/api/sentence/random" \
             -H 'Content-Type: application/json' \
             -d '{"difficulty":"beginner"}' || echo "000")"

if [ "$API_CODE" != "200" ] || ! grep -q '"sentence"' "$API_BODY_FILE"; then
  echo "失敗: 出題API が HTTP ${API_CODE} を返しました。" >&2
  head -n 20 "$API_BODY_FILE" >&2 || true
  echo "ログ: gcloud run services logs read ${SERVICE} --region ${REGION} --limit 50" >&2
  exit 1
fi
echo "  OK: 出題API HTTP 200 ／ 出題文を取得"

echo
echo "デプロイ完了: ${URL}"
echo "※ 文字起こし（音声を送っての判定）はブラウザから手動で確認してください。"
