import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as batch from 'aws-cdk-lib/aws-batch';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

interface BatchWithEbsStackProps extends cdk.StackProps {
  ebsSizeGb?: number;
  ebsIOPS?: number;
  ebsThroughput?: number;
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
  waitForEbsCreationSeconds?: number;
  waitForJobCompletionSeconds?: number;
  deleteEbs?: boolean;
}

export class BatchWithEbsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: BatchWithEbsStackProps) {
    super(scope, id, props);
const ebsSizeGb = props?.ebsSizeGb ?? 500;
const ebsIOPS = props?.ebsIOPS ?? 5000;
const ebsThroughput = props?.ebsThroughput ?? 500;
const jobDefinitionRetryAttempts = props?.jobDefinitionRetryAttempts ?? 5;
const jobDefinitionVcpus = props?.jobDefinitionVcpus ?? 32;
const jobDefinitionMemory = props?.jobDefinitionMemory ?? 30000;
const ecrRepositoryName = props?.ecrRepositoryName ?? 'batch-job-with-ebs';
const computeEnvironmentType = props?.computeEnvironmentType ?? 'SPOT'; //computeEnvironmentType can be chosen from EC2 or SPOT
const computeEnvironmentAllocationStrategy = props?.computeEnvironmentAllocationStrategy ?? 'SPOT_PRICE_CAPACITY_OPTIMIZED'; //When computeEnvironmentType is set to 'EC2', BEST_FIT_PROGRESSIVE shold be selected, and when set to 'SPOT', SPOT_PRICE_CAPACITY_OPTIMIZED should be selected
const computeEnvironmentMaxvCpus = props?.computeEnvironmentMaxvCpus ?? 256;
const computeEnvironmentMinvCpus = props?.computeEnvironmentMinvCpus ?? 0;
const computeEnvironmentDesiredvCpus = props?.computeEnvironmentDesiredvCpus ?? 0;
const computeEnvironmentInstanceTypes = props?.computeEnvironmentInstanceTypes ?? ['optimal']; //When explicitly specifying instance types, specify them in array format. Example: ['c4.4xlarge','m4.4xlarge', 'c4.8xlarge']
const waitForEbsCreationSeconds = props?.waitForEbsCreationSeconds ?? 30;
const waitForJobCompletionSeconds = props?.waitForJobCompletionSeconds ?? 300;
const deleteEbs = props?.deleteEbs ?? false;

// Create ECR repository
const ecrRepository = new ecr.Repository(this, 'BatchJobRepository', {
  repositoryName: ecrRepositoryName,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
  emptyOnDelete: true,
});

// Generate container image URI
const containerImageUri = `${this.account}.dkr.ecr.${this.region}.amazonaws.com/${ecrRepositoryName}:latest`;

// Store EBS size and related parameters in Secrets Manager
const ebsSecret = new secretsmanager.Secret(this, 'BatchWithEbsSecret', {
  description: 'Configuration values for executing AWS Batch jobs with StepFunction',
  secretObjectValue: {
    ebsSizeGb: cdk.SecretValue.unsafePlainText(ebsSizeGb.toString()),
    ebsIOPS: cdk.SecretValue.unsafePlainText(ebsIOPS.toString()),
    ebsThroughput: cdk.SecretValue.unsafePlainText(ebsThroughput.toString()),
    jobDefinitionRetryAttempts: cdk.SecretValue.unsafePlainText(jobDefinitionRetryAttempts.toString()),
    jobDefinitionVcpus: cdk.SecretValue.unsafePlainText(jobDefinitionVcpus.toString()),
    jobDefinitionMemory: cdk.SecretValue.unsafePlainText(jobDefinitionMemory.toString()),
    jobDefinitionContainerImage: cdk.SecretValue.unsafePlainText(containerImageUri),
    waitForEbsCreationSeconds: cdk.SecretValue.unsafePlainText(waitForEbsCreationSeconds.toString()),
    waitForJobCompletionSeconds: cdk.SecretValue.unsafePlainText(waitForJobCompletionSeconds.toString()),
    deleteEbs: cdk.SecretValue.unsafePlainText(deleteEbs.toString()),
  },
});

