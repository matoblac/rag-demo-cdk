import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { Config } from '../utils/config';
import { KnowledgeBaseConstruct } from './knowledge-base';
import { VectorDatabaseConstruct } from './vector-database';
import { 
  generateResourceName,
  generateTags,
  getRemovalPolicy,
  getSSMParameterName,
  createResourceDescription,
  generateAlarmName,
  generateLambdaFunctionName,
  formatLogGroupName,
  getTimeoutConfiguration,
  validateAndFormatEmail
} from '../utils/helpers';

export interface MonitoringProps {
  config: Config;
  knowledgeBase: KnowledgeBaseConstruct;
  vectorDatabase: VectorDatabaseConstruct;
  documentsBucket: s3.IBucket;
  notificationTopic?: sns.ITopic;
}

export class MonitoringConstruct extends Construct {
  public readonly dashboard: cloudwatch.Dashboard;
  public readonly alarmTopic: sns.Topic;
  public readonly queryApi?: apigateway.RestApi;
  public readonly queryLambda: lambda.Function;
  public readonly analyticsLambda: lambda.Function;

  constructor(scope: Construct, id: string, props: MonitoringProps) {
    super(scope, id);

    const { config, knowledgeBase, vectorDatabase, documentsBucket, notificationTopic } = props;

    // Create alarm notification topic
    this.alarmTopic = this.createAlarmTopic(config);

    // Create monitoring Lambda functions
    this.queryLambda = this.createQueryLambda(config, knowledgeBase);
    this.analyticsLambda = this.createAnalyticsLambda(config);

    // Create API Gateway for queries
    if (config.environment !== 'dev') {
      this.queryApi = this.createQueryApi(config);
    }

    // Create CloudWatch dashboard
    this.dashboard = this.createDashboard(config, knowledgeBase, vectorDatabase, documentsBucket);

    // Create alarms
    this.createAlarms(config, knowledgeBase, vectorDatabase, documentsBucket);

    // Create custom metrics
    this.setupCustomMetrics(config);

    // Create SSM parameters
    this.createSSMParameters(config);

    // Apply tags
    this.applyTags(config);
  }

  private createAlarmTopic(config: Config): sns.Topic {
    const topicName = generateResourceName(config, 'alarms');
    
    const topic = new sns.Topic(this, 'AlarmTopic', {
      topicName,
      displayName: `RAG Demo Alarms - ${config.environment}`,
    });

    // Add email subscription if configured
    const alertEmail = validateAndFormatEmail(config.alertEmail);
    if (alertEmail) {
      topic.addSubscription(new snsSubscriptions.EmailSubscription(alertEmail));
    }

    return topic;
  }

