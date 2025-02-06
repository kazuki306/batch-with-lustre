import subprocess
import time
import os
from datetime import datetime

def execute_command(command):
    """シェルコマンドを実行し、出力を返す"""
    try:
        result = subprocess.run(command, shell=True, check=True, 
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              text=True)
        return result.stdout
    except subprocess.CalledProcessError as e:
        print(f"コマンド実行エラー: {e}")
        print(f"エラー出力: {e.stderr}")
        raise

def get_stripe_info(path):
    """Lustreのストライピング情報を取得"""
    return execute_command(f"lfs getstripe {path}")

def set_stripe_all_osts(path):
    """全OSTを使用するストライピング設定"""
    print("全OSTを使用するストライピング設定を実行...")
    # ストライプサイズを20MB、利用可能な全OSTを使用
    execute_command(f"lfs setstripe -c -1 {path}")
    print("ストライピング設定完了")
    print("\n現在のストライピング設定:")
    print(get_stripe_info(path))

def get_ost_usage():
    """各OSTの使用状況を取得"""
    return execute_command("lfs df -h")

def write_test_file(path, size_gb=20, stripe_type="no_stripe"):
    """テストファイル書き込み"""
    file_path = os.path.join(path, f"test_{size_gb}gb_{stripe_type}")
    
    print(f"\n{size_gb}GBのテストファイル書き込みを開始...")
    print("書き込み前のOST使用状況:")
    print(get_ost_usage())
    
    start_time = time.time()
    
    # ddコマンドでファイル書き込み（高速化オプション付き）
    block_size = "20M"
    count = int((size_gb * 1024) / 20)  # 20MBブロックサイズでの必要カウント数
    execute_command(f"dd if=/dev/zero of={file_path} bs={block_size} count={count} oflag=direct conv=sparse")
    
    end_time = time.time()
    duration = end_time - start_time
    
    print(f"\n書き込み完了")
    print(f"所要時間: {duration:.2f}秒")
    print(f"平均書き込み速度: {(size_gb * 1024 / duration):.2f} MB/s")
    
    print("\n書き込み後のOST使用状況:")
    print(get_ost_usage())
    
    return duration

def main():
    """メイン処理"""
    lustre_path = "/scratch"  # Lustreのマウントポイント
    
    print("=== Lustreストライピングテスト開始 ===")
    print(f"テスト時刻: {datetime.now()}")
    
    # 初期状態の確認
    print("\n初期状態のストライピング設定:")
    print(get_stripe_info(lustre_path))
    
    # ストライピングなしでの書き込みテスト
    print("\n=== ストライピングなしでの書き込みテスト ===")
    no_stripe_duration = write_test_file(lustre_path, stripe_type="no_stripe")
    
    # 全OSTを使用するストライピング設定
    print("\n=== ストライピング設定の変更 ===")
    set_stripe_all_osts(lustre_path)
    
    # ストライピングありでの書き込みテスト
    print("\n=== ストライピングありでの書き込みテスト ===")
    with_stripe_duration = write_test_file(lustre_path, stripe_type="with_stripe")
    
    # 結果の比較
    print("\n=== テスト結果の比較 ===")
    print(f"ストライピングなし: {no_stripe_duration:.2f}秒")
    print(f"ストライピングあり: {with_stripe_duration:.2f}秒")
    print(f"速度向上率: {(no_stripe_duration/with_stripe_duration):.2f}倍")

if __name__ == "__main__":
    main()