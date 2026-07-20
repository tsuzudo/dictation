# Google Cloud Run 用のイメージ定義（spec.txt 5-7節）
# ローカル開発では使わない（ローカルは ./run.sh で Flask 開発サーバーを起動する）
FROM python:3.11-slim

# rootのまま動かさないための専用ユーザー（万一侵入されたときの影響を小さくする）
RUN useradd -m -u 1000 user
USER user
# HF_HOME は Whisper モデルのキャッシュ先（書き込み可能な場所を明示する）
# PYTHONUNBUFFERED はログを即座に出すため（Spaces のログ画面ですぐ確認できる）
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    HF_HOME=/home/user/.cache/huggingface \
    PYTHONUNBUFFERED=1

WORKDIR $HOME/app

# 依存関係を先に入れる（アプリのコードだけ変えた時にこの層を再利用でき、ビルドが速い）
COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# Whisper モデルをビルド時にダウンロードしておく（初回起動を速くするため）
ARG WHISPER_MODEL=base
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('${WHISPER_MODEL}', device='cpu', compute_type='int8')"

COPY --chown=user app/ ./app/

# Cloud Run は待ち受けポートを環境変数 PORT で指定してくる（既定 8080）
EXPOSE 8080

# 本番用サーバー gunicorn で起動する。
# $PORT を展開する必要があるため shell 形式で書く（exec でシグナルを正しく受け取る）
# --workers 1 : Whisper モデルはプロセスごとにメモリへ読み込まれるため増やさない
# --threads 4 : 複数人の同時アクセスを捌く（文字起こし自体は transcribe_lock で直列化）
# --timeout 120 : 文字起こしに時間がかかってもワーカーを強制終了させない
CMD exec gunicorn --chdir app --bind 0.0.0.0:${PORT:-8080} \
    --workers 1 --threads 4 --timeout 120 app:app
