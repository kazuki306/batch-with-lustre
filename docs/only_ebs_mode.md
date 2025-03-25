# Only EBS モード

Only EBS モードは、AWS BatchとAmazon EBS（Elastic Block Store）を組み合わせたデプロイオプションで、FSx for Lustreを使用せずにシンプルなブロックストレージを提供します。

## 概要

このモードでは、高性能なEBSボリュームが作成され、Batchジョブを実行するEC2インスタンスにアタッチされます。ジョブ完了後、EBSボリュームはデタッチされ、オプションで削除されます。S3バケットとの連携も可能です。

## アーキテクチャ

![Only EBS モードのアーキテクチャ](../images/only_ebs_architecture.png)

Only EBS モードでは以下のコンポーネントが連携します：

1. **Amazon EBS**: 高性能なブロックストレージ
2. **Amazon S3**: データの永続的な保存先（オプション）
3. **AWS Batch**: コンピューティングジョブの実行
4. **AWS Step Functions**: ワークフローの調整

## 主な特徴

### EBSボリュームの管理

Only EBSモードでは、Step Functionsワークフローが以下のEBS関連タスクを実行します：

- **ボリューム作成**: 指定されたサイズ、IOPS、スループットでgp3ボリュームを作成
- **ボリュームアタッチ**: EC2インスタンス起動時にユーザーデータスクリプトを使用してボリュームをアタッチ
- **ボリュームデタッチ**: ジョブ完了後にボリュームをデタッチ
- **ボリューム削除**: オプションでボリュームを削除（deleteEbs=true）

### S3との連携

提供されているDockerコンテナには、EBSボリュームとS3バケットの間でデータを転送するためのスクリプトが含まれています：

- **write_delete_test_ebs_with_s3.sh**: 最後のファイルをS3にコピー
- **write_delete_test_ebs_with_s3_sync.sh**: S3との同期処理を実行

## デプロイパラメータ

`cdk.json`の`onlyEBS`セクションで以下のパラメータをカスタマイズできます：

| パラメータ | 説明 | デフォルト値 |
|------------|------|------------|
| envName | 環境名 | "OnlyEBS" |
| deleteEbs | ジョブ完了後のEBS削除フラグ | true |
| ebsSizeGb | EBSボリュームサイズ（GB） | 500 |
| ebsIOPS | EBSのIOPS | 5000 |
| ebsThroughput | EBSのスループット（MB/s） | 500 |
| ecrRepositoryName | ECRリポジトリ名 | "batch-job-with-ebs" |
| computeEnvironmentType | コンピューティング環境タイプ | "SPOT" |
| computeEnvironmentAllocationStrategy | 割り当て戦略 | "BEST_FIT_PROGRESSIVE" |
| computeEnvironmentInstanceTypes | インスタンスタイプ | ["optimal"] |
| computeEnvironmentMinvCpus | 最小vCPU数 | 0 |
| computeEnvironmentMaxvCpus | 最大vCPU数 | 256 |
| computeEnvironmentDesiredvCpus | 希望vCPU数 | 0 |
| jobDefinitionRetryAttempts | ジョブ再試行回数 | 5 |
| jobDefinitionVcpus | ジョブあたりのvCPU数 | 32 |
| jobDefinitionMemory | ジョブあたりのメモリ（MB） | 30000 |
| waitForEbsCreationSeconds | EBS作成待機時間（秒） | 30 |
| waitForJobCompletionSeconds | ジョブ完了待機時間（秒） | 300 |
| waitAfterDetachSeconds | デタッチ後の待機時間（秒） | 10 |

## Step Functions ワークフロー

Only EBS モードのStep Functionsワークフローは以下のステップで構成されています：

1. **Secrets Managerからパラメータ取得**
2. **EBSボリューム作成**
3. **ボリュームの可用性確認**
4. **EC2起動テンプレート作成**
5. **Batchコンピューティング環境更新**
6. **ジョブ定義登録**
7. **ジョブ送信**
8. **ジョブ完了確認**
9. **EBSボリュームデタッチ（deleteEbs=trueの場合）**
10. **EBSボリューム削除（deleteEbs=trueの場合）**

## Lustre モードとの違い

| 機能 | Only EBS モード | Lustre モード |
|------|----------------|--------------|
| ストレージタイプ | ブロックストレージ | 共有ファイルシステム |
| 複数インスタンスからのアクセス | 不可 | 可能 |
| S3との統合 | 手動/スクリプト | ネイティブ |
| パフォーマンス | 単一インスタンス向け最適化 | 分散処理向け最適化 |
| コスト | 比較的低コスト | 比較的高コスト |
| セットアップの複雑さ | シンプル | 複雑 |

## テストスクリプト

Only EBS モードには、EBSボリュームのパフォーマンスをテストするための複数のスクリプトが含まれています：

### write_delete_test_ebs_v2.sh

基本的なEBSパフォーマンステスト：

- 指定サイズのファイルを書き込み
- 前のファイルを削除
- パフォーマンスメトリクスを収集

### write_delete_test_ebs_with_s3.sh

EBSとS3の連携テスト：

- 指定サイズのファイルを書き込み
- 前のファイルを削除
- 最後のファイルをS3にコピー

### write_delete_test_ebs_with_s3_sync.sh

EBSとS3の同期テスト：

- S3から前のファイルをダウンロード
- 新しいファイルを書き込み
- ファイルをS3にアップロード
- ローカルファイルを削除

## ユースケース

Only EBS モードは以下のようなシナリオに適しています：

- **単一インスタンス処理**: 共有ファイルシステムが不要な場合
- **コスト最適化**: FSx for Lustreよりも低コストでストレージが必要な場合
- **シンプルなワークロード**: 複雑なファイルシステム機能が不要な場合
- **高IOPSワークロード**: 高いIOPSとスループットが必要な場合

## 制限事項と注意点

- **シングルノード限定**: EBSボリュームは一度に1つのEC2インスタンスにしかアタッチできないため、シングルノードのタスクでしか利用できません。複数ノードでの並列処理が必要な場合はLustreモードを検討してください。
- **単一AZの制約**: このモードでは単一のアベイラビリティゾーン（AZ）のみを使用するため、特にSPOTインスタンスを使用する場合、インスタンスの確保が難しくなる可能性があります。これにより、ジョブの開始が遅れたり、SPOTインスタンスの価格が上昇する可能性があります。
- **S3連携の制限**: S3との統合は手動またはスクリプトを通じて行う必要があり、Lustreモードのような自動同期機能はありません。
- **排他的アクセス**: ボリュームがアタッチされている間は他のインスタンスで使用できません。
- **競合時の自動終了**: ボリュームが既に使用中の場合、インスタンスは自動的に終了します（ユーザーデータスクリプトによる処理）。

## デプロイ方法

```bash
npx cdk deploy -c type=onlyEBS
```

## 関連リソース

- [Amazon EBS ドキュメント](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/AmazonEBS.html)
- [AWS Batch ドキュメント](https://docs.aws.amazon.com/batch/latest/userguide/what-is-batch.html)
- [AWS Step Functions ドキュメント](https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html)