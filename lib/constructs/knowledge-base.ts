import * as cdk from 'aws-cdk-lib';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { Config } from '../utils/config';
import { VectorDatabaseConstruct } from './vector-database';
import { 
  generateResourceName,
  generateTags,
  getRemovalPolicy,
  getSSMParameterName,
  createResourceDescription,
  isBedrockSupportedInRegion,
  generateIAMRoleName,
  generateLambdaFunctionName,
  formatLogGroupName,
  getTimeoutConfiguration
} from '../utils/helpers';

export interface KnowledgeBaseProps {
  config: Config;
  documentsBucket: s3.IBucket;
  vectorDatabase: VectorDatabaseConstruct;
  encryptionKey?: cdk.aws_kms.IKey;
}

export class KnowledgeBaseConstruct extends Construct {
  public readonly knowledgeBase: bedrock.CfnKnowledgeBase;
  public readonly dataSource: bedrock.CfnDataSource;
  public readonly knowledgeBaseRole: iam.Role;
  public readonly knowledgeBaseId: string;
  public readonly dataSourceId: string;
  public readonly ingestionLambda: lambda.Function;
  public readonly statusMonitorLambda: lambda.Function;

  constructor(scope: Construct, id: string, props: KnowledgeBaseProps) {
    super(scope, id);

    const { config, documentsBucket, vectorDatabase, encryptionKey } = props;

    // Validate region support
    if (!isBedrockSupportedInRegion(config.region)) {
      throw new Error(`Bedrock not supported in region: ${config.region}`);
    }

    // Create IAM role for Knowledge Base
    this.knowledgeBaseRole = this.createKnowledgeBaseRole(config, documentsBucket, vectorDatabase, encryptionKey);

    // Update vector database access policy to include this role
    const updatedDataAccessPolicy = this.updateVectorDatabaseAccess(config, vectorDatabase);

    // Create the Knowledge Base
    this.knowledgeBase = this.createKnowledgeBase(config, vectorDatabase);
    this.knowledgeBaseId = this.knowledgeBase.ref;

    // Create the Data Source
    this.dataSource = this.createDataSource(config, documentsBucket);
    this.dataSourceId = this.dataSource.ref;

    // Create Lambda functions for ingestion management
    this.ingestionLambda = this.createIngestionLambda(config);
    this.statusMonitorLambda = this.createStatusMonitorLambda(config);

    // Set up automated ingestion triggers
    this.setupIngestionTriggers(config, documentsBucket);

    // Create SSM parameters
    this.createSSMParameters(config);

    // Create outputs
    this.createOutputs(config);

    // Apply tags
    this.applyTags(config);
  }

