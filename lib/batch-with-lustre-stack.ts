import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as batch from 'aws-cdk-lib/aws-batch';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

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
    const batchServiceRole = new iam.Role(this, 'BatchServiceRole', {
      assumedBy: new iam.ServicePrincipal('batch.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSBatchServiceRole')
      ]
    });

    const batchInstanceRole = new iam.Role(this, 'BatchInstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceforEC2Role')
      ]
    });

    const batchInstanceProfile = new iam.CfnInstanceProfile(this, 'BatchInstanceProfile', {
      roles: [batchInstanceRole.roleName]
    });

    // Batchのコンピューティング環境
    const computeEnvironment = new batch.CfnComputeEnvironment(this, 'ComputeEnvironment', {
      type: 'MANAGED',
      computeResources: {
        type: 'EC2',
        maxvCpus: 4,
        minvCpus: 0,
        desiredvCpus: 0,
        instanceTypes: ['optimal'],
        subnets: vpc.privateSubnets.map(subnet => subnet.subnetId),
        securityGroupIds: [lustreSecurityGroup.securityGroupId],
        instanceRole: batchInstanceProfile.attrArn,
      },
      serviceRole: batchServiceRole.roleArn,
      state: 'ENABLED'
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
                'fsx:DescribeFileSystems'
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
        StorageCapacity: 1200,
        SubnetIds: [vpc.privateSubnets[0].subnetId],
        SecurityGroupIds: [lustreSecurityGroup.securityGroupId],
        LustreConfiguration: {
          DeploymentType: 'SCRATCH_2',
          ImportPath: bucket.s3UrlForObject(),
          ExportPath: bucket.s3UrlForObject('export'),
          ImportedFileChunkSize: 1024
        }
      },
      iamResources: ['*'],
      resultPath: '$.fileSystem'
    });

    const waitForFileSystem = new sfn.Wait(this, 'WaitForFileSystem', {
      time: sfn.WaitTime.duration(cdk.Duration.minutes(5))
    });

    const checkFileSystemStatus = new tasks.CallAwsService(this, 'CheckFileSystemStatus', {
      service: 'fsx',
      action: 'describeFileSystems',
      parameters: {
        FileSystemIds: sfn.JsonPath.stringAt('$.fileSystem.FileSystem.FileSystemId')
      },
      iamResources: ['*'],
      resultPath: '$.status'
    });

    const isFileSystemAvailable = new sfn.Choice(this, 'IsFileSystemAvailable');
    const fileSystemAvailable = new sfn.Succeed(this, 'FileSystemAvailable');

    const definition = createLustreFileSystem
      .next(waitForFileSystem)
      .next(checkFileSystemStatus)
      .next(
        isFileSystemAvailable
          .when(sfn.Condition.stringEquals('$.status.FileSystems[0].Lifecycle', 'AVAILABLE'), fileSystemAvailable)
          .otherwise(waitForFileSystem)
      );

    new sfn.StateMachine(this, 'CreateLustreStateMachine', {
      definition,
      timeout: cdk.Duration.hours(1),
      role: stepFunctionsRole
    });
  }
}
