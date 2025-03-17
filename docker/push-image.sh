#!/bin/bash

# エラーが発生した場合にスクリプトを終了
set -e

# 使用方法を表示する関数
usage() {
    echo "使用方法: $0 <リポジトリ名>"
    echo "例: $0 batch-job-with-ebs"
    echo "例: $0 batch-with-lustre-job"
    exit 1
}

# 引数のチェック
if [ $# -lt 1 ]; then
    echo "エラー: リポジトリ名が指定されていません"
    usage
fi

# 引数からリポジトリ名を取得
ECR_REPOSITORY_NAME="$1"

# スクリプトの場所を取得
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
DOCKER_DIR="$PROJECT_ROOT/docker"

# リポジトリ名に基づいてDockerfileのパスを決定
if [[ "$ECR_REPOSITORY_NAME" == *"ebs"* ]]; then
    DOCKERFILE_DIR="$DOCKER_DIR/ebs"
    echo "EBS用のDockerfileを使用します: $DOCKERFILE_DIR/Dockerfile"
elif [[ "$ECR_REPOSITORY_NAME" == *"lustre"* ]]; then
    DOCKERFILE_DIR="$DOCKER_DIR/lustre"
    echo "Lustre用のDockerfileを使用します: $DOCKERFILE_DIR/Dockerfile"
else
    echo "警告: リポジトリ名からDockerfileタイプを判断できません。デフォルトのDockerfileを使用します。"
    DOCKERFILE_DIR="$DOCKER_DIR"
fi

# 変数の設定
AWS_REGION="${AWS_REGION:-ap-northeast-1}"  # 環境変数が設定されていない場合はデフォルト値を使用
IMAGE_TAG="latest"

echo "使用するAWSリージョン: ${AWS_REGION}"
echo "使用するECRリポジトリ名: ${ECR_REPOSITORY_NAME}"

# AWS アカウントIDの取得
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# ECRリポジトリのURIを構築
ECR_REPOSITORY_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPOSITORY_NAME}"

echo "ECRにログイン中..."
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

echo "Dockerイメージをビルド中..."
docker build -t ${ECR_REPOSITORY_NAME}:${IMAGE_TAG} -f ${DOCKERFILE_DIR}/Dockerfile ${DOCKER_DIR}

echo "イメージにタグを付与中..."
docker tag ${ECR_REPOSITORY_NAME}:${IMAGE_TAG} ${ECR_REPOSITORY_URI}:${IMAGE_TAG}

echo "ECRにイメージをプッシュ中..."
docker push ${ECR_REPOSITORY_URI}:${IMAGE_TAG}

echo "完了: イメージが正常にプッシュされました"
echo "イメージURI: ${ECR_REPOSITORY_URI}:${IMAGE_TAG}"