  private createKnowledgeBaseRole(
    config: Config,
    documentsBucket: s3.IBucket,
    vectorDatabase: VectorDatabaseConstruct,
    encryptionKey?: cdk.aws_kms.IKey
  ): iam.Role {
    const roleName = generateIAMRoleName(config, 'knowledgebase');

    const role = new iam.Role(this, 'KnowledgeBaseRole', {
      roleName,
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      description: createResourceDescription(config, 'IAM Role', 'Bedrock Knowledge Base execution'),
    });

    // S3 permissions for the documents bucket
    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:ListBucket',
        's3:GetBucketLocation',
        's3:GetObjectVersion',
      ],
      resources: [
        documentsBucket.bucketArn,
        `${documentsBucket.bucketArn}/*`,
      ],
    }));

    // Bedrock model permissions
    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
        'bedrock:GetFoundationModel',
        'bedrock:ListFoundationModels',
      ],
      resources: [
        `arn:aws:bedrock:${config.region}::foundation-model/${config.embeddingModel}`,
        `arn:aws:bedrock:${config.region}:*:foundation-model/*`,
      ],
    }));

    // Add vector database access permissions
    const vectorDbStatements = vectorDatabase.getAccessPolicyStatements();
    vectorDbStatements.forEach(statement => {
      role.addToPolicy(statement);
    });

    // KMS permissions if encryption is enabled
    if (encryptionKey) {
      role.addToPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'kms:Decrypt',
          'kms:GenerateDataKey',
          'kms:CreateGrant',
          'kms:DescribeKey',
        ],
        resources: [encryptionKey.keyArn],
      }));
    }

    // CloudWatch Logs permissions
    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      resources: [
        `arn:aws:logs:${config.region}:${cdk.Stack.of(this).account}:log-group:/aws/bedrock/knowledgebases*`,
      ],
    }));

    return role;
  }

  private updateVectorDatabaseAccess(
    config: Config,
    vectorDatabase: VectorDatabaseConstruct
  ): any {
    // The vector database construct should be updated to include this role's ARN
    // This is handled in the VectorDatabaseConstruct.createDataAccessPolicy method
    return vectorDatabase.dataAccessPolicy;
  }

  private createKnowledgeBase(
    config: Config,
    vectorDatabase: VectorDatabaseConstruct
  ): bedrock.CfnKnowledgeBase {
    const kbName = generateResourceName(config, 'knowledge-base');

    const knowledgeBase = new bedrock.CfnKnowledgeBase(this, 'KnowledgeBase', {
      name: kbName,
      description: createResourceDescription(config, 'Knowledge Base', 'RAG document knowledge base'),
      roleArn: this.knowledgeBaseRole.roleArn,
      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn: `arn:aws:bedrock:${config.region}::foundation-model/${config.embeddingModel}`,
          embeddingModelConfiguration: {
            bedrockEmbeddingModelConfiguration: {
              dimensions: config.vectorDimensions,
            },
          },
        },
      },
      storageConfiguration: {
        type: 'OPENSEARCH_SERVERLESS',
        opensearchServerlessConfiguration: {
          collectionArn: `arn:aws:aoss:${config.region}:${cdk.Stack.of(this).account}:collection/${vectorDatabase.collection.ref}`,
          vectorIndexName: config.indexName,
          fieldMapping: {
            vectorField: 'vector',
            textField: 'text',
            metadataField: 'metadata',
          },
        },
      },
      tags: generateTags(config, {
        ResourceType: 'KnowledgeBase',
        Service: 'Bedrock',
      }),
    });

    // Add dependency on vector database
    knowledgeBase.addDependency(vectorDatabase.collection);
    knowledgeBase.addDependency(vectorDatabase.dataAccessPolicy);

    return knowledgeBase;
  }

  private createDataSource(config: Config, documentsBucket: s3.IBucket): bedrock.CfnDataSource {
    const dataSourceName = generateResourceName(config, 'data-source');

    const dataSource = new bedrock.CfnDataSource(this, 'DataSource', {
      name: dataSourceName,
      description: createResourceDescription(config, 'Data Source', 'S3 documents data source'),
      knowledgeBaseId: this.knowledgeBase.ref,
      dataSourceConfiguration: {
        type: 'S3',
        s3Configuration: {
          bucketArn: documentsBucket.bucketArn,
          inclusionPrefixes: ['documents/'],
          exclusionPrefixes: ['documents/temp/', 'documents/.tmp/'],
        },
      },
      dataDeletionPolicy: 'RETAIN', // Keep vectors when source documents are deleted
      vectorIngestionConfiguration: {
        chunkingConfiguration: {
          chunkingStrategy: 'FIXED_SIZE',
          fixedSizeChunkingConfiguration: {
            maxTokens: config.chunkSize,
            overlapPercentage: Math.round((config.chunkOverlap / config.chunkSize) * 100),
          },
        },
        parsingConfiguration: {
          parsingStrategy: 'BEDROCK_FOUNDATION_MODEL',
          bedrockFoundationModelConfiguration: {
            modelArn: `arn:aws:bedrock:${config.region}::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0`,
            parsingPrompt: {
              parsingPromptText: `
You are a document parser. Extract and structure the content from the following document.
Focus on preserving:
1. Main concepts and ideas
2. Technical details and specifications
3. Relationships between concepts
4. Important metadata (dates, names, numbers)

Format the output as clean, structured text that preserves the document's meaning and context.
Remove any formatting artifacts, headers, footers, or navigation elements.
Maintain paragraph structure and logical flow.

Document content:
`,
            },
          },
        },
      },
    });

    // Add dependency on knowledge base
    dataSource.addDependency(this.knowledgeBase);

    return dataSource;
  }

  private createIngestionLambda(config: Config): lambda.Function {
    const functionName = generateLambdaFunctionName(config, 'ingestion-trigger');
    const logGroupName = formatLogGroupName(config, 'ingestion-trigger');
    const timeouts = getTimeoutConfiguration(config);

    // Create log group
    const logGroup = new logs.LogGroup(this, 'IngestionLambdaLogGroup', {
      logGroupName,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: getRemovalPolicy(config, 'infrastructure'),
    });

    const ingestionFunction = new lambda.Function(this, 'IngestionLambda', {
      functionName,
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'index.handler',
      timeout: timeouts.ingestionTimeout,
      memorySize: 256,
      environment: {
        KNOWLEDGE_BASE_ID: this.knowledgeBase.ref,
        DATA_SOURCE_ID: this.dataSource.ref,
        ENVIRONMENT: config.environment,
        LOG_LEVEL: config.environment === 'prod' ? 'INFO' : 'DEBUG',
      },
      code: lambda.Code.fromInline(`
import json
import boto3
import logging
import os
from typing import Dict, Any
from datetime import datetime

# Set up logging
log_level = os.environ.get('LOG_LEVEL', 'INFO')
logging.basicConfig(level=getattr(logging, log_level))
logger = logging.getLogger(__name__)

bedrock_agent = boto3.client('bedrock-agent')

def handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    """
    Trigger Knowledge Base ingestion job when documents are uploaded to S3
    """
    try:
        logger.info(f"Received event: {json.dumps(event, default=str)}")
        
        knowledge_base_id = os.environ['KNOWLEDGE_BASE_ID']
        data_source_id = os.environ['DATA_SOURCE_ID']
        
        # Start ingestion job
        response = bedrock_agent.start_ingestion_job(
            knowledgeBaseId=knowledge_base_id,
            dataSourceId=data_source_id,
            description=f"Automated ingestion triggered at {datetime.utcnow().isoformat()}"
        )
        
        ingestion_job_id = response['ingestionJob']['ingestionJobId']
        logger.info(f"Started ingestion job: {ingestion_job_id}")
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Ingestion job started successfully',
                'ingestionJobId': ingestion_job_id,
                'knowledgeBaseId': knowledge_base_id,
                'dataSourceId': data_source_id
            })
        }
        
    except Exception as e:
        logger.error(f"Error starting ingestion job: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': str(e),
                'message': 'Failed to start ingestion job'
            })
        }
`),
    });

    // Add permissions for Bedrock Agent
    ingestionFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:StartIngestionJob',
        'bedrock:GetIngestionJob',
        'bedrock:ListIngestionJobs',
      ],
      resources: [
        `arn:aws:bedrock:${config.region}:${cdk.Stack.of(this).account}:knowledge-base/${this.knowledgeBase.ref}`,
        `arn:aws:bedrock:${config.region}:${cdk.Stack.of(this).account}:knowledge-base/${this.knowledgeBase.ref}/data-source/${this.dataSource.ref}`,
      ],
    }));

    return ingestionFunction;
  }

  private createStatusMonitorLambda(config: Config): lambda.Function {
    const functionName = generateLambdaFunctionName(config, 'ingestion-monitor');
    const logGroupName = formatLogGroupName(config, 'ingestion-monitor');
    const timeouts = getTimeoutConfiguration(config);

    // Create log group
    const logGroup = new logs.LogGroup(this, 'StatusMonitorLambdaLogGroup', {
      logGroupName,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: getRemovalPolicy(config, 'infrastructure'),
    });

    const monitorFunction = new lambda.Function(this, 'StatusMonitorLambda', {
      functionName,
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'index.handler',
      timeout: timeouts.lambdaTimeout,
      memorySize: 128,
      environment: {
        KNOWLEDGE_BASE_ID: this.knowledgeBase.ref,
        DATA_SOURCE_ID: this.dataSource.ref,
        ENVIRONMENT: config.environment,
        LOG_LEVEL: config.environment === 'prod' ? 'INFO' : 'DEBUG',
      },
      code: lambda.Code.fromInline(`
import json
import boto3
import logging
import os
from typing import Dict, Any

# Set up logging
log_level = os.environ.get('LOG_LEVEL', 'INFO')
logging.basicConfig(level=getattr(logging, log_level))
logger = logging.getLogger(__name__)

bedrock_agent = boto3.client('bedrock-agent')
cloudwatch = boto3.client('cloudwatch')

def handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    """
    Monitor Knowledge Base ingestion job status and publish metrics
    """
    try:
        logger.info(f"Monitoring ingestion status")
        
        knowledge_base_id = os.environ['KNOWLEDGE_BASE_ID']
        data_source_id = os.environ['DATA_SOURCE_ID']
        
        # Get recent ingestion jobs
        response = bedrock_agent.list_ingestion_jobs(
            knowledgeBaseId=knowledge_base_id,
            dataSourceId=data_source_id,
            maxResults=10
        )
        
        jobs = response.get('ingestionJobSummaries', [])
        
        # Analyze job statuses
        status_counts = {}
        latest_job = None
        
        for job in jobs:
            status = job['status']
            status_counts[status] = status_counts.get(status, 0) + 1
            
            if not latest_job or job['updatedAt'] > latest_job['updatedAt']:
                latest_job = job
        
        # Publish CloudWatch metrics
        namespace = f"RAG-Demo/{os.environ['ENVIRONMENT']}"
        
        for status, count in status_counts.items():
            cloudwatch.put_metric_data(
                Namespace=namespace,
                MetricData=[
                    {
                        'MetricName': f'IngestionJobs_{status}',
                        'Value': count,
                        'Unit': 'Count',
                        'Dimensions': [
                            {
                                'Name': 'KnowledgeBaseId',
                                'Value': knowledge_base_id
                            },
                            {
                                'Name': 'DataSourceId',
                                'Value': data_source_id
                            }
                        ]
                    }
                ]
            )
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Status monitoring completed',
                'statusCounts': status_counts,
                'latestJob': latest_job,
                'totalJobs': len(jobs)
            }, default=str)
        }
        
    except Exception as e:
        logger.error(f"Error monitoring ingestion status: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': str(e),
                'message': 'Failed to monitor ingestion status'
            })
        }
`),
    });

    // Add permissions for Bedrock Agent and CloudWatch
    monitorFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:GetIngestionJob',
        'bedrock:ListIngestionJobs',
      ],
      resources: [
        `arn:aws:bedrock:${config.region}:${cdk.Stack.of(this).account}:knowledge-base/${this.knowledgeBase.ref}`,
        `arn:aws:bedrock:${config.region}:${cdk.Stack.of(this).account}:knowledge-base/${this.knowledgeBase.ref}/data-source/${this.dataSource.ref}`,
      ],
    }));

    monitorFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'cloudwatch:PutMetricData',
      ],
      resources: ['*'],
    }));

    return monitorFunction;
  }

  private setupIngestionTriggers(config: Config, documentsBucket: s3.IBucket): void {
    // Create EventBridge rule for S3 object creation
    const s3UploadRule = new events.Rule(this, 'S3UploadRule', {
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: {
            name: [documentsBucket.bucketName],
          },
          object: {
            key: [{ prefix: 'documents/' }],
          },
        },
      },
    });

    // Add Lambda target for ingestion
    s3UploadRule.addTarget(new targets.LambdaFunction(this.ingestionLambda, {
      maxEventAge: cdk.Duration.hours(2),
      retryAttempts: 3,
    }));

    // Create scheduled rule for status monitoring
    const monitorRule = new events.Rule(this, 'IngestionMonitorRule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
    });

    monitorRule.addTarget(new targets.LambdaFunction(this.statusMonitorLambda));
  }

  private createSSMParameters(config: Config): void {
    new ssm.StringParameter(this, 'KnowledgeBaseIdParameter', {
      parameterName: getSSMParameterName(config, 'knowledge-base-id'),
      stringValue: this.knowledgeBase.ref,
      description: 'Bedrock Knowledge Base ID',
    });

    new ssm.StringParameter(this, 'DataSourceIdParameter', {
      parameterName: getSSMParameterName(config, 'data-source-id'),
      stringValue: this.dataSource.ref,
      description: 'Bedrock Data Source ID',
    });

    new ssm.StringParameter(this, 'KnowledgeBaseArnParameter', {
      parameterName: getSSMParameterName(config, 'knowledge-base-arn'),
      stringValue: `arn:aws:bedrock:${config.region}:${cdk.Stack.of(this).account}:knowledge-base/${this.knowledgeBase.ref}`,
      description: 'Bedrock Knowledge Base ARN',
    });

    new ssm.StringParameter(this, 'EmbeddingModelParameter', {
      parameterName: getSSMParameterName(config, 'embedding-model'),
      stringValue: config.embeddingModel,
      description: 'Embedding model used by Knowledge Base',
    });
  }

  private createOutputs(config: Config): void {
    new cdk.CfnOutput(this, 'KnowledgeBaseId', {
      value: this.knowledgeBase.ref,
      description: 'Bedrock Knowledge Base ID',
      exportName: `RagDemo-KnowledgeBaseId-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'DataSourceId', {
      value: this.dataSource.ref,
      description: 'Bedrock Data Source ID',
      exportName: `RagDemo-DataSourceId-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'KnowledgeBaseArn', {
      value: `arn:aws:bedrock:${config.region}:${cdk.Stack.of(this).account}:knowledge-base/${this.knowledgeBase.ref}`,
      description: 'Bedrock Knowledge Base ARN',
      exportName: `RagDemo-KnowledgeBaseArn-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'IngestionLambdaArn', {
      value: this.ingestionLambda.functionArn,
      description: 'Ingestion Lambda Function ARN',
      exportName: `RagDemo-IngestionLambdaArn-${config.environment}`,
    });
  }

  private applyTags(config: Config): void {
    const tags = generateTags(config, {
      ResourceType: 'KnowledgeBase',
      Service: 'Bedrock',
      EmbeddingModel: config.embeddingModel,
    });
    
    Object.entries(tags).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
  }
} 