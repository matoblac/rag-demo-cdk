import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import { Config } from '../utils/config';
import { VectorDatabaseConstruct } from '../constructs/vector-database';
import { KnowledgeBaseConstruct } from '../constructs/knowledge-base';
import { MonitoringConstruct } from '../constructs/monitoring';
import { 
  generateResourceName,
  generateTags,
  getRemovalPolicy,
  getSSMParameterName,
  createResourceDescription,
  isBedrockSupportedInRegion,
  isOpenSearchServerlessSupportedInRegion,
  getCostAllocationTags
} from '../utils/helpers';

export interface InfrastructureStackProps extends cdk.StackProps {
  config: Config;
  documentsBucket: s3.IBucket;
  backupBucket?: s3.IBucket;
}

export class InfrastructureStack extends cdk.Stack {
  public readonly vectorDatabase: VectorDatabaseConstruct;
  public readonly knowledgeBase: KnowledgeBaseConstruct;
  public readonly monitoring: MonitoringConstruct;
  public readonly knowledgeBaseId: string;
  public readonly collectionEndpoint: string;
  public readonly dashboardsEndpoint: string;

  constructor(scope: Construct, id: string, props: InfrastructureStackProps) {
    super(scope, id, props);

    const { config, documentsBucket, backupBucket } = props;

    // Validate regional service availability
    this.validateRegionalSupport(config);

    // Get encryption key from storage stack
    const encryptionKey = this.getEncryptionKeyFromSSM(config);

    // Get notification topic from storage stack
    const notificationTopic = this.getNotificationTopicFromSSM(config);

    // 1. Create Vector Database (OpenSearch Serverless)
    this.vectorDatabase = new VectorDatabaseConstruct(this, 'VectorDatabase', {
      config,
    });

    // 2. Create Knowledge Base with the vector database
    this.knowledgeBase = new KnowledgeBaseConstruct(this, 'KnowledgeBase', {
      config,
      documentsBucket,
      vectorDatabase: this.vectorDatabase,
      encryptionKey,
    });

    // Set public properties
    this.knowledgeBaseId = this.knowledgeBase.knowledgeBaseId;
    this.collectionEndpoint = this.vectorDatabase.collectionEndpoint;
    this.dashboardsEndpoint = this.vectorDatabase.dashboardsEndpoint;

    // 3. Create comprehensive monitoring
    this.monitoring = new MonitoringConstruct(this, 'Monitoring', {
      config,
      knowledgeBase: this.knowledgeBase,
      vectorDatabase: this.vectorDatabase,
      documentsBucket,
      notificationTopic,
    });

    // 4. Create cross-stack SSM parameters for frontend consumption
    this.createFrontendSSMParameters(config);

    // 5. Create stack outputs
    this.createOutputs(config);

    // 6. Apply comprehensive tagging
    this.applyTags(config);

    // 7. Add custom resource for post-deployment setup
    this.createPostDeploymentSetup(config);
  }

  private validateRegionalSupport(config: Config): void {
    const errors: string[] = [];

    if (!isBedrockSupportedInRegion(config.region)) {
      errors.push(`Bedrock not supported in region: ${config.region}`);
    }

    if (!isOpenSearchServerlessSupportedInRegion(config.region)) {
      errors.push(`OpenSearch Serverless not supported in region: ${config.region}`);
    }

    if (errors.length > 0) {
      throw new Error(`Regional validation failed:\n${errors.join('\n')}`);
    }
  }

  private getEncryptionKeyFromSSM(config: Config): kms.IKey | undefined {
    if (!config.enableEncryption) {
      return undefined;
    }

    try {
      const keyId = ssm.StringParameter.valueFromLookup(
        this,
        getSSMParameterName(config, 'encryption-key-id')
      );
      
      // Use fromKeyArn to import the key using ARN construction
      const keyArn = `arn:aws:kms:${config.region}:${this.account}:key/${keyId}`;
      return kms.Key.fromKeyArn(this, 'ImportedEncryptionKey', keyArn);
    } catch (error) {
      console.warn('Could not import encryption key from SSM, proceeding without encryption');
      return undefined;
    }
  }

  private getNotificationTopicFromSSM(config: Config): sns.ITopic | undefined {
    try {
      const topicArn = ssm.StringParameter.valueFromLookup(
        this,
        getSSMParameterName(config, 'notification-topic-arn')
      );
      
      return sns.Topic.fromTopicArn(this, 'ImportedNotificationTopic', topicArn);
    } catch (error) {
      console.warn('Could not import notification topic from SSM');
      return undefined;
    }
  }