      // Create a VPC in a single AZ
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

      // Create S3 bucket
      const bucket = new s3.Bucket(this, 'DataBucket', {
        versioned: true,
        encryption: s3.BucketEncryption.S3_MANAGED,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
      });

      // Type parameter and ECR repository already created above

      // Add permissions required for ECR repository custom resource
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

      // Security group for Batch
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

      // Reference AWS Batch service-linked role
      const batchServiceLinkedRole = iam.Role.fromRoleName(
        this,
        'BatchServiceLinkedRole',
        `aws-service-role/batch.amazonaws.com/AWSServiceRoleForBatch`
      );

      // Batch compute environment
      const computeEnvironment = new batch.CfnComputeEnvironment(this, 'BatchJobWithEbsComputeEnvironment', {
        type: 'MANAGED',
        computeResources: {
          type: computeEnvironmentType,
          allocationStrategy: computeEnvironmentAllocationStrategy,
          maxvCpus: computeEnvironmentMaxvCpus,
          minvCpus: computeEnvironmentMinvCpus,
          desiredvCpus: computeEnvironmentDesiredvCpus,
          instanceTypes: computeEnvironmentInstanceTypes,
          subnets: vpc.privateSubnets.map(subnet => subnet.subnetId),
          securityGroupIds: [batchSecurityGroup.securityGroupId],
          instanceRole: batchInstanceProfile.attrArn,
        },
        serviceRole: batchServiceLinkedRole.roleArn,
        state: 'ENABLED',
        replaceComputeEnvironment: true,
      });

      // Job queue
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

