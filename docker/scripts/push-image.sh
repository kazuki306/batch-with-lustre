#!/bin/bash

# エラーが発生した場合にスクリプトを終了
set -e

# スクリプトの場所を取得
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"
DOCKER_DIR="$PROJECT_ROOT/docker"

# 変数の設定
AWS_REGION="${AWS_REGION:-ap-northeast-1}"  # 環境変数が設定されていない場合はデフォルト値を使用
# ECR_REPOSITORY_NAME="batch-with-lustre-job"
ECR_REPOSITORY_NAME="lustre-striping"
IMAGE_TAG="0.0.5"

echo "使用するAWSリージョン: ${AWS_REGION}"

# AWS アカウントIDの取得
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# ECRリポジトリのURIを構築
ECR_REPOSITORY_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPOSITORY_NAME}"

echo "ECRにログイン中..."
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

echo "Dockerイメージをビルド中..."
docker build -t ${ECR_REPOSITORY_NAME}:${IMAGE_TAG} ${DOCKER_DIR}

echo "イメージにタグを付与中..."
docker tag ${ECR_REPOSITORY_NAME}:${IMAGE_TAG} ${ECR_REPOSITORY_URI}:${IMAGE_TAG}

echo "ECRにイメージをプッシュ中..."
docker push ${ECR_REPOSITORY_URI}:${IMAGE_TAG}

echo "完了: イメージが正常にプッシュされました"
echo "イメージURI: ${ECR_REPOSITORY_URI}:${IMAGE_TAG}"