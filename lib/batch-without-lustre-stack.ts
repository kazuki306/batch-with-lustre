import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as batch from 'aws-cdk-lib/aws-batch';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

export class BatchWithoutLustreStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPCの作成
    const vpc = new ec2.Vpc(this, 'BatchVPC', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        }
      ]
    });

    // S3バケットの作成
    const bucket = new s3.Bucket(this, 'DataBucket', {
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // 開発環境用
      autoDeleteObjects: true, // 開発環境用
    });

    // ECRリポジトリの作成
    const ecrRepository = new ecr.Repository(this, 'BatchJobRepository', {
      repositoryName: 'batch-without-lustre-job',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // 開発環境用
      emptyOnDelete: true, // 開発環境用
      lifecycleRules: [
        {
          maxImageCount: 3, // 最新の3つのイメージのみを保持
          description: 'Keep only the last 3 images'
        }
      ]
    });

    // ECRリポジトリのカスタムリソースに必要な権限を追加
    const customResourceRole = new iam.Role(this, 'CustomECRAutoDeleteImagesRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ],
      inlinePolicies: {
        'ECRPermissions': new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'ecr:DescribeRepositories',
                'ecr:ListImages',
                'ecr:BatchDeleteImage'
              ],
              resources: [ecrRepository.repositoryArn]
            })
          ]
        })
      }
    });

    // Batch用のIAMロール
    const batchInstanceRole = new iam.Role(this, 'BatchInstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceforEC2Role')
      ]
    });

    const batchInstanceProfile = new iam.CfnInstanceProfile(this, 'BatchInstanceProfile', {
      roles: [batchInstanceRole.roleName]
    });

    // AWS Batchのサービスリンクロールを参照
    const batchServiceLinkedRole = iam.Role.fromRoleName(
      this,
      'BatchServiceLinkedRole',
      `aws-service-role/batch.amazonaws.com/AWSServiceRoleForBatch`
    );

    // Batchのコンピューティング環境
    const computeEnvironment = new batch.CfnComputeEnvironment(this, 'ComputeEnvironment', {
      type: 'MANAGED',
      computeResources: {
        type: 'SPOT',
        allocationStrategy: 'SPOT_PRICE_CAPACITY_OPTIMIZED',
        maxvCpus: 4,
        minvCpus: 0,
        desiredvCpus: 0,
        instanceTypes: ['optimal'],
        subnets: vpc.privateSubnets.map(subnet => subnet.subnetId),
        securityGroupIds: [vpc.vpcDefaultSecurityGroup],
        instanceRole: batchInstanceProfile.attrArn,
      },
      serviceRole: batchServiceLinkedRole.roleArn,
      state: 'ENABLED',
      replaceComputeEnvironment: true,
    });

    // ジョブキュー
    const jobQueue = new batch.CfnJobQueue(this, 'JobQueue', {
      priority: 1,
      state: 'ENABLED',
      computeEnvironmentOrder: [
        {
          computeEnvironment: computeEnvironment.ref,
          order: 1
        }
      ]
    });

    // Step Functions用のIAMロール
    const stepFunctionsRole = new iam.Role(this, 'BatchJobStateMachineRole', {
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      inlinePolicies: {
        'BatchPermissions': new iam.PolicyDocument({
          statements: [
            // Batchジョブ定義の作成権限
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'batch:RegisterJobDefinition',
                'batch:DeregisterJobDefinition'
              ],
              resources: ['*']
            }),
            // Batchジョブの送信と確認の権限
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'batch:SubmitJob',
                'batch:DescribeJobs'
              ],
              resources: ['*']
            }),
            // サービスリンクロールをBatchに渡す権限
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'iam:PassRole'
              ],
              resources: [`arn:aws:iam::${this.account}:role/aws-service-role/batch.amazonaws.com/AWSServiceRoleForBatch`]
            })
          ]
        })
      }
    });

    // ジョブ定義の作成
    const createJobDefinition = new tasks.CallAwsService(this, 'CreateJobDefinition', {
      service: 'batch',
      action: 'registerJobDefinition',
      parameters: {
        JobDefinitionName: 'batch-job-definition',
        Type: 'container',
        ContainerProperties: {
          'Image.$': '$.containerImage',
          Vcpus: 1,
          Memory: 2048
        }
      },
      iamResources: ['*'],
      resultPath: '$.jobDefinition'
    });

    // ジョブ送信タスク
    const submitJob = new tasks.CallAwsService(this, 'SubmitJob', {
      service: 'batch',
      action: 'submitJob',
      parameters: {
        JobName: sfn.JsonPath.format('batch-job-{}', sfn.JsonPath.stringAt('$$.Execution.StartTime')),
        JobQueue: jobQueue.ref,
        JobDefinition: 'batch-job-definition'
      },
      iamResources: ['*'],
      resultPath: '$.submittedJob'
    });

    // ジョブステータスの確認を待機
    const waitForJobCompletion = new sfn.Wait(this, 'WaitForJobCompletion', {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(30))
    });

    // ジョブステータスの確認タスク
    const checkJobStatus = new tasks.CallAwsService(this, 'CheckJobStatus', {
      service: 'batch',
      action: 'describeJobs',
      parameters: {
        'Jobs.$': "States.Array($.submittedJob.JobId)"
      },
      iamResources: ['*'],
      resultPath: '$.jobStatus'
    });

    // ジョブの完了確認
    const isJobComplete = new sfn.Choice(this, 'IsJobComplete')
      .when(sfn.Condition.stringEquals('$.jobStatus.Jobs[0].Status', 'SUCCEEDED'), new sfn.Succeed(this, 'JobSucceeded'))
      .when(sfn.Condition.stringEquals('$.jobStatus.Jobs[0].Status', 'FAILED'), new sfn.Fail(this, 'JobFailed', {
        cause: 'Batch Job Failed',
        error: 'BatchJobError'
      }))
      .otherwise(waitForJobCompletion);

    // ステートマシンの定義
    const definition = createJobDefinition
      .next(submitJob)
      .next(waitForJobCompletion)
      .next(checkJobStatus)
      .next(isJobComplete);

    // ステートマシンの作成
    new sfn.StateMachine(this, 'BatchJobStateMachine', {
      definition,
      role: stepFunctionsRole
    });
  }
}