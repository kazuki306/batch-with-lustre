#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { BatchWithLustreStack } from '../lib/batch-with-lustre-stack';
import { BatchWithoutLustreStack } from '../lib/batch-without-lustre-stack';
import { BatchWithNewLustreStack } from '../lib/batch-with-new-lustre-stack';
import { BatchWithEbsStack } from '../lib/batch-with-ebs-stack';

const app = new cdk.App();

// 環境設定
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: 'ap-northeast-1' // Tokyoリージョンを指定
};

// タグの設定
const tags = {
  Project: 'BatchWithLustre',
  Environment: 'Development'
};

// 共通のスタックプロパティ
const commonProps = {
  env,
  tags
};

// cdk.jsonから環境タイプのパラメータを取得
const type = app.node.tryGetContext('type');
const context = app.node.tryGetContext(type);

if (!context) {
  throw new Error(`Invalid type: ${type}. Please specify a valid type using -c type=<autoExport|taskExport|onlyEBS>`);
}

// 環境タイプに応じたスタックを作成
if (type === 'autoExport' || type === 'taskExport') {
  // Lustreスタックを作成
  new BatchWithLustreStack(app, `BatchWithLustre${context.envName}Stack`, {
    ...commonProps,
    description: `Batch with Lustre file system stack (${context.envName})`,
    autoExport: context.autoExport
  });
} else if (type === 'onlyEBS') {
  // EBSスタックを作成
  new BatchWithEbsStack(app, `BatchWithEbs${context.envName}Stack`, {
    ...commonProps,
    description: `Batch with EBS volume stack (${context.envName})`,
    ebsSizeGb: context.ebsSizeGb
  });
}

// その他の既存のスタック
// new BatchWithoutLustreStack(app, 'BatchWithoutLustreStack', {
//   ...commonProps,
//   description: 'Batch without Lustre file system stack'
// });

// new BatchWithNewLustreStack(app, 'BatchWithNewLustreStack', {
//   ...commonProps,
//   description: 'Batch with new Lustre file system and S3 integration stack'
// });

app.synth();
