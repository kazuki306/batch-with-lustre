#!/bin/bash

# 使用方法:
# $1: 書き込み回数 (デフォルト: 1)
# $2: ファイルサイズ（GB） (デフォルト: 20)
# $3: 書き込み先ディレクトリ (デフォルト: /data)
# 環境変数 S3_BUCKET_NAME: S3バケット名 (必須)

# S3バケット名が環境変数に設定されているか確認
if [ -z "$S3_BUCKET_NAME" ]; then
    echo "エラー: 環境変数 S3_BUCKET_NAME が設定されていません"
    echo "使用方法: S3_BUCKET_NAME=バケット名 $0 [書き込み回数] [ファイルサイズGB] [書き込み先ディレクトリ]"
    exit 1
fi

# デフォルトの設定
WRITE_COUNT=${1:-1}
FILE_SIZE_GB=${2:-20}  # デフォルト20GB
DATA_DIR=${3:-"/data"}
S3_BUCKET=$S3_BUCKET_NAME

# bs=200M = 0.2GBなので、指定GBサイズを0.2で割ってcount数を計算
# 小数点以下を切り上げて、指定サイズ以上を確保
COUNT=$(echo "scale=0; ($FILE_SIZE_GB / 0.2 + 0.5)/1" | bc)

echo "ファイルシステムの状況:"
echo "----------------------------------------"
df -h
echo "----------------------------------------"

echo "設定情報:"
echo "- 書き込み回数: ${WRITE_COUNT}回"
echo "- 目標ファイルサイズ: ${FILE_SIZE_GB}GB"
echo "- ブロックサイズ: 200M"
echo "- カウント数: ${COUNT}"
echo "- 書き込み先ディレクトリ: ${DATA_DIR}"
echo "- S3バケット名: ${S3_BUCKET}"
echo "----------------------------------------"

# 結果を保存する配列
declare -a write_times
declare -a file_sizes

echo "開始時刻: $(date '+%Y-%m-%d %H:%M:%S')"

# 前回のファイルを追跡する変数
last_file=""

for ((i=1; i<=WRITE_COUNT; i++)); do
    file_name="test_file_${i}"
    current_file="${DATA_DIR}/${file_name}.txt"
    
    # 既存の大きな番号のファイルをチェック
    skip_current=false
    for existing_file in "${DATA_DIR}"/test_file_*.txt; do
        if [ -f "$existing_file" ]; then
            existing_num=$(echo "$existing_file" | grep -o '[0-9]\+' | tail -1)
            if [ "$existing_num" -gt "$i" ]; then
                echo "ファイル${i}をスキップ: より大きな番号のファイル(${existing_num})が存在します"
                skip_current=true
                break
            fi
        fi
    done
    
    if [ "$skip_current" = true ]; then
        continue
    fi
    
    # 書き込み開始時刻を記録
    start_time=$(date +%s.%N)
    
    echo "ファイル${i}の書き込みを開始: $(date '+%Y-%m-%d %H:%M:%S')"
    
    # ファイル書き込みを実行
    sudo dd if=/dev/zero of="$current_file" bs=200M count=${COUNT} oflag=direct conv=fdatasync
    
    # 書き込み終了時刻を記録
    end_time=$(date +%s.%N)
    
    # 実際のファイルサイズを取得
    file_size=$(ls -lh "$current_file" | awk '{print $5}')
    
    # 経過時間を計算
    write_time=$(echo "${end_time} - ${start_time}" | bc)
    
    echo "ファイル${i}の書き込みが完了"
    echo "  - 終了時刻: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "  - 所要時間: ${write_time} 秒"
    echo "  - ファイルサイズ: ${file_size}"
    
    # 結果を配列に保存
    write_times[$i]=$write_time
    file_sizes[$i]=$file_size
    
    # 前回のファイルが存在する場合は削除（新しいファイルの書き込み完了後に削除）
    if [ -n "$last_file" ] && [ -f "$last_file" ]; then
        echo "前回のファイル(${last_file})を削除します..."
        sudo rm -f "$last_file"
        echo "前回のファイルの削除が完了"
    fi
    
    # 現在のファイルを前回のファイルとして記録
    last_file="$current_file"
    
    echo "----------------------------------------"
done

# 最後のファイルが存在する場合はS3にコピーしてから保持
if [ -n "$last_file" ] && [ -f "$last_file" ]; then
    echo "最後のファイル(${last_file})をS3にコピーします..."
    file_name=$(basename "$last_file")
    aws s3 cp "$last_file" "s3://${S3_BUCKET}/${file_name}"
    if [ $? -eq 0 ]; then
        echo "S3へのコピーが完了しました"
        echo "最後のファイル(${last_file})は保持します"
    else
        echo "S3へのコピーに失敗しました"
        exit 1
    fi
fi

echo "全ての書き込み処理が完了"
echo "終了時刻: $(date '+%Y-%m-%d %H:%M:%S')"

# サマリーを表示
echo "=== 実行サマリー ==="
echo "総書き込みファイル数: ${WRITE_COUNT}"
echo "指定ファイルサイズ: ${FILE_SIZE_GB}GB"
for ((i=1; i<=WRITE_COUNT; i++)); do
    if [ -n "${write_times[$i]}" ]; then
        echo "ファイル${i}:"
        echo "  - 所要時間: ${write_times[$i]} 秒"
        echo "  - サイズ: ${file_sizes[$i]}"
    else
        echo "ファイル${i}: スキップされました"
    fi
done