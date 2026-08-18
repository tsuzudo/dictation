#!/bin/bash
# GitHub Pagesで公開するファイルを _site/ に集める（spec.txt 9-2節）
#
# app/ が唯一の正であり、このスクリプトはそこから公開用の配置を作るだけ。
# GitHub Actions（.github/workflows/pages.yml）からも、手元での動作確認でも
# 同じこのスクリプトを使う。「手元では動くがActionsでは違う」を避けるため。
set -euo pipefail
cd "$(dirname "$0")"

rm -rf _site
mkdir -p _site/static
# Flask用のテンプレートだが、Jinja記法を除いたのでそのまま静的HTMLとして使える
cp app/templates/index.html _site/index.html
cp app/static/*.js app/static/*.css app/static/*.json _site/static/

echo "公開ファイルを _site/ に用意しました:"
find _site -type f | sort
