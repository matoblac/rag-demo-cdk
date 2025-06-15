import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as events from 'aws-cdk-lib/aws-events';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';
import { Config } from '../utils/config';
import { 
  generateResourceName, 
  generateTags, 
  getRemovalPolicy, 
  generateBucketName,
  getSSMParameterName,
  createResourceDescription,
  validateAndFormatEmail,
  generateSNSTopicName,
  generateKMSKeyAlias,
  getCostAllocationTags
} from '../utils/helpers';

export interface StorageStackProps extends cdk.StackProps {
  config: Config;
}

export class StorageStack extends cdk.Stack {
  public readonly documentsBucket: s3.Bucket;
  public readonly backupBucket?: s3.Bucket;
  public readonly encryptionKey: kms.Key;
  public readonly notificationTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const { config } = props;

    // Validate region support
    if (!this.isRegionSupported(config.region)) {
      throw new Error(`Storage stack not supported in region: ${config.region}`);
    }

    // Create KMS key for encryption
    this.encryptionKey = this.createEncryptionKey(config);

    // Create SNS topic for notifications
    this.notificationTopic = this.createNotificationTopic(config);

    // Create main documents bucket with maximum protection
    this.documentsBucket = this.createDocumentsBucket(config);

    // Create backup bucket in different region (if replication enabled)
    if (config.enableReplication && config.backupRegion) {
      this.backupBucket = this.createBackupBucket(config);
      this.setupCrossRegionReplication(config);
    }

    // Create EventBridge rules for document lifecycle events
    this.createDocumentLifecycleEvents(config);

    // Store configuration in SSM Parameter Store
    this.createSSMParameters(config);

    // Create outputs for other stacks
    this.createOutputs(config);

