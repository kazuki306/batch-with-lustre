# Auto Export モード

Auto Export モードは、AWS BatchとAmazon FSx for Lustreを組み合わせ、S3バケットとの自動同期機能を有効にしたデプロイオプションです。

## 概要

このモードでは、FSx for Lustreファイルシステムが作成され、指定されたS3バケットとの間で自動的にデータの同期が行われます。ファイルシステム上でのファイルの作成、変更、削除は自動的にS3バケットに反映されます。

## アーキテクチャ

![Auto Export モードのアーキテクチャ](../images/auto_export_architecture.png)

Auto Export モードでは以下のコンポーネントが連携します：

1. **Amazon FSx for Lustre**: 高性能な共有ファイルシステム
2. **Amazon S3**: データの永続的な保存先
3. **AWS Batch**: コンピューティングジョブの実行
4. **AWS Step Functions**: ワークフローの調整
5. **AWS Lambda**: CloudWatchメトリクスのモニタリング

## 主な特徴

### 自動エクスポート機能

FSx for Lustreの自動エクスポート機能により、ファイルシステム上での変更が自動的にS3バケットに反映されます：

- **新規ファイル (NEW)**: Lustreファイルシステムに作成された新しいファイルはS3に自動的にアップロード
- **変更ファイル (CHANGED)**: 既存ファイルの変更はS3の対応するオブジェクトに反映
- **削除ファイル (DELETED)**: Lustreから削除されたファイルはS3からも削除

### メトリクスベースの自動クリーンアップ

Lambda関数が定期的にCloudWatchメトリクスをチェックし、エクスポートキューの状態を監視します：

- **AgeOfOldestQueuedMessage**: エクスポートキュー内の最も古いメッセージの経過時間
- すべてのメトリクス値が0になると、エクスポートが完了したと判断
- エクスポート完了後、Step Functionsワークフローが自動的にLustreファイルシステムを削除（オプション）

## デプロイパラメータ

`cdk.json`の`autoExport`セクションで以下のパラメータをカスタマイズできます：

| パラメータ | 説明 | デフォルト値 |
|------------|------|------------|
| envName | 環境名 | "AutoExport" |
| autoExport | 自動エクスポート機能の有効化 | true |
| deleteLustre | ジョブ完了後のLustre削除フラグ | true |
| lustreFileSystemTypeVersion | Lustreバージョン | "2.15" |
| lustreStorageCapacity | ストレージ容量（GB） | 2400 |
| lustreImportedFileChunkSize | インポートチャンクサイズ（MB） | 1024 |
| ecrRepositoryName | ECRリポジトリ名 | "batch-job-with-lustre-auto-export" |
| computeEnvironmentType | コンピューティング環境タイプ | "SPOT" |
| computeEnvironmentAllocationStrategy | 割り当て戦略 | "BEST_FIT_PROGRESSIVE" |
| computeEnvironmentInstanceTypes | インスタンスタイプ | ["optimal"] |
| computeEnvironmentMinvCpus | 最小vCPU数 | 0 |
| computeEnvironmentMaxvCpus | 最大vCPU数 | 256 |
| computeEnvironmentDesiredvCpus | 希望vCPU数 | 0 |
| jobDefinitionRetryAttempts | ジョブ再試行回数 | 5 |
| jobDefinitionVcpus | ジョブあたりのvCPU数 | 32 |
| jobDefinitionMemory | ジョブあたりのメモリ（MB） | 30000 |
| waitForLustreCreationSeconds | Lustre作成待機時間（秒） | 30 |
| waitForJobCompletionSeconds | ジョブ完了待機時間（秒） | 300 |
| waitForCheckMetricsSeconds | メトリクスチェック間隔（秒） | 60 |
| lambdaPeriodSeconds | Lambdaメトリクス取得期間（秒） | 60 |
| lambdaTimeDiffMinutes | Lambdaメトリクス取得時間範囲（分） | 15 |

## Step Functions ワークフロー

Auto Export モードのStep Functionsワークフローは以下のステップで構成されています：

1. **Secrets Managerからパラメータ取得**
2. **FSx for Lustreファイルシステム作成**
3. **S3バケットとのデータリポジトリ関連付け作成**
4. **ファイルシステムの可用性確認**
5. **EC2起動テンプレート作成**
6. **Batchコンピューティング環境更新**
7. **ジョブ定義登録**
8. **ジョブ送信**
9. **ジョブ完了確認**
10. **CloudWatchメトリクスチェック**
11. **ファイルシステム削除（オプション）**

## ユースケース

Auto Export モードは以下のようなシナリオに適しています：

- **リアルタイムデータ処理**: 処理結果をS3に即時反映する必要がある場合
- **継続的なデータ生成**: 継続的にデータが生成され、S3に保存する必要がある場合
- **自動アーカイブ**: 処理結果を自動的にS3にアーカイブする必要がある場合

## 制限事項と注意点

- **メトリクス取得間隔の設定**: `lambdaTimeDiffMinutes`パラメータを短く設定しすぎると、最終的なデータがS3に同期される前にLustreファイルシステムが削除される恐れがあります。特に大量のデータを処理する場合は、十分な余裕を持った値を設定してください。
- **エクスポート完了の確認**: ファイルシステムを削除する前に、`AgeOfOldestQueuedMessage`メトリクスが0になっていることを確認することが重要です。このメトリクスが0より大きい場合、まだエクスポートされていない変更がS3に反映されていない状態です。
- **パフォーマンスへの影響**: 自動エクスポート機能はファイルシステムのパフォーマンスに影響を与える可能性があります。
- **エクスポートキューの遅延**: 大量の小さなファイルの変更は、エクスポートキューの遅延を引き起こす可能性があります。
- **自動クリーンアップの限界**: メトリクスベースの自動クリーンアップは、すべてのエクスポートが完了したことを完全に保証するものではありません。

詳細については、[Amazon FSx for Lustreドキュメント「S3バケットに更新を自動的にエクスポートする」](https://docs.aws.amazon.com/ja_jp/fsx/latest/LustreGuide/autoexport-data-repo-dra.html)を参照してください。

## デプロイ方法

```bash
npx cdk deploy -c type=autoExport
```

## 関連リソース

- [Amazon FSx for Lustre ドキュメント](https://docs.aws.amazon.com/fsx/latest/LustreGuide/what-is.html)
- [AWS Batch ドキュメント](https://docs.aws.amazon.com/batch/latest/userguide/what-is-batch.html)
- [AWS Step Functions ドキュメント](https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html)