import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as batch from 'aws-cdk-lib/aws-batch';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
interface BatchWithLustreStackProps extends cdk.StackProps {
  envName?: string;
  autoExport?: boolean;
  lustreStorageCapacity?: number;
  lustreFileSystemTypeVersion?: string;
  lustreImportedFileChunkSize?: number;
  jobDefinitionRetryAttempts?: number;
  jobDefinitionVcpus?: number;
  jobDefinitionMemory?: number;
  ecrRepositoryName?: string;
  computeEnvironmentType?: string;
  computeEnvironmentAllocationStrategy?: string;
  computeEnvironmentMaxvCpus?: number;
  computeEnvironmentMinvCpus?: number;
  computeEnvironmentDesiredvCpus?: number;
  computeEnvironmentInstanceTypes?: string[];
  waitForLustreCreationSeconds?: number;
  waitForJobCompletionSeconds?: number;
  waitForCheckMetricsSeconds?: number;
  waitForDataRepositoryTaskSeconds?: number;
  deleteLustre?: boolean;
  lambdaPeriodSeconds?: number;
  lambdaTimeDiffMinutes?: number;
}

export class BatchWithLustreStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: BatchWithLustreStackProps) {
    super(scope, id, props);

    const envName = props?.envName ?? 'Default';
    const autoExport = props?.autoExport ?? true;
    const lustreStorageCapacity = props?.lustreStorageCapacity ?? 2400;
    const lustreFileSystemTypeVersion = props?.lustreFileSystemTypeVersion ?? '2.15';
    const lustreImportedFileChunkSize = props?.lustreImportedFileChunkSize ?? 1024;
    const jobDefinitionRetryAttempts = props?.jobDefinitionRetryAttempts ?? 5;
    const jobDefinitionVcpus = props?.jobDefinitionVcpus ?? 32;
    const jobDefinitionMemory = props?.jobDefinitionMemory ?? 30000;
    const ecrRepositoryName = props?.ecrRepositoryName ?? 'batch-job-with-lustre-auto-export';
    const computeEnvironmentType = props?.computeEnvironmentType ?? 'SPOT';
    const computeEnvironmentAllocationStrategy = props?.computeEnvironmentAllocationStrategy ?? 'SPOT_PRICE_CAPACITY_OPTIMIZED';
    const computeEnvironmentMaxvCpus = props?.computeEnvironmentMaxvCpus ?? 256;
    const computeEnvironmentMinvCpus = props?.computeEnvironmentMinvCpus ?? 0;
    const computeEnvironmentDesiredvCpus = props?.computeEnvironmentDesiredvCpus ?? 0;
    const computeEnvironmentInstanceTypes = props?.computeEnvironmentInstanceTypes ?? ['optimal'];
    const waitForLustreCreationSeconds = props?.waitForLustreCreationSeconds ?? 30;
    const waitForJobCompletionSeconds = props?.waitForJobCompletionSeconds ?? 300;
    const waitForCheckMetricsSeconds = props?.waitForCheckMetricsSeconds ?? 10;
    const waitForDataRepositoryTaskSeconds = props?.waitForDataRepositoryTaskSeconds ?? 300;
    const deleteLustre = props?.deleteLustre ?? true;