  private createFrontendSSMParameters(config: Config): void {
    // Core infrastructure endpoints
    new ssm.StringParameter(this, 'FrontendConfigParameter', {
      parameterName: getSSMParameterName(config, 'frontend-config'),
      stringValue: JSON.stringify({
        knowledgeBaseId: this.knowledgeBaseId,
        collectionEndpoint: this.collectionEndpoint,
        dashboardsEndpoint: this.dashboardsEndpoint,
        region: config.region,
        environment: config.environment,
        embeddingModel: config.embeddingModel,
        indexName: config.indexName,
        vectorDimensions: config.vectorDimensions,
        chunkSize: config.chunkSize,
        chunkOverlap: config.chunkOverlap,
        supportedFormats: config.supportedFormats,
        maxDocumentSize: config.maxDocumentSize,
        enableOcr: config.enableOcr,
        enableWebScraping: config.enableWebScraping,
      }),
      description: 'Complete frontend configuration for RAG demo',
    });

    // Individual parameters for easier access
    new ssm.StringParameter(this, 'FrontendKnowledgeBaseIdParameter', {
      parameterName: getSSMParameterName(config, 'frontend-knowledge-base-id'),
      stringValue: this.knowledgeBaseId,
      description: 'Knowledge Base ID for frontend',
    });

    new ssm.StringParameter(this, 'FrontendCollectionEndpointParameter', {
      parameterName: getSSMParameterName(config, 'frontend-collection-endpoint'),
      stringValue: this.collectionEndpoint,
      description: 'OpenSearch collection endpoint for frontend',
    });

    new ssm.StringParameter(this, 'FrontendRegionParameter', {
      parameterName: getSSMParameterName(config, 'frontend-region'),
      stringValue: config.region,
      description: 'AWS region for frontend',
    });

    // API endpoint for direct queries (if using Lambda API)
    if (this.monitoring.queryApi) {
      new ssm.StringParameter(this, 'FrontendApiEndpointParameter', {
        parameterName: getSSMParameterName(config, 'frontend-api-endpoint'),
        stringValue: this.monitoring.queryApi.url,
        description: 'API Gateway endpoint for frontend queries',
      });
    }
  }