    // Apply tags to all resources
    this.applyTags(config);
  }

  private createEncryptionKey(config: Config): kms.Key {
    const keyAlias = generateKMSKeyAlias(config, 'storage');
    
    const key = new kms.Key(this, 'StorageEncryptionKey', {
      alias: keyAlias,
      description: createResourceDescription(config, 'KMS Key', 'Storage encryption'),
      enableKeyRotation: true,
      policy: new iam.PolicyDocument({
        statements: [
          // Allow root account full access
          new iam.PolicyStatement({
            sid: 'Enable IAM User Permissions',
            principals: [new iam.AccountRootPrincipal()],
            actions: ['kms:*'],
            resources: ['*'],
          }),
          // Allow S3 service to use the key
          new iam.PolicyStatement({
            sid: 'Allow S3 Service',
            principals: [new iam.ServicePrincipal('s3.amazonaws.com')],
            actions: [
              'kms:Decrypt',
              'kms:GenerateDataKey',
              'kms:CreateGrant',
              'kms:DescribeKey',
            ],
            resources: ['*'],
          }),
          // Allow Bedrock service to use the key
          new iam.PolicyStatement({
            sid: 'Allow Bedrock Service',
            principals: [new iam.ServicePrincipal('bedrock.amazonaws.com')],
            actions: [
              'kms:Decrypt',
              'kms:GenerateDataKey',
              'kms:CreateGrant',
              'kms:DescribeKey',
            ],
            resources: ['*'],
          }),
        ],
      }),
    });

    // Add deletion protection in production
    if (config.environment === 'prod') {
      key.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
    }

    return key;
  }

  private createNotificationTopic(config: Config): sns.Topic {
    const topicName = generateSNSTopicName(config, 'storage-events');
    
    const topic = new sns.Topic(this, 'StorageNotificationTopic', {
      topicName,
      displayName: `RAG Demo Storage Events - ${config.environment}`,
      masterKey: this.encryptionKey,
    });

    // Add email subscription if configured
    const alertEmail = validateAndFormatEmail(config.alertEmail);
    if (alertEmail) {
      topic.addSubscription(new snsSubscriptions.EmailSubscription(alertEmail));
    }

    return topic;
  }

  private createDocumentsBucket(config: Config): s3.Bucket {
    const bucketName = config.bucketName;
    
    const bucket = new s3.Bucket(this, 'DocumentsBucket', {
      bucketName,
      versioned: config.enableVersioning,
      encryptionKey: config.enableEncryption ? this.encryptionKey : undefined,
      encryption: config.enableEncryption ? s3.BucketEncryption.KMS : s3.BucketEncryption.S3_MANAGED,
      publicReadAccess: false,
      publicWriteAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: getRemovalPolicy(config, 'storage'),
      autoDeleteObjects: false, // Never auto-delete in storage stack
      enforceSSL: true,
      eventBridgeEnabled: true,
      
      // MFA Delete (production only)
      ...(config.enableMfaDelete && config.environment === 'prod' && {
        // Note: MFA delete can only be enabled via CLI after bucket creation
      }),
      
      // Lifecycle configuration for cost optimization
      lifecycleRules: [
        {
          id: 'StandardIATransition',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
            {
              storageClass: s3.StorageClass.DEEP_ARCHIVE,
              transitionAfter: cdk.Duration.days(365),
            },
          ],
        },
        {
          id: 'IncompleteMultipartUploads',
          enabled: true,
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
        // Clean up old versions to manage costs
        ...(config.enableVersioning ? [{
          id: 'OldVersionCleanup',
          enabled: true,
          noncurrentVersionExpiration: cdk.Duration.days(365),
          noncurrentVersionTransitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        }] : []),
      ],
      
      // Intelligent tiering for automatic cost optimization
      intelligentTieringConfigurations: [
        {
          id: 'EntireBucket',
          status: s3.IntelligentTieringStatus.ENABLED,
          optionalFields: [
            s3.IntelligentTieringOptionalFields.BUCKET_KEY_STATUS,
          ],
        },
      ],
      
      // CORS configuration for web uploads
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.POST, s3.HttpMethods.PUT],
          allowedOrigins: ['*'], // Restrict this in production
          allowedHeaders: ['*'],
          maxAge: 3600,
        },
      ],
      
      // Server access logging (optional)
      ...(config.environment === 'prod' && {
        serverAccessLogsBucket: this.createAccessLogsBucket(config),
        serverAccessLogsPrefix: 'access-logs/',
      }),
    });

    // Add bucket notifications
    bucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new cdk.aws_s3_notifications.SnsDestination(this.notificationTopic),
      { prefix: 'documents/' }
    );

    bucket.addEventNotification(
      s3.EventType.OBJECT_REMOVED,
      new cdk.aws_s3_notifications.SnsDestination(this.notificationTopic),
      { prefix: 'documents/' }
    );

    return bucket;
  }

  private createBackupBucket(config: Config): s3.Bucket | undefined {
    if (!config.enableReplication || !config.backupRegion) {
      return undefined;
    }

    const backupBucketName = generateBucketName(config, 'backup');
    
    const backupBucket = new s3.Bucket(this, 'BackupBucket', {
      bucketName: backupBucketName,
      versioned: true,
      encryptionKey: this.encryptionKey,
      encryption: s3.BucketEncryption.KMS,
      publicReadAccess: false,
      publicWriteAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: getRemovalPolicy(config, 'storage'),
      autoDeleteObjects: false,
      enforceSSL: true,
      
      // Lifecycle rules for backup bucket
      lifecycleRules: [
        {
          id: 'BackupRetention',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(30),
            },
            {
              storageClass: s3.StorageClass.DEEP_ARCHIVE,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
      ],
    });

    return backupBucket;
  }

  private createAccessLogsBucket(config: Config): s3.Bucket {
    const logsBucketName = generateBucketName(config, 'access-logs');
    
    return new s3.Bucket(this, 'AccessLogsBucket', {
      bucketName: logsBucketName,
      encryption: s3.BucketEncryption.S3_MANAGED,
      publicReadAccess: false,
      publicWriteAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Logs can be destroyed
      autoDeleteObjects: true,
      
      lifecycleRules: [
        {
          id: 'LogsRetention',
          enabled: true,
          expiration: cdk.Duration.days(90),
        },
      ],
    });
  }

  private setupCrossRegionReplication(config: Config): void {
    if (!this.backupBucket || !config.enableReplication) {
      return;
    }

    // Create replication role
    const replicationRole = new iam.Role(this, 'ReplicationRole', {
      assumedBy: new iam.ServicePrincipal('s3.amazonaws.com'),
      description: 'Role for S3 cross-region replication',
    });

    // Add permissions for replication
    replicationRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        's3:GetObjectVersionForReplication',
        's3:GetObjectVersionAcl',
        's3:GetObjectVersionTagging',
      ],
      resources: [`${this.documentsBucket.bucketArn}/*`],
    }));

    replicationRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        's3:ReplicateObject',
        's3:ReplicateDelete',
        's3:ReplicateTags',
      ],
      resources: [`${this.backupBucket.bucketArn}/*`],
    }));

    // Add KMS permissions
    if (config.enableEncryption) {
      replicationRole.addToPolicy(new iam.PolicyStatement({
        actions: [
          'kms:Decrypt',
          'kms:GenerateDataKey',
        ],
        resources: [this.encryptionKey.keyArn],
      }));
    }

    // Configure replication on the source bucket
    const cfnBucket = this.documentsBucket.node.defaultChild as s3.CfnBucket;
    cfnBucket.replicationConfiguration = {
      role: replicationRole.roleArn,
      rules: [
        {
          id: 'ReplicateToBackup',
          status: 'Enabled',
          prefix: 'documents/',
          destination: {
            bucket: this.backupBucket.bucketArn,
            storageClass: 'STANDARD_IA',
            ...(config.enableEncryption && {
              encryptionConfiguration: {
                replicaKmsKeyId: this.encryptionKey.keyArn,
              },
            }),
          },
        },
      ],
    };
  }

  private createDocumentLifecycleEvents(config: Config): void {
    // Create EventBridge rule for document uploads
    const uploadRule = new events.Rule(this, 'DocumentUploadRule', {
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: {
            name: [this.documentsBucket.bucketName],
          },
          object: {
            key: [{ prefix: 'documents/' }],
          },
        },
      },
    });

    // Add SNS target for notifications
    uploadRule.addTarget(new cdk.aws_events_targets.SnsTopic(this.notificationTopic));

    // Create EventBridge rule for document deletions
    const deleteRule = new events.Rule(this, 'DocumentDeleteRule', {
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Deleted'],
        detail: {
          bucket: {
            name: [this.documentsBucket.bucketName],
          },
          object: {
            key: [{ prefix: 'documents/' }],
          },
        },
      },
    });

    deleteRule.addTarget(new cdk.aws_events_targets.SnsTopic(this.notificationTopic));
  }

  private createSSMParameters(config: Config): void {
    // Store bucket information in SSM for other stacks
    new ssm.StringParameter(this, 'DocumentsBucketNameParameter', {
      parameterName: getSSMParameterName(config, 'documents-bucket-name'),
      stringValue: this.documentsBucket.bucketName,
      description: 'Name of the documents S3 bucket',
    });

    new ssm.StringParameter(this, 'DocumentsBucketArnParameter', {
      parameterName: getSSMParameterName(config, 'documents-bucket-arn'),
      stringValue: this.documentsBucket.bucketArn,
      description: 'ARN of the documents S3 bucket',
    });

    new ssm.StringParameter(this, 'EncryptionKeyIdParameter', {
      parameterName: getSSMParameterName(config, 'encryption-key-id'),
      stringValue: this.encryptionKey.keyId,
      description: 'KMS key ID for storage encryption',
    });

    new ssm.StringParameter(this, 'EncryptionKeyArnParameter', {
      parameterName: getSSMParameterName(config, 'encryption-key-arn'),
      stringValue: this.encryptionKey.keyArn,
      description: 'KMS key ARN for storage encryption',
    });

    if (this.backupBucket) {
      new ssm.StringParameter(this, 'BackupBucketNameParameter', {
        parameterName: getSSMParameterName(config, 'backup-bucket-name'),
        stringValue: this.backupBucket.bucketName,
        description: 'Name of the backup S3 bucket',
      });
    }

    new ssm.StringParameter(this, 'NotificationTopicArnParameter', {
      parameterName: getSSMParameterName(config, 'notification-topic-arn'),
      stringValue: this.notificationTopic.topicArn,
      description: 'SNS topic ARN for storage notifications',
    });
  }

  private createOutputs(config: Config): void {
    new cdk.CfnOutput(this, 'DocumentsBucketName', {
      value: this.documentsBucket.bucketName,
      description: 'Name of the documents S3 bucket',
      exportName: `RagDemo-DocumentsBucket-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'DocumentsBucketArn', {
      value: this.documentsBucket.bucketArn,
      description: 'ARN of the documents S3 bucket',
      exportName: `RagDemo-DocumentsBucketArn-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'EncryptionKeyId', {
      value: this.encryptionKey.keyId,
      description: 'KMS key ID for storage encryption',
      exportName: `RagDemo-EncryptionKeyId-${config.environment}`,
    });

    if (this.backupBucket) {
      new cdk.CfnOutput(this, 'BackupBucketName', {
        value: this.backupBucket.bucketName,
        description: 'Name of the backup S3 bucket',
        exportName: `RagDemo-BackupBucket-${config.environment}`,
      });
    }

    new cdk.CfnOutput(this, 'NotificationTopicArn', {
      value: this.notificationTopic.topicArn,
      description: 'SNS topic ARN for storage notifications',
      exportName: `RagDemo-NotificationTopic-${config.environment}`,
    });
  }

  private applyTags(config: Config): void {
    const tags = getCostAllocationTags(config);
    Object.entries(tags).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
    
    // Add specific tags for storage resources
    cdk.Tags.of(this).add('ResourceType', 'Storage');
    cdk.Tags.of(this).add('Persistence', 'Protected');
    cdk.Tags.of(this).add('BackupEnabled', config.enableReplication.toString());
    cdk.Tags.of(this).add('EncryptionEnabled', config.enableEncryption.toString());
  }

  private isRegionSupported(region: string): boolean {
    // All AWS regions support S3 and KMS
    return true;
  }
} 