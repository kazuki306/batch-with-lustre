#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { BatchWithLustreStack } from '../lib/batch-with-lustre-stack';
import { BatchWithoutLustreStack } from '../lib/batch-without-lustre-stack';
import { BatchWithNewLustreStack } from '../lib/batch-with-new-lustre-stack';

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

new BatchWithLustreStack(app, 'BatchWithLustreStack', {
  ...commonProps,
  description: 'Batch with Lustre file system stack'
});

new BatchWithoutLustreStack(app, 'BatchWithoutLustreStack', {
  ...commonProps,
  description: 'Batch without Lustre file system stack'
});

new BatchWithNewLustreStack(app, 'BatchWithNewLustreStack', {
  ...commonProps,
  description: 'Batch with new Lustre file system and S3 integration stack'
});

app.synth();