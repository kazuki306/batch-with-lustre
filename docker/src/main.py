import os
import boto3
import logging
from datetime import datetime
import json

# ロギングの設定
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def write_sample_data(output_path: str):
    """サンプルデータをJSONファイルとして書き込む"""
    data = {
        "timestamp": datetime.now().isoformat(),
        "message": "This is a sample data",
        "batch_job": "lustre-test"
    }
    
    # 出力ディレクトリが存在しない場合は作成
    os.makedirs(output_path, exist_ok=True)
    
    # タイムスタンプを含むファイル名を生成
    filename = f"sample_data_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    file_path = os.path.join(output_path, filename)
    
    # JSONファイルとして書き込み
    with open(file_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    return file_path

def list_directory_contents(path: str):
    """指定されたディレクトリ内のファイルとフォルダの一覧を取得"""
    try:
        # ディレクトリ内のすべてのファイルとフォルダを取得
        items = os.listdir(path)
        
        # ファイルとディレクトリを分類
        files = []
        directories = []
        
        for item in items:
            item_path = os.path.join(path, item)
            if os.path.isfile(item_path):
                # ファイルの場合、サイズも取得
                size = os.path.getsize(item_path)
                files.append({
                    "name": item,
                    "size": size,
                    "modified": datetime.fromtimestamp(os.path.getmtime(item_path)).isoformat()
                })
            elif os.path.isdir(item_path):
                directories.append(item)
        
        return {
            "files": files,
            "directories": directories
        }
    except Exception as e:
        logger.error(f"ディレクトリの内容取得中にエラーが発生しました: {str(e)}")
        raise

def main():
    logger.info("バッチジョブを開始します!!!")
    
    try:
        # 環境変数から設定を読み込む
        scratch_path = os.environ.get('SCRATCH_PATH', '/scratch')
        
        logger.info(f"Scratchパス: {scratch_path}")
        
        # scratchディレクトリにファイルを書き込む
        try:
            file_path = write_sample_data(scratch_path)
            logger.info(f"ファイルの書き込みに成功しました: {file_path}")
        except PermissionError as pe:
            logger.error(f"ファイルの書き込み権限がありません: {str(pe)}")
            raise
        except OSError as oe:
            logger.error(f"ファイルの書き込み中にOSエラーが発生しました: {str(oe)}")
            raise
        
        # scratchディレクトリの内容を取得して表示
        logger.info("Scratchディレクトリの内容を取得します...")
        contents = list_directory_contents(scratch_path)
        
        logger.info("=== ディレクトリ一覧 ===")
        for directory in contents["directories"]:
            logger.info(f"directory:\n {directory}")
        
        logger.info("\n=== ファイル一覧 ===")
        for file in contents["files"]:
            size_mb = file["size"] / (1024 * 1024)  # バイトからMBに変換
            logger.info(f"file: {file['name']} (サイズ: {size_mb:.2f}MB, 更新: {file['modified']})")
        
        logger.info("バッチジョブが正常に完了しました")
        
    except Exception as e:
        logger.error(f"エラーが発生しました: {str(e)}")
        raise

if __name__ == "__main__":
    main()