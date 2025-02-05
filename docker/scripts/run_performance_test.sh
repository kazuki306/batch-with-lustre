#!/bin/bash

# Lustreパフォーマンステストを実行するスクリプト

# スクリプトのディレクトリを取得
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SRC_DIR="$SCRIPT_DIR/../src"

echo "=== Lustreパフォーマンステスト ==="
echo "実行時刻: $(date)"

# Pythonスクリプトを実行
python3 "$SRC_DIR/lustre_performance_test.py"

# 終了コードの確認
if [ $? -eq 0 ]; then
    echo "テストが正常に完了しました"
else
    echo "テスト実行中にエラーが発生しました"
    exit 1
fi