  private createPostDeploymentSetup(config: Config): void {
    // Create custom resource for post-deployment tasks
    const postDeploymentLambda = new cdk.aws_lambda.Function(this, 'PostDeploymentSetup', {
      functionName: `rag-demo-post-deployment-${config.environment}`,
      runtime: cdk.aws_lambda.Runtime.PYTHON_3_11,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(15),
      memorySize: 512,
      environment: {
        COLLECTION_ENDPOINT: this.collectionEndpoint,
        INDEX_NAME: config.indexName,
        VECTOR_DIMENSIONS: config.vectorDimensions.toString(),
        KNOWLEDGE_BASE_ID: this.knowledgeBaseId,
        ENVIRONMENT: config.environment,
      },
      code: cdk.aws_lambda.Code.fromInline(`
import json
import boto3
import urllib3
import logging
from typing import Dict, Any

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    """
    Post-deployment setup tasks:
    1. Create OpenSearch index with proper mappings
    2. Verify Knowledge Base is accessible
    3. Set up initial monitoring dashboards
    """
    try:
        logger.info(f"Starting post-deployment setup: {json.dumps(event, default=str)}")
        
        request_type = event.get('RequestType', 'Create')
        
        if request_type == 'Create':
            # Create OpenSearch index
            create_opensearch_index()
            
            # Verify Knowledge Base
            verify_knowledge_base()
            
            # Setup monitoring
            setup_monitoring_dashboard()
            
        elif request_type == 'Delete':
            # Cleanup tasks (optional)
            logger.info("Cleanup tasks for stack deletion")
            
        return {
            'Status': 'SUCCESS',
            'PhysicalResourceId': 'post-deployment-setup',
            'Data': {
                'Message': 'Post-deployment setup completed successfully'
            }
        }
        
    except Exception as e:
        logger.error(f"Post-deployment setup failed: {str(e)}")
        return {
            'Status': 'FAILED',
            'Reason': str(e),
            'PhysicalResourceId': 'post-deployment-setup',
        }

def create_opensearch_index():
    """Create the vector index in OpenSearch Serverless"""
    try:
        import os
        from opensearchpy import OpenSearch, RequestsHttpConnection
        from aws_requests_auth.aws_auth import AWSRequestsAuth
        
        # Get AWS credentials for OpenSearch
        session = boto3.Session()
        credentials = session.get_credentials()
        region = session.region_name or 'us-east-1'
        
        awsauth = AWSRequestsAuth(
            aws_access_key=credentials.access_key,
            aws_secret_access_key=credentials.secret_key,
            aws_token=credentials.token,
            aws_host=os.environ['COLLECTION_ENDPOINT'].replace('https://', ''),
            aws_region=region,
            aws_service='aoss'
        )
        
        client = OpenSearch(
            hosts=[{'host': os.environ['COLLECTION_ENDPOINT'].replace('https://', ''), 'port': 443}],
            http_auth=awsauth,
            use_ssl=True,
            verify_certs=True,
            connection_class=RequestsHttpConnection,
            timeout=60
        )
        
        index_name = os.environ['INDEX_NAME']
        vector_dimensions = int(os.environ['VECTOR_DIMENSIONS'])
        
        # Check if index already exists
        if client.indices.exists(index=index_name):
            logger.info(f"Index {index_name} already exists")
            return
        
        # Create index with vector mapping
        index_mapping = {
            "mappings": {
                "properties": {
                    "vector": {
                        "type": "knn_vector",
                        "dimension": vector_dimensions,
                        "method": {
                            "name": "hnsw",
                            "space_type": "cosinesimil",
                            "engine": "faiss",
                            "parameters": {
                                "ef_construction": 256,
                                "m": 16
                            }
                        }
                    },
                    "text": {
                        "type": "text",
                        "analyzer": "standard"
                    },
                    "metadata": {
                        "type": "object",
                        "properties": {
                            "source": {"type": "keyword"},
                            "page": {"type": "integer"},
                            "chunk_id": {"type": "keyword"},
                            "document_id": {"type": "keyword"},
                            "created_at": {"type": "date"},
                            "updated_at": {"type": "date"}
                        }
                    }
                }
            },
            "settings": {
                "index": {
                    "knn": True,
                    "number_of_shards": 1,
                    "number_of_replicas": 0
                }
            }
        }
        
        response = client.indices.create(index=index_name, body=index_mapping)
        logger.info(f"Created index {index_name}: {response}")
        
    except Exception as e:
        logger.error(f"Failed to create OpenSearch index: {str(e)}")
        # Don't fail the deployment if index creation fails
        pass

def verify_knowledge_base():
    """Verify that the Knowledge Base is accessible"""
    try:
        bedrock_agent = boto3.client('bedrock-agent')
        
        knowledge_base_id = os.environ['KNOWLEDGE_BASE_ID']
        
        response = bedrock_agent.get_knowledge_base(
            knowledgeBaseId=knowledge_base_id
        )
        
        logger.info(f"Knowledge Base verified: {response['knowledgeBase']['name']}")
        
    except Exception as e:
        logger.error(f"Failed to verify Knowledge Base: {str(e)}")
        raise

def setup_monitoring_dashboard():
    """Set up initial CloudWatch dashboard"""
    try:
        cloudwatch = boto3.client('cloudwatch')
        environment = os.environ['ENVIRONMENT']
        
        dashboard_name = f"RAG-Demo-{environment}"
        
        dashboard_body = {
            "widgets": [
                {
                    "type": "metric",
                    "x": 0,
                    "y": 0,
                    "width": 12,
                    "height": 6,
                    "properties": {
                        "metrics": [
                            ["RAG-Demo/" + environment, "IngestionJobs_COMPLETE"],
                            ["RAG-Demo/" + environment, "IngestionJobs_FAILED"],
                            ["RAG-Demo/" + environment, "IngestionJobs_IN_PROGRESS"]
                        ],
                        "period": 300,
                        "stat": "Sum",
                        "region": boto3.Session().region_name,
                        "title": "Ingestion Job Status"
                    }
                }
            ]
        }
        
        cloudwatch.put_dashboard(
            DashboardName=dashboard_name,
            DashboardBody=json.dumps(dashboard_body)
        )
        
        logger.info(f"Created CloudWatch dashboard: {dashboard_name}")
        
    except Exception as e:
        logger.error(f"Failed to create monitoring dashboard: {str(e)}")
        # Don't fail deployment if dashboard creation fails
        pass
`),
    });

    // Grant necessary permissions
    postDeploymentLambda.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
      effect: cdk.aws_iam.Effect.ALLOW,
      actions: [
        'aoss:APIAccessAll',
        'aoss:CollectionAPIActions',
        'aoss:CreateIndex',
        'aoss:UpdateIndex',
        'aoss:DescribeIndex',
      ],
      resources: [
        `arn:aws:aoss:${config.region}:${this.account}:collection/${this.vectorDatabase.collection.ref}`,
        `arn:aws:aoss:${config.region}:${this.account}:index/${this.vectorDatabase.collection.ref}/*`,
      ],
    }));

    postDeploymentLambda.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
      effect: cdk.aws_iam.Effect.ALLOW,
      actions: [
        'bedrock:GetKnowledgeBase',
        'bedrock:ListKnowledgeBases',
      ],
      resources: [
        `arn:aws:bedrock:${config.region}:${this.account}:knowledge-base/${this.knowledgeBaseId}`,
      ],
    }));

    postDeploymentLambda.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
      effect: cdk.aws_iam.Effect.ALLOW,
      actions: [
        'cloudwatch:PutDashboard',
        'cloudwatch:GetDashboard',
      ],
      resources: ['*'],
    }));

    // Create custom resource
    const customResource = new cdk.CustomResource(this, 'PostDeploymentCustomResource', {
      serviceToken: postDeploymentLambda.functionArn,
      properties: {
        Timestamp: Date.now(), // Force update on every deployment
      },
    });

    // Ensure custom resource runs after all infrastructure is created
    customResource.node.addDependency(this.vectorDatabase);
    customResource.node.addDependency(this.knowledgeBase);
  }

  private createOutputs(config: Config): void {
    // Core infrastructure outputs
    new cdk.CfnOutput(this, 'KnowledgeBaseId', {
      value: this.knowledgeBaseId,
      description: 'Bedrock Knowledge Base ID',
      exportName: `RagDemo-InfraKnowledgeBaseId-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'CollectionEndpoint', {
      value: this.collectionEndpoint,
      description: 'OpenSearch Serverless collection endpoint',
      exportName: `RagDemo-InfraCollectionEndpoint-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'DashboardsEndpoint', {
      value: this.dashboardsEndpoint,
      description: 'OpenSearch Serverless dashboards endpoint',
      exportName: `RagDemo-InfraDashboardsEndpoint-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'DataSourceId', {
      value: this.knowledgeBase.dataSourceId,
      description: 'Bedrock Data Source ID',
      exportName: `RagDemo-InfraDataSourceId-${config.environment}`,
    });

    // Monitoring outputs
    if (this.monitoring.dashboard) {
      new cdk.CfnOutput(this, 'MonitoringDashboardUrl', {
        value: `https://${config.region}.console.aws.amazon.com/cloudwatch/home?region=${config.region}#dashboards:name=${this.monitoring.dashboard.dashboardName}`,
        description: 'CloudWatch Dashboard URL',
        exportName: `RagDemo-InfraMonitoringDashboard-${config.environment}`,
      });
    }

    // API outputs
    if (this.monitoring.queryApi) {
      new cdk.CfnOutput(this, 'QueryApiUrl', {
        value: this.monitoring.queryApi.url,
        description: 'Query API Gateway URL',
        exportName: `RagDemo-InfraQueryApi-${config.environment}`,
      });
    }

    // Configuration summary
    new cdk.CfnOutput(this, 'ConfigurationSummary', {
      value: JSON.stringify({
        environment: config.environment,
        region: config.region,
        embeddingModel: config.embeddingModel,
        chunkSize: config.chunkSize,
        vectorDimensions: config.vectorDimensions,
        enableEncryption: config.enableEncryption,
        enableDetailedMonitoring: config.enableDetailedMonitoring,
      }),
      description: 'Infrastructure configuration summary',
    });
  }

  private applyTags(config: Config): void {
    const tags = getCostAllocationTags(config);
    
    // Add infrastructure-specific tags
    const infraTags = {
      ...tags,
      ResourceType: 'Infrastructure',
      StackType: 'Disposable',
      HasVectorDatabase: 'true',
      HasKnowledgeBase: 'true',
      HasMonitoring: 'true',
      EmbeddingModel: config.embeddingModel,
      VectorDimensions: config.vectorDimensions.toString(),
    };
    
    Object.entries(infraTags).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
  }
} 