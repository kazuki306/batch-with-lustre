import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as batch from 'aws-cdk-lib/aws-batch';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';

interface BatchWithEbsStackProps extends cdk.StackProps {
  ebsSizeGb?: number;
}

export class BatchWithEbsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: BatchWithEbsStackProps) {
    super(scope, id, props);

    const ebsSizeGb = props?.ebsSizeGb ?? 100;

    // 単一AZのVPCを作成
    const vpc = new ec2.Vpc(this, 'BatchVPC', {
      maxAzs: 1,
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
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // typeパラメータを取得
    const app = scope.node.root as cdk.App;
    const type = app.node.tryGetContext('type');
    const context = app.node.tryGetContext(type);

    // ECRリポジトリの作成
    const ecrRepository = new ecr.Repository(this, 'BatchJobRepository', {
      repositoryName: `batch-with-ebs-job-${context.envName.toLowerCase()}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
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

    // Batch用のセキュリティグループ
    const batchSecurityGroup = new ec2.SecurityGroup(this, 'BatchSecurityGroup', {
      vpc,
      description: 'Security group for AWS Batch',
      allowAllOutbound: true,
    });

    const batchInstanceRole = new iam.Role(this, 'BatchInstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceforEC2Role')
      ],
      inlinePolicies: {
        'EbsPermissions': new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'ec2:AttachVolume',
                'ec2:DescribeVolumes'
              ],
              resources: ['*']
            })
          ]
        })
      }
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
        type: 'EC2',
        // type: 'SPOT',
        allocationStrategy: 'BEST_FIT_PROGRESSIVE',
        // allocationStrategy: 'SPOT_PRICE_CAPACITY_OPTIMIZED',
        maxvCpus: 256,
        minvCpus: 0,
        desiredvCpus: 0,
        // instanceTypes: ['optimal'],
        instanceTypes: ['c4.8xlarge'],
        subnets: vpc.privateSubnets.map(subnet => subnet.subnetId),
        securityGroupIds: [batchSecurityGroup.securityGroupId],
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
    const stepFunctionsRole = new iam.Role(this, 'CreateEbsStateMachineRole', {
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      inlinePolicies: {
        'EbsPermissions': new iam.PolicyDocument({
          statements: [
            // EBS操作の権限
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'ec2:CreateVolume',
                'ec2:DeleteVolume',
                'ec2:DescribeVolumes',
                'ec2:AttachVolume',
                'ec2:DetachVolume',
                'ec2:DescribeInstances'
              ],
              resources: ['*']
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
            })
          ]
        })
      }
    });

    // EBSボリュームの作成
    const createEbs = new tasks.CallAwsService(this, 'CreateEbs', {
      service: 'ec2',
      action: 'createVolume',
      parameters: {
        AvailabilityZone: vpc.privateSubnets[0].availabilityZone,
        Size: ebsSizeGb,
        VolumeType: 'gp3',
        Encrypted: false
      },
      iamResources: ['*'],
      resultPath: '$.volume'
    });

    // EBSボリュームの作成を待機
    const waitForEbsCreation = new sfn.Wait(this, 'WaitForEbsCreation', {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(30))
    });

    // EBSボリュームのステータスを確認
    const checkEbsStatus = new tasks.CallAwsService(this, 'CheckEbsStatus', {
      service: 'ec2',
      action: 'describeVolumes',
      parameters: {
        'VolumeIds.$': "States.Array($.volume.VolumeId)"
      },
      iamResources: ['*'],
      resultPath: '$.volumeStatus'
    });

    // 起動テンプレートの作成
    const createLaunchTemplate = new tasks.CallAwsService(this, 'CreateLaunchTemplate', {
      service: 'ec2',
      action: 'createLaunchTemplate',
      parameters: {
        LaunchTemplateName: sfn.JsonPath.format('ebs-mount-{}', sfn.JsonPath.stringAt('$.volume.VolumeId')),
        LaunchTemplateData: {
          UserData: sfn.JsonPath.format(
            '{}',
            sfn.JsonPath.stringAt(`States.Base64Encode(States.Format('Content-Type: multipart/mixed; boundary="==MYBOUNDARY=="\nMIME-Version: 1.0\n\n--==MYBOUNDARY==\nContent-Type: text/cloud-boothook; charset="us-ascii"\n\nsudo yum install unzip -y\nsudo curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"\nsudo unzip awscliv2.zip\nsudo ./aws/install\nTOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")\naws ec2 attach-volume --volume-id {} --instance-id $(curl -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id) --device /dev/xvdf\nsleep 10\nif [ "$(sudo file -s /dev/xvdf)" = "/dev/xvdf: data" ]; then\n    sudo mkfs -t xfs /dev/xvdf\nfi\nsudo mkdir -p /data\nsudo mount /dev/xvdf /data\n\n--==MYBOUNDARY==--', $.volume.VolumeId))`)
          ),
          // BlockDeviceMappings: [
          //   {
          //     // ルートボリューム
          //     DeviceName: '/dev/xvda',
          //     Ebs: {
          //       VolumeSize: 30,
          //       VolumeType: 'gp3',
          //       DeleteOnTermination: true
          //     }
          //   },
          //   {
          //     // 追加のEBSボリュームのマウントポイント
          //     DeviceName: '/dev/xvdf',
          //     Ebs: {
          //       DeleteOnTermination: false
          //     }
          //   }
          // ]
        }
      },
      iamResources: ['*'],
      resultPath: '$.launchTemplate'
    });

    // コンピューティング環境を更新
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
        JobDefinitionName: sfn.JsonPath.format('ebs-job-definition-{}', sfn.JsonPath.stringAt('$.volume.VolumeId')),
        Type: 'container',
        ContainerProperties: {
          'Image.$': '$.containerImage',
          Vcpus: 16,
          Memory: 30720,
          Volumes: [{
            Host: {
              SourcePath: '/data'
            },
            Name: 'data'
          }],
          MountPoints: [{
            ContainerPath: '/data',
            SourceVolume: 'data',
            ReadOnly: false
          }]
        }
      },
      iamResources: ['*'],
      resultPath: '$.jobDefinition'
    });

    // ジョブの送信
    const submitJob = new tasks.CallAwsService(this, 'SubmitJob', {
      service: 'batch',
      action: 'submitJob',
      parameters: {
        JobName: sfn.JsonPath.format('ebs-job-{}', sfn.JsonPath.stringAt('$.volume.VolumeId')),
        JobQueue: jobQueue.ref,
        JobDefinition: sfn.JsonPath.format('ebs-job-definition-{}', sfn.JsonPath.stringAt('$.volume.VolumeId'))
      },
      iamResources: ['*'],
      resultPath: '$.submittedJob'
    });

    // ジョブ完了を待機
    const waitForJobCompletion = new sfn.Wait(this, 'WaitForJobCompletion', {
      time: sfn.WaitTime.duration(cdk.Duration.minutes(5))
    });

    // ジョブステータスの確認
    const checkJobStatus = new tasks.CallAwsService(this, 'CheckJobStatus', {
      service: 'batch',
      action: 'describeJobs',
      parameters: {
        'Jobs.$': "States.Array($.submittedJob.JobId)"
      },
      iamResources: ['*'],
      resultPath: '$.jobStatus'
    });

    // 終了ステートの定義
    const setupComplete = new sfn.Succeed(this, 'SetupComplete');
    const jobFailed = new sfn.Fail(this, 'JobFailed', {
      cause: 'Batch Job Failed',
      error: 'BatchJobError'
    });

    // EBSボリュームの可用性チェック
    const isEbsAvailable = new sfn.Choice(this, 'IsEbsAvailable')
      .when(sfn.Condition.stringEquals('$.volumeStatus.Volumes[0].State', 'available'),
        createLaunchTemplate
          .next(updateComputeEnvironment)
          .next(createJobDefinition)
          .next(submitJob)
          .next(waitForJobCompletion)
          .next(checkJobStatus)
      )
      .otherwise(waitForEbsCreation);

    // ジョブの完了確認
    const isJobComplete = new sfn.Choice(this, 'IsJobComplete')
      .when(sfn.Condition.stringEquals('$.jobStatus.Jobs[0].Status', 'SUCCEEDED'), setupComplete)
      .when(sfn.Condition.stringEquals('$.jobStatus.Jobs[0].Status', 'FAILED'), jobFailed)
      .otherwise(waitForJobCompletion);

    checkJobStatus.next(isJobComplete);

    // ステートマシンの定義
    const definition = createEbs
      .next(waitForEbsCreation)
      .next(checkEbsStatus)
      .next(isEbsAvailable);

    new sfn.StateMachine(this, `CreateEbs${context.envName}StateMachine`, {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      role: stepFunctionsRole
    });
  }
}