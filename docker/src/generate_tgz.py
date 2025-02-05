import os
import boto3
import logging
from datetime import datetime
import json
import random
import time
import tarfile
import tempfile

# ロギングの設定
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def generate_large_tgz(file_path: str, size_gb: int):
    """指定されたサイズの大容量tgzファイルを生成する"""
    # 1GBのブロックサイズ
    block_size = 1024 * 1024 * 1024
    # 1GBのデータブロック（ゼロで初期化）
    data_block = b'\0' * block_size
    
    try:
        # 一時ファイルを作成
        with tempfile.NamedTemporaryFile(delete=False) as temp_file:
            temp_path = temp_file.name
            # 指定されたGBサイズまでブロックを書き込む
            for _ in range(size_gb):
                temp_file.write(data_block)
            temp_file.flush()
        
        # 一時ファイルをtgzに圧縮
        with tarfile.open(file_path, 'w:gz') as tar:
            tar.add(temp_path, arcname=os.path.basename(file_path).replace('.tgz', '.dat'))
        
        # 一時ファイルを削除
        os.unlink(temp_path)
        
        # ファイルサイズを確認
        actual_size = os.path.getsize(file_path)
        logger.info(f"ファイル生成完了: {file_path} (サイズ: {actual_size / (1024**3):.2f} GB)")
        return True
    except Exception as e:
        logger.error(f"ファイル生成中にエラーが発生: {str(e)}")
        if os.path.exists(temp_path):
            os.unlink(temp_path)
        return False

def main():
    logger.info("大容量tgzファイル生成バッチジョブを開始します")
    start_time = time.time()
    
    try:
        # 環境変数から設定を読み込む
        scratch_path = os.environ.get('SCRATCH_PATH', '/scratch')
        logger.info(f"Scratchパス: {scratch_path}")
        
        # 出力ディレクトリが存在しない場合は作成
        os.makedirs(scratch_path, exist_ok=True)
        
        # 24回の処理を実行
        for i in range(24):
            process_start_time = time.time()
            
            # ランダムなファイルサイズを決定（100-300GB）
            file_size_gb = random.randint(100, 300)
            file_name = f"test_file_{i+1:02d}_{file_size_gb}GB.tgz"
            file_path = os.path.join(scratch_path, file_name)
            
            logger.info(f"\n=== 処理 {i+1}/24 開始 ===")
            logger.info(f"ファイル名: {file_name}")
            logger.info(f"目標サイズ: {file_size_gb}GB")
            
            # ファイルを生成
            if not generate_large_tgz(file_path, file_size_gb):
                raise Exception(f"ファイル生成に失敗しました: {file_name}")
            
            process_end_time = time.time()
            process_duration = process_end_time - process_start_time
            logger.info(f"処理 {i+1} 完了 - 所要時間: {process_duration:.2f}秒")
        
        end_time = time.time()
        total_duration = end_time - start_time
        
        logger.info("\n=== バッチジョブ完了 ===")
        logger.info(f"開始時刻: {datetime.fromtimestamp(start_time).strftime('%Y-%m-%d %H:%M:%S')}")
        logger.info(f"終了時刻: {datetime.fromtimestamp(end_time).strftime('%Y-%m-%d %H:%M:%S')}")
        logger.info(f"総処理時間: {total_duration:.2f}秒 ({total_duration/3600:.2f}時間)")
        
    except Exception as e:
        logger.error(f"エラーが発生しました: {str(e)}")
        raise

if __name__ == "__main__":
    main()