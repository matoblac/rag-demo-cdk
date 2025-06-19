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

    // 1. Create Knowledge Base role first (with all permissions including OpenSearch)
    const knowledgeBaseRole = this.createKnowledgeBaseRole(config, documentsBucket, encryptionKey);

    // 2. Create Lambda role for index creation (before vector database)
    const indexCreationLambdaRole = this.createIndexCreationLambdaRole(config);

    // 3. Create Vector Database with both roles included in data access policy
    this.vectorDatabase = new VectorDatabaseConstruct(this, 'VectorDatabase', {
      config,
      knowledgeBaseRole,
      indexCreationLambdaRole, // Include for index creation
    });

    // 4. Create the OpenSearch index before Knowledge Base creation
    const indexCreationCustomResource = this.createIndexCreationResource(config, indexCreationLambdaRole);

    // 5. Create Knowledge Base with the vector database and existing role
    this.knowledgeBase = new KnowledgeBaseConstruct(this, 'KnowledgeBase', {
      config,
      documentsBucket,
      vectorDatabase: this.vectorDatabase,
      encryptionKey,
      existingRole: knowledgeBaseRole,
    });

    // Add dependency to ensure index is created first
    this.knowledgeBase.knowledgeBase.node.addDependency(indexCreationCustomResource);

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

  private createKnowledgeBaseRole(
    config: Config,
    documentsBucket: s3.IBucket,
    encryptionKey?: kms.IKey
  ): cdk.aws_iam.Role {
    const roleName = `RagDemoKnowledgebaseRole${config.environment.charAt(0).toUpperCase() + config.environment.slice(1)}`;

    const role = new cdk.aws_iam.Role(this, 'KnowledgeBaseRole', {
      roleName,
      assumedBy: new cdk.aws_iam.ServicePrincipal('bedrock.amazonaws.com'),
      description: `IAM Role for Bedrock Knowledge Base execution in ${config.environment}`,
    });

    // S3 permissions for the documents bucket
    role.addToPolicy(new cdk.aws_iam.PolicyStatement({
      effect: cdk.aws_iam.Effect.ALLOW,
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
    role.addToPolicy(new cdk.aws_iam.PolicyStatement({
      effect: cdk.aws_iam.Effect.ALLOW,
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

    // KMS permissions if encryption is enabled
    if (encryptionKey) {
      role.addToPolicy(new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
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
    role.addToPolicy(new cdk.aws_iam.PolicyStatement({
      effect: cdk.aws_iam.Effect.ALLOW,
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      resources: [
        `arn:aws:logs:${config.region}:${this.account}:log-group:/aws/bedrock/knowledgebases*`,
      ],
    }));

    // OpenSearch Serverless permissions
    role.addToPolicy(new cdk.aws_iam.PolicyStatement({
      effect: cdk.aws_iam.Effect.ALLOW,
      actions: [
        'aoss:APIAccessAll',
        'aoss:CreateIndex',
        'aoss:DeleteIndex',
        'aoss:UpdateIndex',
        'aoss:DescribeIndex',
        'aoss:ReadDocument',
        'aoss:WriteDocument',
      ],
      resources: [
        `arn:aws:aoss:${config.region}:${this.account}:collection/*`,
        `arn:aws:aoss:${config.region}:${this.account}:index/*/*`,
      ],
    }));

    return role;
  }

  private createIndexCreationLambdaRole(config: Config): cdk.aws_iam.Role {
    const roleName = `RagDemoIndexCreationRole${config.environment.charAt(0).toUpperCase() + config.environment.slice(1)}`;

    const role = new cdk.aws_iam.Role(this, 'IndexCreationLambdaRole', {
      roleName,
      assumedBy: new cdk.aws_iam.ServicePrincipal('lambda.amazonaws.com'),
      description: `IAM Role for OpenSearch index creation Lambda in ${config.environment}`,
      managedPolicies: [
        cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // OpenSearch Serverless permissions for index creation
    role.addToPolicy(new cdk.aws_iam.PolicyStatement({
      effect: cdk.aws_iam.Effect.ALLOW,
      actions: [
        'aoss:APIAccessAll',
        'aoss:CreateIndex',
        'aoss:UpdateIndex',
        'aoss:DescribeIndex',
      ],
      resources: [
        `arn:aws:aoss:${config.region}:${this.account}:collection/*`,
        `arn:aws:aoss:${config.region}:${this.account}:index/*/*`,
      ],
    }));

    return role;
  }

  private createIndexCreationResource(config: Config, lambdaRole: cdk.aws_iam.Role): cdk.CustomResource {
    // Create a custom resource Lambda that creates the OpenSearch index
    const indexCreationLambda = new cdk.aws_lambda.Function(this, 'IndexCreationLambda', {
      functionName: `rag-demo-index-creation-${config.environment}`,
      runtime: cdk.aws_lambda.Runtime.PYTHON_3_11,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(15),
      memorySize: 512,
      role: lambdaRole, // Use the pre-created role
      environment: {
        COLLECTION_ENDPOINT: this.vectorDatabase.collectionEndpoint,
        INDEX_NAME: config.indexName,
        VECTOR_DIMENSIONS: config.vectorDimensions.toString(),
        ENVIRONMENT: config.environment,
      },
      code: cdk.aws_lambda.Code.fromInline(`
import json
import boto3
import logging
import urllib3
from typing import Dict, Any

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event: Dict[str, Any], context) -> None:
    """
    Create OpenSearch index before Knowledge Base creation
    ALWAYS sends response to CloudFormation
    """
    status = 'FAILED'  # Default to FAILED
    reason = 'Unknown error'
    response_data = {}
    
    try:
        logger.info(f"Index creation event: {json.dumps(event, default=str)}")
        
        request_type = event.get('RequestType', 'Create')
        logger.info(f"Processing request type: {request_type}")
        
        if request_type == 'Create':
            logger.info("Starting index creation...")
            create_opensearch_index()
            status = 'SUCCESS'
            reason = 'OpenSearch index created successfully'
            response_data = {'IndexName': event.get('IndexName', 'rag-documents')}
            logger.info("Index creation completed successfully")
            
        elif request_type == 'Delete':
            logger.info("Delete request - no action required")
            status = 'SUCCESS'
            reason = 'Index deletion not required - cleanup handled by collection deletion'
            
        elif request_type == 'Update':
            logger.info("Update request - no action required")
            status = 'SUCCESS'
            reason = 'Index update not required'
            
        else:
            logger.warning(f"Unsupported request type: {request_type}")
            status = 'FAILED'
            reason = f"Unsupported request type: {request_type}"
            
    except Exception as e:
        logger.exception("Handler failed with exception:")
        status = 'FAILED'
        reason = f"Index creation failed: {str(e)}"
        response_data = {'Error': str(e)}
    
    finally:
        # ALWAYS send response to CloudFormation, no matter what happened
        try:
            logger.info(f"Sending CloudFormation response: {status} - {reason}")
            send_response(event, context, status, response_data, reason)
            logger.info("CloudFormation response sent successfully")
        except Exception as response_error:
            logger.critical(f"CRITICAL: Failed to send CloudFormation response: {response_error}")
            # This is the worst case - we can't even respond to CloudFormation
            # The only thing we can do is log and hope the timeout catches it

def send_response(event, context, status, data, reason=None):
    """Send response to CloudFormation - MUST ALWAYS WORK"""
    try:
        response_body = {
            'Status': status,
            'Reason': reason or f'See CloudWatch Log Stream: {context.log_stream_name}',
            'PhysicalResourceId': context.log_stream_name,  # Use log stream name for uniqueness
            'StackId': event['StackId'],
            'RequestId': event['RequestId'],
            'LogicalResourceId': event['LogicalResourceId'],
            'Data': data or {}
        }
        
        json_response = json.dumps(response_body)
        logger.info(f"Sending CloudFormation response: {json_response}")
        
        headers = {
            'content-type': '',
            'content-length': str(len(json_response))
        }
        
        # Create HTTP pool with shorter timeout for the response
        http = urllib3.PoolManager(timeout=urllib3.Timeout(connect=10, read=30))
        
        response = http.request(
            'PUT', 
            event['ResponseURL'], 
            body=json_response, 
            headers=headers,
            retries=3  # Retry the response if it fails
        )
        
        if response.status == 200:
            logger.info("✅ CloudFormation response sent successfully")
        else:
            logger.warning(f"⚠️ CloudFormation response status: {response.status}")
            
    except Exception as e:
        logger.critical(f"💥 CRITICAL: Failed to send CloudFormation response: {str(e)}")
        # If we can't send the response, there's nothing more we can do
        # CloudFormation will timeout and fail the stack

def create_opensearch_index():
    """Create the vector index in OpenSearch Serverless with retry logic and timeout protection"""
    import os
    import json
    import urllib3
    import boto3
    import time
    from botocore.auth import SigV4Auth
    from botocore.awsrequest import AWSRequest
    
    # Get environment variables
    collection_endpoint = os.environ['COLLECTION_ENDPOINT']
    index_name = os.environ['INDEX_NAME']
    vector_dimensions = int(os.environ['VECTOR_DIMENSIONS'])
    
    logger.info(f"Creating index {index_name} at {collection_endpoint} with {vector_dimensions} dimensions")
    
    # Timeout protection - leave 2 minutes buffer for CloudFormation response
    import time
    start_time = time.time()
    max_execution_time = 13 * 60  # 13 minutes (out of 15 minute Lambda timeout)
    
    def time_remaining():
        return max_execution_time - (time.time() - start_time)
    
    logger.info(f"Index creation has {max_execution_time} seconds to complete")
    
    # Get AWS credentials
    session = boto3.Session()
    credentials = session.get_credentials()
    region = session.region_name or 'us-east-1'
    
    if not credentials:
        raise ValueError("No AWS credentials available")
    
    # Create the index mapping
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
    
    # Create HTTP client with timeout
    http = urllib3.PoolManager(timeout=urllib3.Timeout(connect=30, read=60))
    
    # Retry logic for data access policy propagation
    max_retries = 6   # 6 retries over ~10 minutes  
    base_delay = 60   # Start with 60 seconds
    
    for attempt in range(max_retries):
        # Check if we have enough time left for this attempt
        if time_remaining() < 120:  # Need at least 2 minutes left
            logger.warning(f"⏰ Stopping retries - only {time_remaining():.1f} seconds left")
            raise ValueError(f"Timeout protection: stopped after {attempt} attempts to ensure CloudFormation response")
        
        logger.info(f"🔄 Attempt {attempt + 1}/{max_retries} (⏰ {time_remaining():.1f}s remaining)")
        
        try:
            # Check if index exists first
            check_url = f"{collection_endpoint}/{index_name}"
            check_request = AWSRequest(method='HEAD', url=check_url)
            SigV4Auth(credentials, 'aoss', region).add_auth(check_request)
            
            logger.info(f"Attempt {attempt + 1}/{max_retries}: Checking if index exists: {check_url}")
            check_response = http.request(
                check_request.method,
                check_request.url,
                headers=dict(check_request.headers),
                timeout=30
            )
            
            logger.info(f"Index check response: {check_response.status}")
            if check_response.status == 200:
                logger.info(f"Index {index_name} already exists")
                return
            elif check_response.status == 403:
                                 # 403 on HEAD request - data access policy not yet effective
                 if attempt < max_retries - 1:
                     delay = base_delay + (attempt * 30)  # Linear backoff: 60, 90, 120, 150, 180, 210s
                     
                     # Reduce delay if we're running out of time
                     if time_remaining() < delay + 120:  # Need 2 min buffer
                         delay = max(30, time_remaining() - 120)  # At least 30s, but respect timeout
                         logger.warning(f"⏰ Reducing delay to {delay}s due to time constraints")
                     
                     logger.info(f"Access denied (403). Retrying in {delay} seconds... (attempt {attempt + 1}/{max_retries})")
                     time.sleep(delay)
                     continue
                else:
                    raise ValueError(f"Access denied after {max_retries} attempts. Data access policy may not include Lambda role.")
            
            # Try to create the index
            create_url = f"{collection_endpoint}/{index_name}"
            create_request = AWSRequest(
                method='PUT',
                url=create_url,
                data=json.dumps(index_mapping),
                headers={'Content-Type': 'application/json'}
            )
            SigV4Auth(credentials, 'aoss', region).add_auth(create_request)
            
            logger.info(f"Attempt {attempt + 1}/{max_retries}: Creating index: {create_url}")
            response = http.request(
                create_request.method,
                create_request.url,
                body=create_request.body,
                headers=dict(create_request.headers),
                timeout=60
            )
            
            logger.info(f"Index creation response: {response.status}, {response.data}")
            if response.status in [200, 201]:
                logger.info(f"Successfully created index {index_name}")
                return
            elif response.status == 403:
                                 # 403 on PUT request - data access policy not yet effective
                 if attempt < max_retries - 1:
                     delay = base_delay + (attempt * 30)  # Linear backoff: 60, 90, 120, 150, 180, 210s
                     
                     # Reduce delay if we're running out of time
                     if time_remaining() < delay + 120:  # Need 2 min buffer
                         delay = max(30, time_remaining() - 120)  # At least 30s, but respect timeout
                         logger.warning(f"⏰ Reducing delay to {delay}s due to time constraints")
                     
                     logger.info(f"Access denied (403) on index creation. Retrying in {delay} seconds... (attempt {attempt + 1}/{max_retries})")
                     time.sleep(delay)
                     continue
                else:
                    raise ValueError(f"Access denied after {max_retries} attempts. Data access policy may not include Lambda role.")
            else:
                error_msg = f"Failed to create index. Status: {response.status}, Response: {response.data.decode('utf-8') if response.data else 'No response body'}"
                logger.error(error_msg)
                raise ValueError(error_msg)
                
        except ValueError:
            # Re-raise ValueError (our custom errors)
            raise
                 except Exception as e:
             if attempt < max_retries - 1:
                 delay = base_delay // 2 + (attempt * 15)  # Shorter linear backoff: 30, 45, 60, 75, 90s
                 
                 # Reduce delay if we're running out of time
                 if time_remaining() < delay + 120:  # Need 2 min buffer
                     delay = max(15, time_remaining() - 120)  # At least 15s, but respect timeout
                     logger.warning(f"⏰ Reducing delay to {delay}s due to time constraints")
                 
                 logger.warning(f"Error on attempt {attempt + 1}: {str(e)}. Retrying in {delay} seconds...")
                 time.sleep(delay)
                 continue
            else:
                logger.error(f"Failed to create OpenSearch index after {max_retries} attempts: {str(e)}")
                raise
`),
    });

    // No need for additional IAM policies or data access policy updates
    // The role already has the necessary permissions and is included in the data access policy

    // Create the custom resource
    const customResource = new cdk.CustomResource(this, 'OpenSearchIndexCreation', {
      serviceToken: indexCreationLambda.functionArn,
      properties: {
        IndexName: config.indexName,
        VectorDimensions: config.vectorDimensions,
        CollectionEndpoint: this.vectorDatabase.collectionEndpoint,
        Timestamp: Date.now(), // Force update on redeployment
      },
    });

    // Ensure the custom resource runs after the vector database is ready
    customResource.node.addDependency(this.vectorDatabase.collection);
    customResource.node.addDependency(this.vectorDatabase.dataAccessPolicy);

    return customResource;
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