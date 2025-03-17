#!/bin/bash

# 使用方法:
# $1: 書き込み回数 (デフォルト: 1)
# $2: ファイルサイズ（GB） (デフォルト: 20)
# $3: 書き込み先ディレクトリ (デフォルト: /data)
# $4: S3バケット名 (必須)

# S3バケット名が指定されているか確認
if [ -z "$4" ]; then
    echo "エラー: S3バケット名を指定してください"
    echo "使用方法: $0 [書き込み回数] [ファイルサイズGB] [書き込み先ディレクトリ] [S3バケット名]"
    exit 1
fi

# デフォルトの設定
WRITE_COUNT=${1:-1}
FILE_SIZE_GB=${2:-20}  # デフォルト20GB
DATA_DIR=${3:-"/data"}
S3_BUCKET=$4

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
declare -a download_times
declare -a upload_times

echo "開始時刻: $(date '+%Y-%m-%d %H:%M:%S')"

for ((i=1; i<=WRITE_COUNT; i++)); do
    file_name="test_file_${i}"
    prev_file_name="test_file_$((i-1))"
    
    # 前回のファイルをS3からダウンロード（2回目以降）
    if [ $i -gt 1 ]; then
        echo "前回のファイル（${prev_file_name}）をS3からダウンロードします..."
        download_start_time=$(date +%s.%N)
        
        aws s3 cp "s3://${S3_BUCKET}/${prev_file_name}.txt" "${DATA_DIR}/${prev_file_name}.txt"
        if [ $? -ne 0 ]; then
            echo "S3からのダウンロードに失敗しました"
            exit 1
        fi
        
        download_end_time=$(date +%s.%N)
        download_time=$(echo "${download_end_time} - ${download_start_time}" | bc)
        download_times[$i]=$download_time
        echo "ダウンロード完了（所要時間: ${download_time} 秒）"
        
        # ダウンロードしたファイルを削除
        echo "ダウンロードしたファイルを削除します..."
        sudo rm -f "${DATA_DIR}/${prev_file_name}.txt"
        echo "ファイルの削除が完了"
    fi
    
    # 書き込み開始時刻を記録
    start_time=$(date +%s.%N)
    
    echo "ファイル${i}の書き込みを開始: $(date '+%Y-%m-%d %H:%M:%S')"
    
    # ファイル書き込みを実行
    sudo dd if=/dev/zero of="${DATA_DIR}/${file_name}.txt" bs=200M count=${COUNT} oflag=direct conv=fdatasync
    
    # 書き込み終了時刻を記録
    end_time=$(date +%s.%N)
    
    # 実際のファイルサイズを取得
    file_size=$(ls -lh "${DATA_DIR}/${file_name}.txt" | awk '{print $5}')
    
    # 経過時間を計算
    write_time=$(echo "${end_time} - ${start_time}" | bc)
    
    echo "ファイル${i}の書き込みが完了"
    echo "  - 終了時刻: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "  - 所要時間: ${write_time} 秒"
    echo "  - ファイルサイズ: ${file_size}"
    
    # 結果を配列に保存
    write_times[$i]=$write_time
    file_sizes[$i]=$file_size
    
    # S3にファイルをアップロード
    echo "ファイルをS3にアップロードします..."
    upload_start_time=$(date +%s.%N)
    
    aws s3 cp "${DATA_DIR}/${file_name}.txt" "s3://${S3_BUCKET}/${file_name}.txt"
    if [ $? -ne 0 ]; then
        echo "S3へのアップロードに失敗しました"
        exit 1
    fi
    
    upload_end_time=$(date +%s.%N)
    upload_time=$(echo "${upload_end_time} - ${upload_start_time}" | bc)
    upload_times[$i]=$upload_time
    echo "アップロード完了（所要時間: ${upload_time} 秒）"
    
    # ローカルのファイルを削除
    echo "ローカルファイルを削除します..."
    sudo rm -f "${DATA_DIR}/${file_name}.txt"
    echo "ファイルの削除が完了"
    echo "----------------------------------------"
done

echo "全ての処理が完了"
echo "終了時刻: $(date '+%Y-%m-%d %H:%M:%S')"

# サマリーを表示
echo "=== 実行サマリー ==="
echo "総書き込みファイル数: ${WRITE_COUNT}"
echo "指定ファイルサイズ: ${FILE_SIZE_GB}GB"
for ((i=1; i<=WRITE_COUNT; i++)); do
    echo "ファイル${i}:"
    echo "  - 書き込み所要時間: ${write_times[$i]} 秒"
    echo "  - サイズ: ${file_sizes[$i]}"
    if [ $i -gt 1 ]; then
        echo "  - ダウンロード所要時間: ${download_times[$i]} 秒"
    fi
    echo "  - アップロード所要時間: ${upload_times[$i]} 秒"
done