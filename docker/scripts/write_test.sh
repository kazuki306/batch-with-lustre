#!/bin/bash

# デフォルトの設定
WRITE_COUNT=${1:-1}
FILE_SIZE_GB=${2:-20}  # デフォルト20GB

# 書き込み先ディレクトリを設定
SCRATCH_DIR="/scratch"

# bs=200M = 0.2GBなので、指定GBサイズを0.2で割ってcount数を計算
# 小数点以下を切り上げて、指定サイズ以上を確保
COUNT=$(echo "scale=0; ($FILE_SIZE_GB / 0.2 + 0.5)/1" | bc)

echo "設定情報:"
echo "- 書き込み回数: ${WRITE_COUNT}回"
echo "- 目標ファイルサイズ: ${FILE_SIZE_GB}GB"
echo "- ブロックサイズ: 200M"
echo "- カウント数: ${COUNT}"
echo "----------------------------------------"

# 結果を保存する配列
declare -a write_times
declare -a file_sizes

echo "開始時刻: $(date '+%Y-%m-%d %H:%M:%S')"

for ((i=1; i<=WRITE_COUNT; i++)); do
    file_name="test_file_${i}"
    
    # 書き込み開始時刻を記録
    start_time=$(date +%s.%N)
    
    echo "ファイル${i}の書き込みを開始: $(date '+%Y-%m-%d %H:%M:%S')"
    
    # ファイル書き込みを実行
    sudo dd if=/dev/zero of="${SCRATCH_DIR}/${file_name}.txt" bs=200M count=${COUNT} oflag=direct conv=fdatasync
    
    # 書き込み終了時刻を記録
    end_time=$(date +%s.%N)
    
    # 実際のファイルサイズを取得
    file_size=$(ls -lh "${SCRATCH_DIR}/${file_name}.txt" | awk '{print $5}')
    
    # 経過時間を計算
    write_time=$(echo "${end_time} - ${start_time}" | bc)
    
    echo "ファイル${i}の書き込みが完了"
    echo "  - 終了時刻: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "  - 所要時間: ${write_time} 秒"
    echo "  - ファイルサイズ: ${file_size}"
    echo "----------------------------------------"
    
    # 結果を配列に保存
    write_times[$i]=$write_time
    file_sizes[$i]=$file_size
done

echo "全ての書き込み処理が完了"
echo "終了時刻: $(date '+%Y-%m-%d %H:%M:%S')"

# サマリーを表示
echo "=== 実行サマリー ==="
echo "総書き込みファイル数: ${WRITE_COUNT}"
echo "指定ファイルサイズ: ${FILE_SIZE_GB}GB"
for ((i=1; i<=WRITE_COUNT; i++)); do
    echo "ファイル${i}:"
    echo "  - 所要時間: ${write_times[$i]} 秒"
    echo "  - サイズ: ${file_sizes[$i]}"
done