      // Create IAM role for container
      const containerJobRole = new iam.Role(this, 'ContainerJobRole', {
        assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
        inlinePolicies: {
          'S3Permissions': new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                  's3:PutObject',
                  's3:GetObject',
                  's3:ListBucket'
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

      // IAM role for Step Functions
      const stepFunctionsRole = new iam.Role(this, 'CreateEbsStateMachineRole', {
        assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
        inlinePolicies: {
          'EbsPermissions': new iam.PolicyDocument({
            statements: [
              // Permissions for Secrets Manager
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                  'secretsmanager:GetSecretValue'
                ],
                resources: [ebsSecret.secretArn]
              }),
              // Permissions for EBS operations
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
              // Permissions for EC2 launch templates
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                  'ec2:CreateLaunchTemplate',
                  'ec2:CreateLaunchTemplateVersion',
                  'ec2:ModifyLaunchTemplate'
                ],
                resources: ['*']
              }),
              // Permissions to update Batch compute environment
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                  'batch:UpdateComputeEnvironment'
                ],
                resources: ['*']
              }),
              // Permission to pass service-linked role to Batch
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                  'iam:PassRole'
                ],
                resources: [`arn:aws:iam::${this.account}:role/aws-service-role/batch.amazonaws.com/AWSServiceRoleForBatch`]
              }),
              // Permission to create Batch job definitions
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                  'batch:RegisterJobDefinition',
                  'batch:DeregisterJobDefinition'
                ],
                resources: ['*']
              }),
              // Permissions to submit and check Batch jobs
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                  'batch:SubmitJob',
                  'batch:DescribeJobs'
                ],
                resources: ['*']
              }),
              // Permission to pass container IAM role to Batch
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                  'iam:PassRole'
                ],
                resources: [containerJobRole.roleArn]
              })
            ]
          })
        }
      });

      // Get secret from Secrets Manager
      const getSecret = new tasks.CallAwsService(this, 'GetSecret', {
        service: 'secretsmanager',
        action: 'getSecretValue',
        parameters: {
          SecretId: ebsSecret.secretName
        },
        iamResources: [ebsSecret.secretArn],
        resultPath: '$.secretTemp'
      });

      // Extract required parameters from secret
      const extractParameters = new sfn.Pass(this, 'ExtractParameters', {
        parameters: {
          'SecretsManagerParameters.$': 'States.StringToJson($.secretTemp.SecretString)'
        },
        resultPath: '$.credentials'
      });

      // Create EBS volume
      const createEbs = new tasks.CallAwsService(this, 'CreateEbs', {
        service: 'ec2',
        action: 'createVolume',
        parameters: {
          AvailabilityZone: vpc.privateSubnets[0].availabilityZone,
          'Size.$': 'States.StringToJson($.credentials.SecretsManagerParameters.ebsSizeGb)',
          VolumeType: 'gp3',
          Encrypted: false,
          'Iops.$': 'States.StringToJson($.credentials.SecretsManagerParameters.ebsIOPS)',
          'Throughput.$': 'States.StringToJson($.credentials.SecretsManagerParameters.ebsThroughput)'
        },
        iamResources: ['*'],
        resultPath: '$.volume'
      });

      // Wait for EBS volume creation
      const waitForEbsCreation = new sfn.Wait(this, 'WaitForEbsCreation', {
        time: sfn.WaitTime.secondsPath('$.credentials.SecretsManagerParameters.waitForEbsCreationSeconds')
      });

      // Check EBS volume status
      const checkEbsStatus = new tasks.CallAwsService(this, 'CheckEbsStatus', {
        service: 'ec2',
        action: 'describeVolumes',
        parameters: {
          'VolumeIds.$': "States.Array($.volume.VolumeId)"
        },
        iamResources: ['*'],
        resultPath: '$.volumeStatus'
      });

      // Create launch template
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
          }
        },
        iamResources: ['*'],
        resultPath: '$.launchTemplate'
      });

      // Update computing environment
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

      // Create job definition
      const createJobDefinition = new tasks.CallAwsService(this, 'CreateJobDefinition', {
        service: 'batch',
        action: 'registerJobDefinition',
        parameters: {
          JobDefinitionName: sfn.JsonPath.format('ebs-job-definition-{}', sfn.JsonPath.stringAt('$.volume.VolumeId')),
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
            JobRoleArn: containerJobRole.roleArn,
            Environment: [
              {
                Name: 'S3_BUCKET_NAME',
                Value: bucket.bucketName
              }
            ],
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

      // Submit job
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

      // Wait for job completion
      const waitForJobCompletion = new sfn.Wait(this, 'WaitForJobCompletion', {
        time: sfn.WaitTime.secondsPath('$.credentials.SecretsManagerParameters.waitForJobCompletionSeconds')
      });

      // Check job status
      const checkJobStatus = new tasks.CallAwsService(this, 'CheckJobStatus', {
        service: 'batch',
        action: 'describeJobs',
        parameters: {
          'Jobs.$': "States.Array($.submittedJob.JobId)"
        },
        iamResources: ['*'],
        resultPath: '$.jobStatus'
      });

      // Define completion states
      const jobComplete = new sfn.Succeed(this, 'jobComplete');
      const jobFailed = new sfn.Fail(this, 'JobFailed', {
        cause: 'Batch Job Failed',
        error: 'BatchJobError'
      });

      // Check EBS volume availability
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

      // Verify job completion
      const isJobComplete = new sfn.Choice(this, 'IsJobComplete')
        .when(sfn.Condition.stringEquals('$.jobStatus.Jobs[0].Status', 'SUCCEEDED'), jobComplete)
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

      // Define state machine
      const definition = getSecret
        .next(extractParameters)
        .next(createEbs)
        .next(waitForEbsCreation)
        .next(checkEbsStatus)
        .next(isEbsAvailable);

      new sfn.StateMachine(this, 'BatchJobWithEbsStateMachine', {
        definitionBody: sfn.DefinitionBody.fromChainable(definition),
        role: stepFunctionsRole
      });
  }
}