    // ECRリポジトリの作成
    const ecrRepository = new ecr.Repository(this, 'BatchJobRepository', {
      repositoryName: ecrRepositoryName,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    // コンテナイメージURIを生成
    const containerImageUri = `${this.account}.dkr.ecr.${this.region}.amazonaws.com/${ecrRepositoryName}:latest`;

    // Secrets Managerに設定値を格納
    // autoExportの値に基づいて異なるシークレットを作成
    const secretObjectValue: Record<string, cdk.SecretValue> = {
      lustreStorageCapacity: cdk.SecretValue.unsafePlainText(lustreStorageCapacity.toString()),
      lustreFileSystemTypeVersion: cdk.SecretValue.unsafePlainText(lustreFileSystemTypeVersion),
      lustreImportedFileChunkSize: cdk.SecretValue.unsafePlainText(lustreImportedFileChunkSize.toString()),
      jobDefinitionRetryAttempts: cdk.SecretValue.unsafePlainText(jobDefinitionRetryAttempts.toString()),
      jobDefinitionVcpus: cdk.SecretValue.unsafePlainText(jobDefinitionVcpus.toString()),
      jobDefinitionMemory: cdk.SecretValue.unsafePlainText(jobDefinitionMemory.toString()),
      jobDefinitionContainerImage: cdk.SecretValue.unsafePlainText(containerImageUri),
      waitForLustreCreationSeconds: cdk.SecretValue.unsafePlainText(waitForLustreCreationSeconds.toString()),
      waitForJobCompletionSeconds: cdk.SecretValue.unsafePlainText(waitForJobCompletionSeconds.toString()),
      deleteLustre: cdk.SecretValue.unsafePlainText(deleteLustre.toString()),
    };

    // autoExportの値に基づいて異なるパラメータを設定
    if (autoExport) {
      secretObjectValue.waitForCheckMetricsSeconds = cdk.SecretValue.unsafePlainText(waitForCheckMetricsSeconds.toString());
    } else {
      secretObjectValue.waitForDataRepositoryTaskSeconds = cdk.SecretValue.unsafePlainText(waitForDataRepositoryTaskSeconds.toString());
    }

    const lustreSecret = new secretsmanager.Secret(this, `BatchJobWith${envName}Secret`, {
      description: `Configuration values for executing AWS Batch jobs with FSx for Lustre and StepFunction (${envName})`,
      secretObjectValue,
    });

    const vpc = new ec2.Vpc(this, `BatchJobWith${envName}VPC`, {
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
    const bucket = new s3.Bucket(this, `BatchJobWith${envName}DataBucket`, {
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ECRリポジトリのカスタムリソースに必要な権限を追加
    // const customResourceRole = new iam.Role(this, 'CustomECRAutoDeleteImagesRole', {
    //   assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    //   managedPolicies: [
    //     iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
    //   ],
    //   inlinePolicies: {
    //     'ECRPermissions': new iam.PolicyDocument({
    //       statements: [
    //         new iam.PolicyStatement({
    //           effect: iam.Effect.ALLOW,
    //           actions: [
    //             'ecr:DescribeRepositories',
    //             'ecr:ListImages',
    //             'ecr:BatchDeleteImage'
    //           ],
    //           resources: [ecrRepository.repositoryArn]
    //         })
    //       ]
    //     })
    //   }
    // });

    // FSx for Lustre用のセキュリティグループ
    const lustreSecurityGroup = new ec2.SecurityGroup(this, `BatchJobWith${envName}SecurityGroup`, {
      vpc,
      description: 'Security group for FSx for Lustre',
      allowAllOutbound: true,
    });

    lustreSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(988),
      'Allow Lustre traffic from VPC'
    );

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
    const computeEnvironment = new batch.CfnComputeEnvironment(this, `BatchJobWith${envName}`, {
      type: 'MANAGED',
      computeResources: {
        type: computeEnvironmentType,
        allocationStrategy: computeEnvironmentAllocationStrategy,
        maxvCpus: computeEnvironmentMaxvCpus,
        minvCpus: computeEnvironmentMinvCpus,
        desiredvCpus: computeEnvironmentDesiredvCpus,
        instanceTypes: computeEnvironmentInstanceTypes,
        subnets: vpc.privateSubnets.map(subnet => subnet.subnetId),
        securityGroupIds: [lustreSecurityGroup.securityGroupId],
        instanceRole: batchInstanceProfile.attrArn,
      },
      serviceRole: batchServiceLinkedRole.roleArn,
      state: 'ENABLED',
      replaceComputeEnvironment: true,
    });

    // ジョブキュー
    const jobQueue = new batch.CfnJobQueue(this, `BatchJobWith${envName}JobQueue`, {
      priority: 1,
      state: 'ENABLED',
      computeEnvironmentOrder: [
        {
          computeEnvironment: computeEnvironment.ref,
          order: 1
        }
      ]
    });

    // CloudWatchメトリクスをチェックするLambda関数
    const lambdaPeriodSeconds = props?.lambdaPeriodSeconds ?? 60;
    const lambdaTimeDiffMinutes = props?.lambdaTimeDiffMinutes ?? 15;

    const checkMetricsFunction = new nodejs.NodejsFunction(this, 'CheckMetricsFunction', {
      entry: 'lib/lambda/check-metrics/index.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(60),
      memorySize: 128,
      environment: {
        REGION: this.region,
        PERIOD: lambdaPeriodSeconds.toString(),
        TIME_DIFF: lambdaTimeDiffMinutes.toString(),
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    // CloudWatchメトリクスの読み取り権限を追加
    checkMetricsFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cloudwatch:GetMetricData',
          'cloudwatch:GetMetricStatistics',
          'cloudwatch:ListMetrics',
        ],
        resources: ['*'],
      })
    );

    // Step Functions用のIAMロール
    const stepFunctionsRole = new iam.Role(this, `BatchJobWith${envName}StateMachineRole`, {
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      inlinePolicies: {
        'FSxPermissions': new iam.PolicyDocument({
          statements: [
            // FSx操作の権限
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'fsx:CreateFileSystem',
                'fsx:DescribeFileSystems',
                'fsx:CreateDataRepositoryAssociation',
                'fsx:DescribeDataRepositoryAssociations',
                'fsx:DeleteFileSystem',
                'fsx:CreateDataRepositoryTask',
                'fsx:DescribeDataRepositoryTasks'
              ],
              resources: ['*']
            }),
            // サービスリンクロール関連の権限
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'iam:CreateServiceLinkedRole',
                'iam:AttachRolePolicy',
                'iam:PutRolePolicy'
              ],
              resources: [
                'arn:aws:iam::*:role/aws-service-role/s3.data-source.lustre.fsx.amazonaws.com/*',
                'arn:aws:iam::*:role/aws-service-role/fsx.amazonaws.com/*'
              ]
            }),
            // S3アクセスの権限
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetBucketLocation',
                's3:ListBucket',
                's3:GetObject',
                's3:PutObject'
              ],
              resources: [
                bucket.bucketArn,
                `${bucket.bucketArn}/*`
              ]
            }),
            // EC2起動テンプレートの権限
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'ec2:CreateLaunchTemplate',
                'ec2:CreateLaunchTemplateVersion',
                'ec2:ModifyLaunchTemplate'
              ],
              resources: ['*']
            }),
            // Batchコンピューティング環境の更新権限
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'batch:UpdateComputeEnvironment'
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
            }),
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
            // Lambda関数の実行権限
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'lambda:InvokeFunction'
              ],
              resources: [checkMetricsFunction.functionArn]
            }),
            // Secrets Managerへのアクセス権限
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'secretsmanager:GetSecretValue'
              ],
              resources: [lustreSecret.secretArn]
            })
          ]
        })
      }
    });

    // Secrets Managerから設定値を取得
    const getSecret = new tasks.CallAwsService(this, 'GetSecret', {
      service: 'secretsmanager',
      action: 'getSecretValue',
      parameters: {
        SecretId: lustreSecret.secretName
      },
      iamResources: [lustreSecret.secretArn],
      resultPath: '$.secretTemp'
    });

    // 必要なパラメータを抽出
    const extractParameters = new sfn.Pass(this, 'ExtractParameters', {
      parameters: {
        'SecretsManagerParameters.$': 'States.StringToJson($.secretTemp.SecretString)'
      },
      resultPath: '$.credentials'
    });

    // StepFunctionsのステートマシン
    const createLustreFileSystem = new tasks.CallAwsService(this, 'CreateLustreFileSystem', {
      service: 'fsx',
      action: 'createFileSystem',
      parameters: {
        FileSystemType: 'LUSTRE',
        'FileSystemTypeVersion.$': '$.credentials.SecretsManagerParameters.lustreFileSystemTypeVersion',
        'StorageCapacity.$': 'States.StringToJson($.credentials.SecretsManagerParameters.lustreStorageCapacity)',
        SubnetIds: [vpc.privateSubnets[0].subnetId],
        SecurityGroupIds: [lustreSecurityGroup.securityGroupId],
        LustreConfiguration: {
          DeploymentType: 'SCRATCH_2'
        }
      },
      iamResources: ['*'],
      resultPath: '$.fileSystem'
    });

    const waitForFileSystem = new sfn.Wait(this, 'WaitForFileSystem', {
      time: sfn.WaitTime.secondsPath('$.credentials.SecretsManagerParameters.waitForLustreCreationSeconds')
    });

    const checkFileSystemStatus = new tasks.CallAwsService(this, 'CheckFileSystemStatus', {
      service: 'fsx',
      action: 'describeFileSystems',
      parameters: {
        'FileSystemIds.$': "States.Array($.fileSystem.FileSystem.FileSystemId)"
      },
      iamResources: ['*'],
      resultPath: '$.fileSystemStatus'
    });

    const checkDataRepositoryAssociation = new tasks.CallAwsService(this, 'CheckDataRepositoryAssociation', {
      service: 'fsx',
      action: 'describeDataRepositoryAssociations',
      parameters: {
        'AssociationIds.$': "States.Array($.dataRepositoryAssociation.Association.AssociationId)"
      },
      iamResources: ['*'],
      resultPath: '$.dataRepositoryStatus'
    });

    const isFileSystemAndAssociationAvailable = new sfn.Choice(this, 'IsFileSystemAndAssociationAvailable');
    const createDataRepositoryAssociation = new tasks.CallAwsService(this, 'CreateDataRepositoryAssociation', {
      service: 'fsx',
      action: 'createDataRepositoryAssociation',
      parameters: {
        'FileSystemId.$': '$.fileSystem.FileSystem.FileSystemId',
        'FileSystemPath': '/scratch',
        'DataRepositoryPath': bucket.s3UrlForObject('/'),
        'BatchImportMetaDataOnCreate': true,
        'ImportedFileChunkSize.$': 'States.StringToJson($.credentials.SecretsManagerParameters.lustreImportedFileChunkSize)',
        'S3': {
          'AutoImportPolicy': {
            'Events': ['NEW', 'CHANGED', 'DELETED']
          },
          ...(autoExport ? {
            'AutoExportPolicy': {
              'Events': ['NEW', 'CHANGED', 'DELETED']
            }
          } : {})
        }
      },
      iamResources: ['*'],
      resultPath: '$.dataRepositoryAssociation'
    });

    const createLaunchTemplate = new tasks.CallAwsService(this, 'CreateLaunchTemplate', {
      service: 'ec2',
      action: 'createLaunchTemplate',
      parameters: {
        LaunchTemplateName: sfn.JsonPath.format('lustre-mount-{}', sfn.JsonPath.stringAt('$.fileSystem.FileSystem.FileSystemId')),
        LaunchTemplateData: {
          UserData: sfn.JsonPath.format(
            '{}',
            sfn.JsonPath.stringAt("States.Base64Encode(States.Format('Content-Type: multipart/mixed; boundary=\"==MYBOUNDARY==\"\nMIME-Version: 1.0\n\n--==MYBOUNDARY==\nContent-Type: text/cloud-boothook; charset=\"us-ascii\"\n\nfile_system_id={}\nregion={}\nfsx_directory=/fsx\nfsx_mount_name={}\namazon-linux-extras install -y lustre\nmkdir -p $fsx_directory\nmount -t lustre -o noatime,flock $file_system_id.fsx.$region.amazonaws.com@tcp:/$fsx_mount_name $fsx_directory\n\n--==MYBOUNDARY==--', $.fileSystem.FileSystem.FileSystemId, '" + this.region + "', $.fileSystem.FileSystem.LustreConfiguration.MountName))")
          )
        }
      },
      iamResources: ['*'],
      resultPath: '$.launchTemplate'
    });

    // コンピューティング環境を更新するタスク
    const updateComputeEnvironment = new tasks.CallAwsService(this, 'UpdateComputeEnvironment', {
      service: 'batch',
      action: 'updateComputeEnvironment',
      parameters: {
        ComputeEnvironment: computeEnvironment.ref,
        ServiceRole: batchServiceLinkedRole.roleArn,
        ComputeResources: {
          LaunchTemplate: {
            LaunchTemplateId: sfn.JsonPath.stringAt('$.launchTemplate.LaunchTemplate.LaunchTemplateId'),
            Version: '$Latest'
          }
        }
      },
      iamResources: ['*'],
      resultPath: '$.updateResult'
    });

    // ジョブ定義の作成
    const createJobDefinition = new tasks.CallAwsService(this, 'CreateJobDefinition', {
      service: 'batch',
      action: 'registerJobDefinition',
      parameters: {
        JobDefinitionName: sfn.JsonPath.format('lustre-job-definition-{}', sfn.JsonPath.stringAt('$.fileSystem.FileSystem.FileSystemId')),
        Type: 'container',
        RetryStrategy: {
          'Attempts.$': 'States.StringToJson($.credentials.SecretsManagerParameters.jobDefinitionRetryAttempts)',
          EvaluateOnExit: [
            {
              OnStatusReason: 'Host EC2*',
              Action: 'RETRY'
            },
            {
              OnReason: '*',
              Action: 'EXIT'
            }
          ]
        },
        ContainerProperties: {
          'Image.$': '$.credentials.SecretsManagerParameters.jobDefinitionContainerImage',
          'Vcpus.$': 'States.StringToJson($.credentials.SecretsManagerParameters.jobDefinitionVcpus)',
          'Memory.$': 'States.StringToJson($.credentials.SecretsManagerParameters.jobDefinitionMemory)',
          Volumes: [{
            Host: {
              SourcePath: '/fsx/scratch'
            },
            Name: 'scratch'
          }],
          MountPoints: [{
            ContainerPath: '/scratch',
            SourceVolume: 'scratch',
            ReadOnly: false
          }]
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
        JobName: sfn.JsonPath.format('lustre-job-{}', sfn.JsonPath.stringAt('$.fileSystem.FileSystem.FileSystemId')),
        JobQueue: jobQueue.ref,
        JobDefinition: sfn.JsonPath.format('lustre-job-definition-{}', sfn.JsonPath.stringAt('$.fileSystem.FileSystem.FileSystemId'))
      },
      iamResources: ['*'],
      resultPath: '$.submittedJob'
    });

    // ジョブステータスの確認を待機
    const waitForJobCompletion = new sfn.Wait(this, 'WaitForJobCompletion', {
      time: sfn.WaitTime.secondsPath('$.credentials.SecretsManagerParameters.waitForJobCompletionSeconds')
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

    // メトリクスをチェックするLambdaタスク
    const checkMetricsTask = new tasks.LambdaInvoke(this, 'CheckMetrics', {
      lambdaFunction: checkMetricsFunction,
      payload: sfn.TaskInput.fromObject({
        'fileSystemId.$': '$.fileSystem.FileSystem.FileSystemId'
      }),
      resultPath: '$.metricsCheck'
    });

    // FSxを削除するタスク
    const deleteFSx = new tasks.CallAwsService(this, 'DeleteFSx', {
      service: 'fsx',
      action: 'deleteFileSystem',
      parameters: {
        'FileSystemId.$': '$.fileSystem.FileSystem.FileSystemId'
      },
      iamResources: ['*']
    });

    // メトリクスチェック後の待機タスク
    const waitForNextCheck = new sfn.Wait(this, 'WaitForNextCheck', {
      time: sfn.WaitTime.secondsPath('$.credentials.SecretsManagerParameters.waitForCheckMetricsSeconds')
    });

    // データリポジトリタスクの作成
    const createDataRepositoryTask = new tasks.CallAwsService(this, 'CreateDataRepositoryTask', {
      service: 'fsx',
      action: 'createDataRepositoryTask',
      parameters: {
        'FileSystemId.$': '$.fileSystem.FileSystem.FileSystemId',
        'Type': 'EXPORT_TO_REPOSITORY',
        'Paths': ['/scratch'],
        'Report': {
          'Enabled': false
        }
      },
      iamResources: ['*'],
      resultPath: '$.dataRepositoryTask'
    });

    // データリポジトリタスクのステータスチェック
    const checkDataRepositoryTasks = new tasks.CallAwsService(this, 'CheckDataRepositoryTasks', {
      service: 'fsx',
      action: 'describeDataRepositoryTasks',
      parameters: {
        'Filters': [
          {
            'Name': 'file-system-id',
            'Values.$': "States.Array($.fileSystem.FileSystem.FileSystemId)"
          }
        ]
      },
      iamResources: ['*'],
      resultPath: '$.dataRepositoryTasks'
    });

    // データリポジトリタスクの完了を待機
    const waitForDataRepositoryTask = new sfn.Wait(this, 'WaitForDataRepositoryTask', {
      time: sfn.WaitTime.secondsPath('$.credentials.SecretsManagerParameters.waitForDataRepositoryTaskSeconds')
    });

    // 終了ステートの定義
    const jobSucceeded = new sfn.Succeed(this, 'JobSucceeded');
    const jobFailed = new sfn.Fail(this, 'JobFailed', {
      cause: 'Batch Job Failed',
      error: 'BatchJobError'
    });

    // ファイルシステムの可用性チェックフロー
    isFileSystemAndAssociationAvailable
      .when(sfn.Condition.and(
        sfn.Condition.stringEquals('$.fileSystemStatus.FileSystems[0].Lifecycle', 'AVAILABLE'),
        sfn.Condition.stringEquals('$.dataRepositoryStatus.Associations[0].Lifecycle', 'AVAILABLE')
      ),
        createLaunchTemplate
          .next(updateComputeEnvironment)
          .next(createJobDefinition)
          .next(submitJob)
          .next(waitForJobCompletion)
          .next(checkJobStatus)
      )
      .otherwise(waitForFileSystem);

    // ステート遷移はチェーンで定義済み

    // autoExportの値に基づいて異なるフローを構築
    if (autoExport) {
      // メトリクス値による分岐
      const shouldDeleteFSx = new sfn.Choice(this, 'ShouldDeleteFSx')
        .when(sfn.Condition.booleanEquals('$.metricsCheck.Payload.shouldDeleteFSx', true), deleteFSx)
        .otherwise(waitForNextCheck);

      checkMetricsTask.next(shouldDeleteFSx);
      waitForNextCheck.next(checkMetricsTask);

      // ジョブの完了確認
      const isJobComplete = new sfn.Choice(this, 'IsJobComplete')
        .when(
          sfn.Condition.and(
            sfn.Condition.stringEquals('$.jobStatus.Jobs[0].Status', 'SUCCEEDED'),
            sfn.Condition.stringEquals('$.credentials.SecretsManagerParameters.deleteLustre', 'true')
          ),
          checkMetricsTask
        )
        .when(
          sfn.Condition.and(
            sfn.Condition.stringEquals('$.jobStatus.Jobs[0].Status', 'SUCCEEDED'),
            sfn.Condition.stringEquals('$.credentials.SecretsManagerParameters.deleteLustre', 'false')
          ),
          jobSucceeded
        )
        .when(
          sfn.Condition.and(
            sfn.Condition.stringEquals('$.jobStatus.Jobs[0].Status', 'FAILED'),
            sfn.Condition.stringMatches('$.jobStatus.Jobs[0].StatusReason', '*Host EC2*')
          ),
          waitForJobCompletion
        )
        .when(sfn.Condition.stringEquals('$.jobStatus.Jobs[0].Status', 'FAILED'), jobFailed)
        .otherwise(waitForJobCompletion);

      checkJobStatus.next(isJobComplete);
    } else {
      // データリポジトリタスクの完了確認
      const isDataRepositoryTaskComplete = new sfn.Choice(this, 'IsDataRepositoryTaskComplete')
        .when(sfn.Condition.stringEquals('$.dataRepositoryTasks.DataRepositoryTasks[0].Lifecycle', 'SUCCEEDED'), deleteFSx)
        .otherwise(waitForDataRepositoryTask);

      createDataRepositoryTask
        .next(waitForDataRepositoryTask)
        .next(checkDataRepositoryTasks)
        .next(isDataRepositoryTaskComplete);

      // ジョブの完了確認
      const isJobComplete = new sfn.Choice(this, 'IsJobComplete')
        .when(
          sfn.Condition.and(
            sfn.Condition.stringEquals('$.jobStatus.Jobs[0].Status', 'SUCCEEDED'),
            sfn.Condition.stringEquals('$.credentials.SecretsManagerParameters.deleteLustre', 'true')
          ),
          createDataRepositoryTask
        )
        .when(
          sfn.Condition.and(
            sfn.Condition.stringEquals('$.jobStatus.Jobs[0].Status', 'SUCCEEDED'),
            sfn.Condition.stringEquals('$.credentials.SecretsManagerParameters.deleteLustre', 'false')
          ),
          jobSucceeded
        )
        .when(
          sfn.Condition.and(
            sfn.Condition.stringEquals('$.jobStatus.Jobs[0].Status', 'FAILED'),
            sfn.Condition.stringMatches('$.jobStatus.Jobs[0].StatusReason', '*Host EC2*')
          ),
          waitForJobCompletion
        )
        .when(sfn.Condition.stringEquals('$.jobStatus.Jobs[0].Status', 'FAILED'), jobFailed)
        .otherwise(waitForJobCompletion);

      checkJobStatus.next(isJobComplete);
    }

    // 共通のフロー定義
    let definition;
    
    // Secrets Managerから設定値を取得
    // const getSecret = new tasks.CallAwsService(this, 'GetSecret', {
    //   service: 'secretsmanager',
    //   action: 'getSecretValue',
    //   parameters: {
    //     SecretId: lustreSecret.secretName
    //   },
    //   iamResources: [lustreSecret.secretArn],
    //   resultPath: '$.secretTemp'
    // });

    // // 必要なパラメータを抽出
    // const extractParameters = new sfn.Pass(this, 'ExtractParameters', {
    //   parameters: {
    //     'SecretsManagerParameters.$': 'States.StringToJson($.secretTemp.SecretString)'
    //   },
    //   resultPath: '$.credentials'
    // });

    definition = getSecret
      .next(extractParameters)
      .next(createLustreFileSystem)
      .next(createDataRepositoryAssociation)
      .next(waitForFileSystem)
      .next(checkFileSystemStatus)
      .next(checkDataRepositoryAssociation)
      .next(isFileSystemAndAssociationAvailable);

    // 終了フローの設定
    deleteFSx.next(jobSucceeded);

    // StateMachine名の決定
    // let stateMachineName: string;
    // if (autoExport) {
    //   stateMachineName = 'CreateLustreAutoExportStateMachine';
    // } else {
    //   stateMachineName = 'CreateLustreTaskExportStateMachine';
    // }

    new sfn.StateMachine(this, `BatchJobWith${envName}StateMachine`, {
      definition,
      role: stepFunctionsRole
    });
  }
}