  private createQueryLambda(config: Config, knowledgeBase: KnowledgeBaseConstruct): lambda.Function {
    const functionName = generateLambdaFunctionName(config, 'query-handler');
    const logGroupName = formatLogGroupName(config, 'query-handler');
    const timeouts = getTimeoutConfiguration(config);

    // Create log group
    const logGroup = new logs.LogGroup(this, 'QueryLambdaLogGroup', {
      logGroupName,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: getRemovalPolicy(config, 'infrastructure'),
    });

    const queryFunction = new lambda.Function(this, 'QueryLambda', {
      functionName,
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'index.handler',
      timeout: timeouts.queryTimeout,
      memorySize: 1024,
      environment: {
        KNOWLEDGE_BASE_ID: knowledgeBase.knowledgeBaseId,
        ENVIRONMENT: config.environment,
        LOG_LEVEL: config.environment === 'prod' ? 'INFO' : 'DEBUG',
        MAX_TOKENS: config.maxTokens.toString(),
        EMBEDDING_MODEL: config.embeddingModel,
      },
      code: lambda.Code.fromInline(`
import json
import boto3
import logging
import os
import uuid
from typing import Dict, Any, List
from datetime import datetime

# Set up logging
log_level = os.environ.get('LOG_LEVEL', 'INFO')
logging.basicConfig(level=getattr(logging, log_level))
logger = logging.getLogger(__name__)

bedrock_agent_runtime = boto3.client('bedrock-agent-runtime')
bedrock_runtime = boto3.client('bedrock-runtime')
cloudwatch = boto3.client('cloudwatch')

def handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    """
    Handle Knowledge Base queries with comprehensive monitoring
    """
    start_time = datetime.utcnow()
    
    try:
        logger.info(f"Query event: {json.dumps(event, default=str)}")
        
        # Parse request
        if 'body' in event:
            # API Gateway request
            body = json.loads(event['body']) if isinstance(event['body'], str) else event['body']
        else:
            # Direct Lambda invocation
            body = event
            
        query = body.get('query', '').strip()
        if not query:
            return create_error_response(400, "Query is required")
            
        # Additional parameters
        max_results = body.get('max_results', 5)
        model_id = body.get('model_id', 'anthropic.claude-3-5-sonnet-20240620-v1:0')
        temperature = body.get('temperature', 0.7)
        
        # Query the Knowledge Base
        kb_response = query_knowledge_base(query, max_results)
        
        # Generate response using retrieved context
        response = generate_response(query, kb_response, model_id, temperature)
        
        # Calculate metrics
        end_time = datetime.utcnow()
        duration = (end_time - start_time).total_seconds()
        
        # Publish metrics
        publish_query_metrics(query, kb_response, duration)
        
        # Format response
        result = {
            'query': query,
            'response': response,
            'sources': extract_sources(kb_response),
            'metadata': {
                'duration_seconds': duration,
                'timestamp': end_time.isoformat(),
                'model_id': model_id,
                'knowledge_base_results': len(kb_response.get('retrievalResults', [])),
            }
        }
        
        logger.info(f"Query completed successfully in {duration:.2f}s")
        
        return create_success_response(result)
        
    except Exception as e:
        logger.error(f"Query failed: {str(e)}", exc_info=True)
        
        # Publish error metrics
        publish_error_metrics(str(e))
        
        return create_error_response(500, f"Query failed: {str(e)}")

def query_knowledge_base(query: str, max_results: int) -> Dict[str, Any]:
    """Query the Bedrock Knowledge Base"""
    knowledge_base_id = os.environ['KNOWLEDGE_BASE_ID']
    
    response = bedrock_agent_runtime.retrieve(
        knowledgeBaseId=knowledge_base_id,
        retrievalQuery={
            'text': query
        },
        retrievalConfiguration={
            'vectorSearchConfiguration': {
                'numberOfResults': max_results,
                'overrideSearchType': 'HYBRID'  # Use both semantic and keyword search
            }
        }
    )
    
    return response

def generate_response(query: str, kb_response: Dict[str, Any], model_id: str, temperature: float) -> str:
    """Generate response using retrieved context"""
    
    # Extract context from KB results
    contexts = []
    for result in kb_response.get('retrievalResults', []):
        content = result.get('content', {}).get('text', '')
        if content:
            contexts.append(content)
    
    if not contexts:
        return "I couldn't find relevant information in the knowledge base to answer your question."
    
    # Create prompt with context
    context_text = "\\n\\n".join(contexts[:3])  # Use top 3 results
    
    prompt = f"""Based on the following context, please answer the question. If the context doesn't contain enough information to answer the question, please say so.

Context:
{context_text}

Question: {query}

Answer:"""

    # Call Bedrock model
    request_body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": int(os.environ.get('MAX_TOKENS', '4096')),
        "temperature": temperature,
        "messages": [
            {
                "role": "user",
                "content": prompt
            }
        ]
    }
    
    response = bedrock_runtime.invoke_model(
        modelId=model_id,
        body=json.dumps(request_body)
    )
    
    response_body = json.loads(response['body'].read())
    return response_body.get('content', [{}])[0].get('text', 'No response generated')

def extract_sources(kb_response: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Extract source information from KB response"""
    sources = []
    
    for result in kb_response.get('retrievalResults', []):
        location = result.get('location', {})
        if location.get('type') == 'S3':
            s3_location = location.get('s3Location', {})
            sources.append({
                'source': s3_location.get('uri', 'Unknown'),
                'score': result.get('score', 0),
                'content_snippet': result.get('content', {}).get('text', '')[:200] + '...'
            })
    
    return sources

def publish_query_metrics(query: str, kb_response: Dict[str, Any], duration: float):
    """Publish CloudWatch metrics"""
    namespace = f"RAG-Demo/{os.environ['ENVIRONMENT']}"
    
    metrics = [
        {
            'MetricName': 'QueryCount',
            'Value': 1,
            'Unit': 'Count',
        },
        {
            'MetricName': 'QueryDuration',
            'Value': duration,
            'Unit': 'Seconds',
        },
        {
            'MetricName': 'KnowledgeBaseResults',
            'Value': len(kb_response.get('retrievalResults', [])),
            'Unit': 'Count',
        }
    ]
    
    cloudwatch.put_metric_data(
        Namespace=namespace,
        MetricData=metrics
    )

def publish_error_metrics(error_message: str):
    """Publish error metrics"""
    namespace = f"RAG-Demo/{os.environ['ENVIRONMENT']}"
    
    cloudwatch.put_metric_data(
        Namespace=namespace,
        MetricData=[
            {
                'MetricName': 'QueryErrors',
                'Value': 1,
                'Unit': 'Count',
            }
        ]
    )

def create_success_response(data: Dict[str, Any]) -> Dict[str, Any]:
    """Create successful API response"""
    return {
        'statusCode': 200,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
        'body': json.dumps(data, default=str)
    }

def create_error_response(status_code: int, message: str) -> Dict[str, Any]:
    """Create error API response"""
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
        'body': json.dumps({
            'error': message,
            'timestamp': datetime.utcnow().isoformat()
        })
    }
`),
    });

    // Add permissions for Bedrock and CloudWatch
    queryFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:Retrieve',
        'bedrock:InvokeModel',
      ],
      resources: [
        `arn:aws:bedrock:${config.region}:${cdk.Stack.of(this).account}:knowledge-base/${knowledgeBase.knowledgeBaseId}`,
        `arn:aws:bedrock:${config.region}::foundation-model/*`,
      ],
    }));

    queryFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'cloudwatch:PutMetricData',
      ],
      resources: ['*'],
    }));

    return queryFunction;
  }

  private createAnalyticsLambda(config: Config): lambda.Function {
    const functionName = generateLambdaFunctionName(config, 'analytics');
    const logGroupName = formatLogGroupName(config, 'analytics');
    const timeouts = getTimeoutConfiguration(config);

    // Create log group
    const logGroup = new logs.LogGroup(this, 'AnalyticsLambdaLogGroup', {
      logGroupName,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: getRemovalPolicy(config, 'infrastructure'),
    });

    const analyticsFunction = new lambda.Function(this, 'AnalyticsLambda', {
      functionName,
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'index.handler',
      timeout: timeouts.lambdaTimeout,
      memorySize: 512,
      environment: {
        ENVIRONMENT: config.environment,
        LOG_LEVEL: config.environment === 'prod' ? 'INFO' : 'DEBUG',
      },
      code: lambda.Code.fromInline(`
import json
import boto3
import logging
import os
from typing import Dict, Any
from datetime import datetime, timedelta

# Set up logging
log_level = os.environ.get('LOG_LEVEL', 'INFO')
logging.basicConfig(level=getattr(logging, log_level))
logger = logging.getLogger(__name__)

cloudwatch = boto3.client('cloudwatch')

def handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    """
    Generate analytics and insights from RAG system usage
    """
    try:
        logger.info("Starting analytics generation")
        
        environment = os.environ['ENVIRONMENT']
        namespace = f"RAG-Demo/{environment}"
        
        # Get time range (last 24 hours by default)
        end_time = datetime.utcnow()
        start_time = end_time - timedelta(hours=24)
        
        # Collect metrics
        analytics = {
            'timeRange': {
                'start': start_time.isoformat(),
                'end': end_time.isoformat()
            },
            'queries': get_query_metrics(namespace, start_time, end_time),
            'ingestion': get_ingestion_metrics(namespace, start_time, end_time),
            'errors': get_error_metrics(namespace, start_time, end_time),
            'performance': get_performance_metrics(namespace, start_time, end_time),
        }
        
        # Calculate insights
        insights = calculate_insights(analytics)
        
        # Publish aggregated metrics
        publish_analytics_metrics(analytics, insights)
        
        result = {
            'analytics': analytics,
            'insights': insights,
            'timestamp': end_time.isoformat()
        }
        
        logger.info("Analytics generation completed")
        return {
            'statusCode': 200,
            'body': json.dumps(result, default=str)
        }
        
    except Exception as e:
        logger.error(f"Analytics generation failed: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }

def get_query_metrics(namespace: str, start_time: datetime, end_time: datetime) -> Dict[str, Any]:
    """Get query-related metrics"""
    try:
        response = cloudwatch.get_metric_statistics(
            Namespace=namespace,
            MetricName='QueryCount',
            StartTime=start_time,
            EndTime=end_time,
            Period=3600,  # 1 hour periods
            Statistics=['Sum']
        )
        
        total_queries = sum(point['Sum'] for point in response['Datapoints'])
        
        # Get average duration
        duration_response = cloudwatch.get_metric_statistics(
            Namespace=namespace,
            MetricName='QueryDuration',
            StartTime=start_time,
            EndTime=end_time,
            Period=3600,
            Statistics=['Average']
        )
        
        avg_duration = sum(point['Average'] for point in duration_response['Datapoints']) / len(duration_response['Datapoints']) if duration_response['Datapoints'] else 0
        
        return {
            'totalQueries': int(total_queries),
            'averageDuration': round(avg_duration, 2),
            'hourlyBreakdown': response['Datapoints']
        }
        
    except Exception as e:
        logger.error(f"Failed to get query metrics: {str(e)}")
        return {'totalQueries': 0, 'averageDuration': 0, 'hourlyBreakdown': []}

def get_ingestion_metrics(namespace: str, start_time: datetime, end_time: datetime) -> Dict[str, Any]:
    """Get ingestion-related metrics"""
    try:
        metrics = {}
        for status in ['COMPLETE', 'FAILED', 'IN_PROGRESS']:
            response = cloudwatch.get_metric_statistics(
                Namespace=namespace,
                MetricName=f'IngestionJobs_{status}',
                StartTime=start_time,
                EndTime=end_time,
                Period=3600,
                Statistics=['Sum']
            )
            
            total = sum(point['Sum'] for point in response['Datapoints'])
            metrics[status.lower()] = int(total)
        
        return metrics
        
    except Exception as e:
        logger.error(f"Failed to get ingestion metrics: {str(e)}")
        return {'complete': 0, 'failed': 0, 'in_progress': 0}

def get_error_metrics(namespace: str, start_time: datetime, end_time: datetime) -> Dict[str, Any]:
    """Get error-related metrics"""
    try:
        response = cloudwatch.get_metric_statistics(
            Namespace=namespace,
            MetricName='QueryErrors',
            StartTime=start_time,
            EndTime=end_time,
            Period=3600,
            Statistics=['Sum']
        )
        
        total_errors = sum(point['Sum'] for point in response['Datapoints'])
        
        return {
            'totalErrors': int(total_errors),
            'hourlyBreakdown': response['Datapoints']
        }
        
    except Exception as e:
        logger.error(f"Failed to get error metrics: {str(e)}")
        return {'totalErrors': 0, 'hourlyBreakdown': []}

def get_performance_metrics(namespace: str, start_time: datetime, end_time: datetime) -> Dict[str, Any]:
    """Get performance-related metrics"""
    try:
        # Knowledge Base results count
        results_response = cloudwatch.get_metric_statistics(
            Namespace=namespace,
            MetricName='KnowledgeBaseResults',
            StartTime=start_time,
            EndTime=end_time,
            Period=3600,
            Statistics=['Average']
        )
        
        avg_results = sum(point['Average'] for point in results_response['Datapoints']) / len(results_response['Datapoints']) if results_response['Datapoints'] else 0
        
        return {
            'averageKnowledgeBaseResults': round(avg_results, 1)
        }
        
    except Exception as e:
        logger.error(f"Failed to get performance metrics: {str(e)}")
        return {'averageKnowledgeBaseResults': 0}

def calculate_insights(analytics: Dict[str, Any]) -> Dict[str, Any]:
    """Calculate insights from analytics data"""
    insights = []
    
    # Query volume insights
    total_queries = analytics['queries']['totalQueries']
    if total_queries > 100:
        insights.append({
            'type': 'high_usage',
            'message': f'High query volume detected: {total_queries} queries in 24 hours'
        })
    elif total_queries == 0:
        insights.append({
            'type': 'no_usage',
            'message': 'No queries detected in the last 24 hours'
        })
    
    # Performance insights
    avg_duration = analytics['queries']['averageDuration']
    if avg_duration > 5:  # 5 seconds
        insights.append({
            'type': 'slow_queries',
            'message': f'Queries are running slower than expected: {avg_duration}s average'
        })
    
    # Error rate insights
    total_errors = analytics['errors']['totalErrors']
    if total_queries > 0:
        error_rate = (total_errors / total_queries) * 100
        if error_rate > 5:  # 5% error rate
            insights.append({
                'type': 'high_error_rate',
                'message': f'High error rate detected: {error_rate:.1f}%'
            })
    
    # Ingestion insights
    failed_ingestions = analytics['ingestion']['failed']
    if failed_ingestions > 0:
        insights.append({
            'type': 'ingestion_failures',
            'message': f'{failed_ingestions} ingestion jobs failed in the last 24 hours'
        })
    
    return {
        'insights': insights,
        'healthScore': calculate_health_score(analytics)
    }

def calculate_health_score(analytics: Dict[str, Any]) -> int:
    """Calculate overall system health score (0-100)"""
    score = 100
    
    # Deduct for errors
    total_queries = analytics['queries']['totalQueries']
    total_errors = analytics['errors']['totalErrors']
    
    if total_queries > 0:
        error_rate = (total_errors / total_queries) * 100
        score -= min(error_rate * 2, 30)  # Max 30 points deduction for errors
    
    # Deduct for slow performance
    avg_duration = analytics['queries']['averageDuration']
    if avg_duration > 3:  # 3 seconds threshold
        score -= min((avg_duration - 3) * 5, 20)  # Max 20 points deduction
    
    # Deduct for ingestion failures
    failed_ingestions = analytics['ingestion']['failed']
    score -= min(failed_ingestions * 5, 20)  # Max 20 points deduction
    
    return max(int(score), 0)

def publish_analytics_metrics(analytics: Dict[str, Any], insights: Dict[str, Any]):
    """Publish aggregated metrics to CloudWatch"""
    namespace = f"RAG-Demo/{os.environ['ENVIRONMENT']}"
    
    metrics = [
        {
            'MetricName': 'HealthScore',
            'Value': insights['healthScore'],
            'Unit': 'Percent',
        },
        {
            'MetricName': 'TotalQueries24h',
            'Value': analytics['queries']['totalQueries'],
            'Unit': 'Count',
        },
        {
            'MetricName': 'AverageQueryDuration',
            'Value': analytics['queries']['averageDuration'],
            'Unit': 'Seconds',
        }
    ]
    
    cloudwatch.put_metric_data(
        Namespace=namespace,
        MetricData=metrics
    )
`),
    });

    // Add CloudWatch permissions
    analyticsFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'cloudwatch:GetMetricStatistics',
        'cloudwatch:PutMetricData',
      ],
      resources: ['*'],
    }));

    // Schedule analytics function to run every hour
    const analyticsRule = new cdk.aws_events.Rule(this, 'AnalyticsSchedule', {
      schedule: cdk.aws_events.Schedule.rate(cdk.Duration.hours(1)),
    });

    analyticsRule.addTarget(new cdk.aws_events_targets.LambdaFunction(analyticsFunction));

    return analyticsFunction;
  }

  private createQueryApi(config: Config): apigateway.RestApi {
    const apiName = generateResourceName(config, 'query-api');

    const api = new apigateway.RestApi(this, 'QueryApi', {
      restApiName: apiName,
      description: createResourceDescription(config, 'Query API', 'RAG Knowledge Base queries'),
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
      },
    });

    // Create query resource
    const queryResource = api.root.addResource('query');
    
    const integration = new apigateway.LambdaIntegration(this.queryLambda, {
      requestTemplates: { 'application/json': '{ "statusCode": "200" }' },
    });

    queryResource.addMethod('POST', integration, {
      apiKeyRequired: config.environment === 'prod',
    });

    // Create usage plan for production
    if (config.environment === 'prod') {
      const apiKey = api.addApiKey('QueryApiKey', {
        apiKeyName: `${apiName}-key`,
      });

      const usagePlan = api.addUsagePlan('QueryUsagePlan', {
        name: `${apiName}-usage-plan`,
        throttle: {
          rateLimit: 100,
          burstLimit: 200,
        },
        quota: {
          limit: 10000,
          period: apigateway.Period.MONTH,
        },
      });

      usagePlan.addApiKey(apiKey);
      usagePlan.addApiStage({
        stage: api.deploymentStage,
      });
    }

    return api;
  }

  private createDashboard(
    config: Config,
    knowledgeBase: KnowledgeBaseConstruct,
    vectorDatabase: VectorDatabaseConstruct,
    documentsBucket: s3.IBucket
  ): cloudwatch.Dashboard {
    const dashboardName = generateResourceName(config, 'dashboard');
    const namespace = `RAG-Demo/${config.environment}`;

    const dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName,
    });

    // Query metrics widgets
    const queryCountWidget = new cloudwatch.GraphWidget({
      title: 'Query Volume',
      left: [
        new cloudwatch.Metric({
          namespace,
          metricName: 'QueryCount',
          statistic: 'Sum',
        }),
      ],
      width: 12,
      height: 6,
    });

    const queryDurationWidget = new cloudwatch.GraphWidget({
      title: 'Query Performance',
      left: [
        new cloudwatch.Metric({
          namespace,
          metricName: 'QueryDuration',
          statistic: 'Average',
        }),
      ],
      width: 12,
      height: 6,
    });

    // Ingestion metrics widgets
    const ingestionWidget = new cloudwatch.GraphWidget({
      title: 'Ingestion Jobs',
      left: [
        new cloudwatch.Metric({
          namespace,
          metricName: 'IngestionJobs_COMPLETE',
          statistic: 'Sum',
          label: 'Completed',
        }),
        new cloudwatch.Metric({
          namespace,
          metricName: 'IngestionJobs_FAILED',
          statistic: 'Sum',
          label: 'Failed',
        }),
        new cloudwatch.Metric({
          namespace,
          metricName: 'IngestionJobs_IN_PROGRESS',
          statistic: 'Sum',
          label: 'In Progress',
        }),
      ],
      width: 12,
      height: 6,
    });

    // Error metrics widget
    const errorWidget = new cloudwatch.GraphWidget({
      title: 'Errors',
      left: [
        new cloudwatch.Metric({
          namespace,
          metricName: 'QueryErrors',
          statistic: 'Sum',
        }),
      ],
      width: 12,
      height: 6,
    });

    // Health score widget
    const healthWidget = new cloudwatch.SingleValueWidget({
      title: 'System Health Score',
      metrics: [
        new cloudwatch.Metric({
          namespace,
          metricName: 'HealthScore',
          statistic: 'Average',
        }),
      ],
      width: 6,
      height: 6,
    });

    // S3 bucket metrics widget
    const s3Widget = new cloudwatch.GraphWidget({
      title: 'Document Storage',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/S3',
          metricName: 'NumberOfObjects',
          dimensionsMap: {
            BucketName: documentsBucket.bucketName,
            StorageType: 'AllStorageTypes',
          },
          statistic: 'Average',
        }),
      ],
      width: 12,
      height: 6,
    });

    // Lambda function metrics
    const lambdaWidget = new cloudwatch.GraphWidget({
      title: 'Lambda Performance',
      left: [
        new cloudwatch.Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Duration',
          dimensionsMap: {
            FunctionName: this.queryLambda.functionName,
          },
          statistic: 'Average',
        }),
      ],
      right: [
        new cloudwatch.Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Errors',
          dimensionsMap: {
            FunctionName: this.queryLambda.functionName,
          },
          statistic: 'Sum',
        }),
      ],
      width: 12,
      height: 6,
    });

    // Add widgets to dashboard
    dashboard.addWidgets(
      queryCountWidget,
      queryDurationWidget,
      ingestionWidget,
      errorWidget,
      healthWidget,
      s3Widget,
      lambdaWidget
    );

    return dashboard;
  }

  private createAlarms(
    config: Config,
    knowledgeBase: KnowledgeBaseConstruct,
    vectorDatabase: VectorDatabaseConstruct,
    documentsBucket: s3.IBucket
  ): void {
    const namespace = `RAG-Demo/${config.environment}`;

    // High error rate alarm
    const errorAlarm = new cloudwatch.Alarm(this, 'HighErrorRateAlarm', {
      alarmName: generateAlarmName(config, 'high-error-rate', 'queries'),
      alarmDescription: 'Alarm when query error rate is high',
      metric: new cloudwatch.Metric({
        namespace,
        metricName: 'QueryErrors',
        statistic: 'Sum',
      }),
      threshold: 10,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    errorAlarm.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(this.alarmTopic));

    // Slow query alarm
    const slowQueryAlarm = new cloudwatch.Alarm(this, 'SlowQueryAlarm', {
      alarmName: generateAlarmName(config, 'slow-queries', 'performance'),
      alarmDescription: 'Alarm when queries are running slowly',
      metric: new cloudwatch.Metric({
        namespace,
        metricName: 'QueryDuration',
        statistic: 'Average',
      }),
      threshold: 10, // 10 seconds
      evaluationPeriods: 3,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    slowQueryAlarm.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(this.alarmTopic));

    // Lambda error alarm
    const lambdaErrorAlarm = new cloudwatch.Alarm(this, 'LambdaErrorAlarm', {
      alarmName: generateAlarmName(config, 'lambda-errors', 'infrastructure'),
      alarmDescription: 'Alarm when Lambda functions are failing',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Errors',
        dimensionsMap: {
          FunctionName: this.queryLambda.functionName,
        },
        statistic: 'Sum',
      }),
      threshold: 5,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    lambdaErrorAlarm.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(this.alarmTopic));

    // Health score alarm
    const healthAlarm = new cloudwatch.Alarm(this, 'LowHealthScoreAlarm', {
      alarmName: generateAlarmName(config, 'low-health-score', 'system'),
      alarmDescription: 'Alarm when system health score is low',
      metric: new cloudwatch.Metric({
        namespace,
        metricName: 'HealthScore',
        statistic: 'Average',
      }),
      threshold: 70,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    healthAlarm.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(this.alarmTopic));
  }

  private setupCustomMetrics(config: Config): void {
    // Custom metrics are published by the Lambda functions
    // This method can be extended to set up additional metric filters or custom metrics
    
    // Create custom metric filter for log-based metrics using the actual Lambda log group
    // Note: Lambda functions automatically create their log groups, so we reference the existing one
    new logs.MetricFilter(this, 'SuccessfulQueriesFilter', {
      logGroup: this.queryLambda.logGroup,
      metricNamespace: `RAG-Demo/${config.environment}`,
      metricName: 'SuccessfulQueries',
      filterPattern: logs.FilterPattern.literal('[timestamp, level="INFO", ..., message="Query completed successfully*"]'),
      metricValue: '1',
    });
  }

  private createSSMParameters(config: Config): void {
    new ssm.StringParameter(this, 'DashboardNameParameter', {
      parameterName: getSSMParameterName(config, 'dashboard-name'),
      stringValue: this.dashboard.dashboardName,
      description: 'CloudWatch Dashboard name for monitoring',
    });

    new ssm.StringParameter(this, 'QueryLambdaArnParameter', {
      parameterName: getSSMParameterName(config, 'query-lambda-arn'),
      stringValue: this.queryLambda.functionArn,
      description: 'Query Lambda function ARN',
    });

    if (this.queryApi) {
      new ssm.StringParameter(this, 'QueryApiUrlParameter', {
        parameterName: getSSMParameterName(config, 'query-api-url'),
        stringValue: this.queryApi.url,
        description: 'Query API Gateway URL',
      });
    }
  }

  private applyTags(config: Config): void {
    const tags = generateTags(config, {
      ResourceType: 'Monitoring',
      Service: 'CloudWatch',
    });
    
    Object.entries(tags).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
  }
} 