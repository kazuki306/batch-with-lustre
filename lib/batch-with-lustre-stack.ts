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
import { Construct } from 'constructs';
import { version } from 'os';
import { FileSystemTypeVersion } from 'aws-cdk-lib/aws-fsx';

export class BatchWithLustreStack extends cdk.Stack {
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
    // ECRリポジトリの作成
    const ecrRepository = new ecr.Repository(this, 'BatchJobRepository', {
      repositoryName: 'batch-with-lustre-job',
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

    // FSx for Lustre用のセキュリティグループ
    const lustreSecurityGroup = new ec2.SecurityGroup(this, 'LustreSecurityGroup', {
      vpc,
      description: 'Security group for FSx for Lustre',
      allowAllOutbound: true,
    });

    lustreSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(988),
      'Allow Lustre traffic from VPC'
    );

    // Batch用のIAMロール
    // const batchServiceRole = new iam.Role(this, 'BatchServiceRole', {
    //   assumedBy: new iam.ServicePrincipal('batch.amazonaws.com'),
    //   managedPolicies: [
    //     iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSBatchServiceRole')
    //   ]
    // });

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
        securityGroupIds: [lustreSecurityGroup.securityGroupId],
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

    // CloudWatchメトリクスをチェックするLambda関数
    const checkMetricsFunction = new nodejs.NodejsFunction(this, 'CheckMetricsFunction', {
      entry: 'lib/lambda/check-metrics/index.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        REGION: this.region,
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
    const stepFunctionsRole = new iam.Role(this, 'CreateLustreStateMachineRole', {
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
                'fsx:DeleteFileSystem'
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
              resources: ['arn:aws:iam::*:role/aws-service-role/s3.data-source.lustre.fsx.amazonaws.com/*']
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
            })
          ]
        })
      }
    });

    // StepFunctionsのステートマシン
    const createLustreFileSystem = new tasks.CallAwsService(this, 'CreateLustreFileSystem', {
      service: 'fsx',
      action: 'createFileSystem',
      parameters: {
        FileSystemType: 'LUSTRE',
        FileSystemTypeVersion: '2.15',
        StorageCapacity: 1200,
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
      time: sfn.WaitTime.duration(cdk.Duration.minutes(0.5))
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
        'ImportedFileChunkSize': 1024,
        'S3': {
          'AutoImportPolicy': {
            'Events': ['NEW', 'CHANGED', 'DELETED']
          },
          'AutoExportPolicy': {
            'Events': ['NEW', 'CHANGED', 'DELETED']
          }
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
          AllocationStrategy: 'SPOT_PRICE_CAPACITY_OPTIMIZED',
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
        ContainerProperties: {
          'Image.$': '$.containerImage',
          Vcpus: 1,
          Memory: 2048,
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
      time: sfn.WaitTime.duration(cdk.Duration.minutes(5))
    });

    // メトリクス値による分岐
    const shouldDeleteFSx = new sfn.Choice(this, 'ShouldDeleteFSx')
      .when(sfn.Condition.booleanEquals('$.metricsCheck.Payload.shouldDeleteFSx', true), deleteFSx)
      .otherwise(waitForNextCheck);

    // ジョブの完了確認
    const isJobComplete = new sfn.Choice(this, 'IsJobComplete')
      .when(sfn.Condition.stringEquals('$.jobStatus.Jobs[0].Status', 'SUCCEEDED'), checkMetricsTask)
      .when(sfn.Condition.stringEquals('$.jobStatus.Jobs[0].Status', 'FAILED'), new sfn.Fail(this, 'JobFailed', {
        cause: 'Batch Job Failed',
        error: 'BatchJobError'
      }))
      .otherwise(waitForJobCompletion);

    const setupComplete = new sfn.Succeed(this, 'SetupComplete');

    const definition = createLustreFileSystem
      .next(createDataRepositoryAssociation)
      .next(waitForFileSystem)
      .next(checkFileSystemStatus)
      .next(checkDataRepositoryAssociation)
      .next(
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
              .next(isJobComplete)
          )
          .otherwise(waitForFileSystem)
      );

    // メトリクスチェックのフローを追加
    checkMetricsTask.next(shouldDeleteFSx);
    deleteFSx.next(setupComplete);
    waitForNextCheck.next(checkMetricsTask);

    new sfn.StateMachine(this, 'CreateLustreStateMachine', {
      definition,
      // timeout: cdk.Duration.hours(1),
      role: stepFunctionsRole
    });
  }
}
