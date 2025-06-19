import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import { KnowledgeBaseConstruct } from '../constructs/knowledge-base';
import { MonitoringConstruct } from '../constructs/monitoring';
import { VectorDatabaseConstruct } from '../constructs/vector-database';
import { Config } from '../utils/config';
import { getSSMParameterName } from '../utils/helpers';

export interface ApplicationStackProps extends cdk.StackProps {
  config: Config;
  documentsBucket: s3.IBucket;
  backupBucket?: s3.IBucket;
}

/**
 * Application Stack - Contains application components that depend on foundation
 * 
 * This stack contains:
 * - OpenSearch index creation (custom resource)
 * - Bedrock Knowledge Base
 * - Monitoring and dashboards
 * - SSM parameters for frontend
 * - Post-deployment setup tasks
 * 
 * Deploy this stack AFTER FoundationStack completes successfully.
 */
export class ApplicationStack extends cdk.Stack {

  public readonly knowledgeBase: KnowledgeBaseConstruct;
  public readonly monitoring: MonitoringConstruct;
  public readonly knowledgeBaseId: string;
  public readonly collectionEndpoint: string;
  public readonly dashboardsEndpoint: string;

  constructor(scope: Construct, id: string, props: ApplicationStackProps) {
    super(scope, id, props);

    const { config, documentsBucket } = props;

    // Get encryption key from storage stack
    const encryptionKey = this.getEncryptionKeyFromSSM(config);

    // Get notification topic from storage stack
    const notificationTopic = this.getNotificationTopicFromSSM(config);

    // Import foundation infrastructure from FoundationStack
    const foundationConfig = this.getFoundationConfigFromSSM(config);

    // Import IAM roles from FoundationStack
    const knowledgeBaseRole = cdk.aws_iam.Role.fromRoleArn(
      this, 
      'ImportedKnowledgeBaseRole',
      foundationConfig.knowledgeBaseRoleArn
    );

    const indexCreationLambdaRole = cdk.aws_iam.Role.fromRoleArn(
      this,
      'ImportedIndexCreationLambdaRole', 
      foundationConfig.indexCreationLambdaRoleArn
    );

    // Import vector database construct (lightweight - just for references)
    const vectorDatabase = this.createVectorDatabaseReference(foundationConfig, config);

    // Set collection endpoints from foundation
    this.collectionEndpoint = foundationConfig.collectionEndpoint;
    this.dashboardsEndpoint = foundationConfig.dashboardsEndpoint;

    // 1. Create the OpenSearch index before Knowledge Base creation
    const indexCreationCustomResource = this.createIndexCreationResource(config, indexCreationLambdaRole, foundationConfig);

    // 2. Create Knowledge Base with the imported role and vector database reference
    this.knowledgeBase = new KnowledgeBaseConstruct(this, 'KnowledgeBase', {
      config,
      documentsBucket,
      vectorDatabase,
      encryptionKey,
      existingRole: knowledgeBaseRole,
    });

    // Add dependency to ensure index is created first
    this.knowledgeBase.knowledgeBase.node.addDependency(indexCreationCustomResource);

    // Set knowledge base ID
    this.knowledgeBaseId = this.knowledgeBase.knowledgeBaseId;

    // 3. Create comprehensive monitoring
    this.monitoring = new MonitoringConstruct(this, 'Monitoring', {
      config,
      knowledgeBase: this.knowledgeBase,
      vectorDatabase,
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

  private getEncryptionKeyFromSSM(config: Config): kms.IKey | undefined {
    if (!config.enableEncryption) {
      return undefined;
    }

    try {
      const keyId = ssm.StringParameter.valueFromLookup(
        this,
        getSSMParameterName(config, 'encryption-key-id')
      );
      
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

  private getFoundationConfigFromSSM(config: Config): any {
    try {
      const foundationConfigString = ssm.StringParameter.valueFromLookup(
        this,
        getSSMParameterName(config, 'foundation-config')
      );
      
      return JSON.parse(foundationConfigString);
    } catch (error) {
      throw new Error(`Failed to import FoundationStack configuration. Ensure FoundationStack is deployed first: ${error}`);
    }
  }

  private createVectorDatabaseReference(foundationConfig: any, config: Config): VectorDatabaseConstruct {
    // Create a lightweight reference to the vector database for the constructs that need it
    // This doesn't create new resources, just provides the interface needed by other constructs
    const vectorDbConstruct = {
      collection: {
        ref: foundationConfig.collectionId,
        attrCollectionEndpoint: foundationConfig.collectionEndpoint,
        attrDashboardEndpoint: foundationConfig.dashboardsEndpoint,
      },
      collectionEndpoint: foundationConfig.collectionEndpoint,
      dashboardsEndpoint: foundationConfig.dashboardsEndpoint,
      dataAccessPolicy: {
        // Reference existing policy - don't create new one
        ref: foundationConfig.dataAccessPolicyName,
      },
    };

    return vectorDbConstruct as any; // Type assertion for interface compatibility
  }

  private createIndexCreationResource(config: Config, lambdaRole: cdk.aws_iam.Role, foundationConfig: any): cdk.CustomResource {
    // Create Lambda function for index creation with proper CloudFormation response handling
    const indexCreationLambda = new cdk.aws_lambda.Function(this, 'IndexCreationLambda', {
      functionName: `rag-demo-index-creation-${config.environment}-${config.region}`,
      runtime: cdk.aws_lambda.Runtime.PYTHON_3_11,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(15),
      memorySize: 512,
      role: lambdaRole,
      environment: {
        COLLECTION_ENDPOINT: foundationConfig.collectionEndpoint,
        INDEX_NAME: config.indexName,
        VECTOR_DIMENSIONS: config.vectorDimensions.toString(),
        ENVIRONMENT: config.environment,
      },
      code: cdk.aws_lambda.Code.fromInline(`
import json
import boto3
import urllib3
import logging
import time
from typing import Dict, Any

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event: Dict[str, Any], context) -> None:
    """
    Create OpenSearch index before Knowledge Base creation
    Ensures proper CloudFormation response in all cases
    """
    
    # Initialize response variables
    status = 'FAILED'
    reason = 'Unknown error'
    
    try:
        logger.info(f"Index creation event: {json.dumps(event, default=str)}")
        
        request_type = event.get('RequestType', 'Create')
        
        if request_type == 'Create':
            create_opensearch_index()
            status = 'SUCCESS'
            reason = 'OpenSearch index created successfully'
        elif request_type == 'Delete':
            logger.info("Index deletion not required - cleanup handled by collection deletion")
            status = 'SUCCESS'
            reason = 'No action required on delete'
        else:
            status = 'SUCCESS'  # Treat unknown types as success to avoid blocking
            reason = f'No action required for request type: {request_type}'
        
    except Exception as e:
        logger.error(f"Index creation failed: {str(e)}")
        status = 'FAILED'
        reason = str(e)
    
    finally:
        # ALWAYS send response to CloudFormation
        try:
            send_response(event, context, status, {'Reason': reason})
        except Exception as response_error:
            logger.error(f"Failed to send CloudFormation response: {response_error}")
            # Even if response fails, don't raise - Lambda will timeout gracefully

def create_opensearch_index():
    """Create the vector index in OpenSearch Serverless with timeout protection"""
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
    
    # Timeout protection - Reserve 2 minutes for CloudFormation response
    start_time = time.time()
    max_duration = 13 * 60  # 13 minutes out of 15-minute Lambda timeout
    
    def time_remaining():
        return max_duration - (time.time() - start_time)
    
    # Get AWS credentials
    session = boto3.Session()
    credentials = session.get_credentials()
    region = session.region_name or 'us-east-1'
    
    if not credentials:
        raise ValueError("No AWS credentials available")
    
    # Retry logic for data access policy propagation
    max_retries = 5   # Reduced retries to fit in timeout
    base_delay = 90   # Start with 90 seconds (more conservative)
    
    for attempt in range(max_retries):
        # Check if we have enough time left for this attempt
        if time_remaining() < 120:  # Need at least 2 minutes left
            logger.warning(f"⏰ Stopping retries - only {time_remaining():.1f} seconds left")
            raise ValueError(f"Timeout protection: stopped after {attempt} attempts to ensure CloudFormation response")
        
        logger.info(f"🔄 Attempt {attempt + 1}/{max_retries} (⏰ {time_remaining():.1f}s remaining)")
        
        try:
            # First, check if collection is accessible (HEAD request)
            check_url = f"{collection_endpoint}/_cluster/health"
            check_request = AWSRequest(method='HEAD', url=check_url)
            SigV4Auth(credentials, 'aoss', region).add_auth(check_request)
            
            http = urllib3.PoolManager()
            response = http.urlopen('HEAD', check_url, headers=dict(check_request.headers))
            
            if response.status == 200:
                logger.info("✅ Collection is accessible, proceeding with index creation")
            elif response.status == 403:
                # 403 on HEAD request - data access policy not yet effective
                if attempt < max_retries - 1:
                    delay = base_delay + (attempt * 45)  # Linear backoff: 90, 135, 180, 225, 270s
                    
                    # Reduce delay if we're running out of time
                    if time_remaining() < delay + 120:  # Need 2 min buffer
                        delay = max(30, time_remaining() - 120)  # At least 30s, but respect timeout
                        logger.warning(f"⏰ Reducing delay to {delay}s due to time constraints")
                    
                    logger.info(f"Access denied (403). Retrying in {delay} seconds... (attempt {attempt + 1}/{max_retries})")
                    time.sleep(delay)
                    continue
                else:
                    raise ValueError(f"Data access policy not effective after {max_retries} attempts")
            else:
                raise ValueError(f"Unexpected response from collection health check: {response.status}")
            
            # Create index with proper mapping for Bedrock Knowledge Base
            index_url = f"{collection_endpoint}/{index_name}"
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
            
            # Check if index already exists
            check_request = AWSRequest(method='HEAD', url=index_url)
            SigV4Auth(credentials, 'aoss', region).add_auth(check_request)
            
            response = http.urlopen('HEAD', index_url, headers=dict(check_request.headers))
            
            if response.status == 200:
                logger.info(f"✅ Index {index_name} already exists")
                return
            elif response.status == 404:
                logger.info(f"Index {index_name} does not exist, creating...")
            else:
                logger.warning(f"Unexpected response checking index existence: {response.status}")
            
            # Create the index
            create_request = AWSRequest(
                method='PUT',
                url=index_url,
                data=json.dumps(index_mapping).encode('utf-8'),
                headers={'Content-Type': 'application/json'}
            )
            SigV4Auth(credentials, 'aoss', region).add_auth(create_request)
            
            response = http.urlopen(
                'PUT',
                index_url,
                body=json.dumps(index_mapping).encode('utf-8'),
                headers=dict(create_request.headers)
            )
            
            if response.status in [200, 201]:
                logger.info(f"✅ Successfully created index {index_name}")
                return
            elif response.status == 403:
                # 403 on PUT request - data access policy not yet effective
                if attempt < max_retries - 1:
                    delay = base_delay + (attempt * 45)  # Linear backoff: 90, 135, 180, 225, 270s
                    
                    # Reduce delay if we're running out of time
                    if time_remaining() < delay + 120:  # Need 2 min buffer
                        delay = max(30, time_remaining() - 120)  # At least 30s, but respect timeout
                        logger.warning(f"⏰ Reducing delay to {delay}s due to time constraints")
                    
                    logger.info(f"Access denied (403) on index creation. Retrying in {delay} seconds... (attempt {attempt + 1}/{max_retries})")
                    time.sleep(delay)
                    continue
                else:
                    raise ValueError(f"Data access policy not effective for index creation after {max_retries} attempts")
            else:
                response_text = response.data.decode('utf-8') if response.data else 'No response body'
                raise ValueError(f"Failed to create index. Status: {response.status}, Response: {response_text}")
        
        except Exception as e:
            if attempt < max_retries - 1:
                delay = base_delay // 2 + (attempt * 30)  # Shorter linear backoff: 45, 75, 105, 135s
                
                # Reduce delay if we're running out of time
                if time_remaining() < delay + 120:  # Need 2 min buffer
                    delay = max(15, time_remaining() - 120)  # At least 15s, but respect timeout
                    logger.warning(f"⏰ Reducing delay to {delay}s due to time constraints")
                
                logger.warning(f"Error on attempt {attempt + 1}: {str(e)}. Retrying in {delay} seconds...")
                time.sleep(delay)
                continue
            else:
                logger.error(f"Final attempt failed: {str(e)}")
                raise

    raise ValueError(f"Failed to create index after {max_retries} attempts")

def send_response(event, context, status, data, reason=None):
    """Send response to CloudFormation with robust error handling"""
    response_body = {
        'Status': status,
        'Reason': reason or data.get('Reason', f'See CloudWatch Log Stream: {context.log_stream_name}'),
        'PhysicalResourceId': f'opensearch-index-{event.get("LogicalResourceId", "unknown")}',
        'StackId': event['StackId'],
        'RequestId': event['RequestId'],
        'LogicalResourceId': event['LogicalResourceId'],
        'Data': data
    }
    
    json_response = json.dumps(response_body)
    logger.info(f"Sending CloudFormation response: {json_response}")
    
    headers = {
        'content-type': '',
        'content-length': str(len(json_response))
    }
    
    try:
        http = urllib3.PoolManager()
        response = http.request('PUT', event['ResponseURL'], body=json_response, headers=headers)
        logger.info(f"✅ CloudFormation response sent successfully: {response.status}")
    except Exception as e:
        logger.error(f"❌ Failed to send CloudFormation response: {e}")
        # Don't raise - let Lambda timeout gracefully rather than failing immediately
`),
    });

    // Create custom resource
    const customResource = new cdk.CustomResource(this, 'OpenSearchIndexCreation', {
      serviceToken: indexCreationLambda.functionArn,
      properties: {
        // Force update on configuration changes
        IndexName: config.indexName,
        VectorDimensions: config.vectorDimensions,
        CollectionEndpoint: foundationConfig.collectionEndpoint,
        Timestamp: Date.now(), // Force update on every deployment
      },
    });

    return customResource;
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
    // Simplified post-deployment setup - most work is done by index creation Lambda
    const postDeploymentLambda = new cdk.aws_lambda.Function(this, 'PostDeploymentSetup', {
      functionName: `rag-demo-post-deployment-${config.environment}-${config.region}`,
      runtime: cdk.aws_lambda.Runtime.PYTHON_3_11,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(5), // Shorter timeout - just validation
      memorySize: 256,
      environment: {
        KNOWLEDGE_BASE_ID: this.knowledgeBaseId,
        COLLECTION_ENDPOINT: this.collectionEndpoint,
        ENVIRONMENT: config.environment,
      },
      code: cdk.aws_lambda.Code.fromInline(`
import json
import boto3
import logging
from typing import Dict, Any

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    """
    Post-deployment validation and setup
    """
    try:
        logger.info(f"Starting post-deployment setup: {json.dumps(event, default=str)}")
        
        request_type = event.get('RequestType', 'Create')
        
        if request_type == 'Create':
            # Verify Knowledge Base is accessible
            verify_knowledge_base()
            
            # Setup basic monitoring
            setup_basic_monitoring()
            
        elif request_type == 'Delete':
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

def verify_knowledge_base():
    """Verify that the Knowledge Base is accessible"""
    try:
        import os
        bedrock_agent = boto3.client('bedrock-agent')
        
        knowledge_base_id = os.environ['KNOWLEDGE_BASE_ID']
        
        response = bedrock_agent.get_knowledge_base(
            knowledgeBaseId=knowledge_base_id
        )
        
        logger.info(f"✅ Knowledge Base verified: {response['knowledgeBase']['name']}")
        
    except Exception as e:
        logger.error(f"❌ Failed to verify Knowledge Base: {str(e)}")
        raise

def setup_basic_monitoring():
    """Set up basic CloudWatch metrics"""
    try:
        import os
        cloudwatch = boto3.client('cloudwatch')
        environment = os.environ['ENVIRONMENT']
        
        # Put a custom metric to indicate successful deployment
        cloudwatch.put_metric_data(
            Namespace=f'RAG-Demo/{environment}',
            MetricData=[
                {
                    'MetricName': 'DeploymentSuccess',
                    'Value': 1.0,
                    'Unit': 'Count'
                }
            ]
        )
        
        logger.info("✅ Basic monitoring setup completed")
        
    except Exception as e:
        logger.error(f"❌ Failed to setup monitoring: {str(e)}")
        # Don't fail deployment if monitoring setup fails
        pass
`),
    });

    // Grant necessary permissions
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
        'cloudwatch:PutMetricData',
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

    // Ensure custom resource runs after Knowledge Base is created
    customResource.node.addDependency(this.knowledgeBase);
  }

  private createOutputs(config: Config): void {
    // Application stack outputs
    new cdk.CfnOutput(this, 'KnowledgeBaseId', {
      value: this.knowledgeBaseId,
      description: 'Bedrock Knowledge Base ID',
      exportName: `RagDemo-AppKnowledgeBaseId-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'DataSourceId', {
      value: this.knowledgeBase.dataSourceId,
      description: 'Bedrock Data Source ID',
      exportName: `RagDemo-AppDataSourceId-${config.environment}`,
    });

    // Monitoring outputs
    if (this.monitoring.dashboard) {
      new cdk.CfnOutput(this, 'MonitoringDashboardUrl', {
        value: `https://${config.region}.console.aws.amazon.com/cloudwatch/home?region=${config.region}#dashboards:name=${this.monitoring.dashboard.dashboardName}`,
        description: 'CloudWatch Dashboard URL',
        exportName: `RagDemo-AppMonitoringDashboard-${config.environment}`,
      });
    }

    // API outputs
    if (this.monitoring.queryApi) {
      new cdk.CfnOutput(this, 'QueryApiUrl', {
        value: this.monitoring.queryApi.url,
        description: 'Query API Gateway URL',
        exportName: `RagDemo-AppQueryApi-${config.environment}`,
      });
    }

    // Application readiness indicator
    new cdk.CfnOutput(this, 'ApplicationStatus', {
      value: 'READY',
      description: 'Application stack deployment status - READY means system is fully operational',
      exportName: `RagDemo-AppStatus-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'ApplicationTimestamp', {
      value: new Date().toISOString(),
      description: 'Application stack deployment timestamp',
    });
  }

  private applyTags(config: Config): void {
    cdk.Tags.of(this).add('StackType', 'application');
    cdk.Tags.of(this).add('StackPurpose', 'knowledge-base-monitoring');
    cdk.Tags.of(this).add('DeploymentOrder', '3'); // After FoundationStack (2)
    cdk.Tags.of(this).add('Environment', config.environment);
    cdk.Tags.of(this).add('Project', 'RAG-Demo');
    cdk.Tags.of(this).add('Component', 'Infrastructure-Application');
    cdk.Tags.of(this).add('CostCenter', 'engineering');
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
    
    // Add configuration tags
    cdk.Tags.of(this).add('EmbeddingModel', config.embeddingModel);
    cdk.Tags.of(this).add('ChatModel', config.chatModel);
    cdk.Tags.of(this).add('Region', config.region);
  }
} 