import subprocess
import time
import os
import json
from datetime import datetime
import matplotlib.pyplot as plt
from typing import Dict, List, Tuple

class LustrePerformanceTester:
    def __init__(self, mount_point: str = "/scratch"):
        """
        Lustreファイルシステムのパフォーマンステスター

        Args:
            mount_point (str): Lustreファイルシステムのマウントポイント
        """
        self.mount_point = mount_point
        self.results_dir = os.path.join(mount_point, "performance_results")
        os.makedirs(self.results_dir, exist_ok=True)

    def execute_command(self, command: str) -> str:
        """
        シェルコマンドを実行し、出力を返す

        Args:
            command (str): 実行するコマンド

        Returns:
            str: コマンドの出力
        """
        try:
            result = subprocess.run(command, shell=True, check=True,
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                  text=True)
            return result.stdout
        except subprocess.CalledProcessError as e:
            print(f"コマンド実行エラー: {e}")
            print(f"エラー出力: {e.stderr}")
            raise

    def write_test(self, size_mb: int, block_size: str = "1M") -> Tuple[float, float]:
        """
        書き込みパフォーマンステストを実行

        Args:
            size_mb (int): テストファイルのサイズ（MB）
            block_size (str): 書き込みブロックサイズ

        Returns:
            Tuple[float, float]: (所要時間, スループット MB/s)
        """
        test_file = os.path.join(self.mount_point, f"write_test_{size_mb}mb.dat")
        
        # キャッシュをクリアして正確な測定を行う
        self.execute_command("sync; echo 3 > /proc/sys/vm/drop_caches")
        
        print(f"\n=== 書き込みテスト: {size_mb}MB ===")
        start_time = time.time()
        
        count = size_mb // int(block_size[:-1])  # ブロックサイズでの必要カウント数
        self.execute_command(
            f"dd if=/dev/zero of={test_file} bs={block_size} count={count} "
            "oflag=direct conv=sparse status=progress"
        )
        
        end_time = time.time()
        duration = end_time - start_time
        throughput = size_mb / duration
        
        print(f"所要時間: {duration:.2f}秒")
        print(f"スループット: {throughput:.2f} MB/s")
        
        return duration, throughput

    def read_test(self, size_mb: int, block_size: str = "1M") -> Tuple[float, float]:
        """
        読み込みパフォーマンステストを実行

        Args:
            size_mb (int): テストファイルのサイズ（MB）
            block_size (str): 読み込みブロックサイズ

        Returns:
            Tuple[float, float]: (所要時間, スループット MB/s)
        """
        test_file = os.path.join(self.mount_point, f"write_test_{size_mb}mb.dat")
        if not os.path.exists(test_file):
            raise FileNotFoundError(f"テストファイルが存在しません: {test_file}")
        
        # キャッシュをクリアして正確な測定を行う
        self.execute_command("sync; echo 3 > /proc/sys/vm/drop_caches")
        
        print(f"\n=== 読み込みテスト: {size_mb}MB ===")
        start_time = time.time()
        
        count = size_mb // int(block_size[:-1])
        self.execute_command(
            f"dd if={test_file} of=/dev/null bs={block_size} count={count} "
            "iflag=direct status=progress"
        )
        
        end_time = time.time()
        duration = end_time - start_time
        throughput = size_mb / duration
        
        print(f"所要時間: {duration:.2f}秒")
        print(f"スループット: {throughput:.2f} MB/s")
        
        return duration, throughput

    def run_performance_tests(self, sizes_mb: List[int]) -> Dict:
        """
        一連のパフォーマンステストを実行

        Args:
            sizes_mb (List[int]): テストするファイルサイズのリスト（MB）

        Returns:
            Dict: テスト結果
        """
        results = {
            "timestamp": datetime.now().isoformat(),
            "mount_point": self.mount_point,
            "tests": []
        }

        for size_mb in sizes_mb:
            print(f"\n=== {size_mb}MB のテスト開始 ===")
            
            # 書き込みテスト
            write_duration, write_throughput = self.write_test(size_mb)
            
            # 読み込みテスト
            read_duration, read_throughput = self.read_test(size_mb)
            
            test_result = {
                "size_mb": size_mb,
                "write": {
                    "duration": write_duration,
                    "throughput": write_throughput
                },
                "read": {
                    "duration": read_duration,
                    "throughput": read_throughput
                }
            }
            results["tests"].append(test_result)

        return results

    def save_results(self, results: Dict):
        """
        テスト結果を保存し、グラフを生成

        Args:
            results (Dict): テスト結果
        """
        # 結果をJSONファイルとして保存
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        json_path = os.path.join(self.results_dir, f"results_{timestamp}.json")
        with open(json_path, 'w') as f:
            json.dump(results, f, indent=2)

        # グラフの生成
        sizes = [test["size_mb"] for test in results["tests"]]
        write_throughputs = [test["write"]["throughput"] for test in results["tests"]]
        read_throughputs = [test["read"]["throughput"] for test in results["tests"]]

        plt.figure(figsize=(10, 6))
        plt.plot(sizes, write_throughputs, 'b-o', label='Write')
        plt.plot(sizes, read_throughputs, 'r-o', label='Read')
        plt.xlabel('File Size (MB)')
        plt.ylabel('Throughput (MB/s)')
        plt.title('Lustre I/O Performance')
        plt.legend()
        plt.grid(True)

        # グラフを保存
        plt.savefig(os.path.join(self.results_dir, f"performance_graph_{timestamp}.png"))
        plt.close()

def main():
    """
    メイン処理
    """
    tester = LustrePerformanceTester()
    
    # テストするファイルサイズ（MB）
    test_sizes = [1024, 2048, 4096, 8192]  # 1GB, 2GB, 4GB, 8GB
    
    print("=== Lustre パフォーマンステスト開始 ===")
    print(f"テスト時刻: {datetime.now()}")
    print(f"マウントポイント: {tester.mount_point}")
    
    # テストの実行
    results = tester.run_performance_tests(test_sizes)
    
    # 結果の保存
    tester.save_results(results)
    
    print("\n=== テスト完了 ===")
    print(f"結果は {tester.results_dir} に保存されました")

if __name__ == "__main__":
    main()