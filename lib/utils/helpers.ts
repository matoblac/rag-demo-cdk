import * as cdk from 'aws-cdk-lib';
import { IConstruct } from 'constructs';
import { Config } from './config';

/**
 * Generate consistent resource names across the application
 */
export function generateResourceName(config: Config, resourceType: string, suffix?: string): string {
  const parts = ['rag-demo', resourceType, config.environment];
  if (suffix) {
    parts.push(suffix);
  }
  return parts.join('-');
}

/**
 * Generate tags for all resources
 */
export function generateTags(config: Config, additionalTags?: Record<string, string>): Record<string, string> {
  return {
    Project: 'RAG-Demo',
    Environment: config.environment,
    CostCenter: 'engineering',
    ManagedBy: 'CDK',
    Region: config.region,
    ...additionalTags,
  };
}

/**
 * Create standardized removal policy based on environment and resource type
 */
export function getRemovalPolicy(config: Config, resourceType: 'storage' | 'infrastructure'): cdk.RemovalPolicy {
  if (resourceType === 'storage') {
    // Storage resources should be retained in all environments
    return cdk.RemovalPolicy.RETAIN;
  }
  
  // Infrastructure resources can be destroyed in dev, retained in prod
  switch (config.environment) {
    case 'dev':
      return cdk.RemovalPolicy.DESTROY;
    case 'staging':
      return cdk.RemovalPolicy.RETAIN;
    case 'prod':
      return cdk.RemovalPolicy.RETAIN;
    default:
      return cdk.RemovalPolicy.RETAIN;
  }
}

/**
 * Generate bucket name with proper formatting and uniqueness
 */
export function generateBucketName(config: Config, bucketType: string): string {
  // S3 bucket names must be globally unique and follow specific naming rules
  const timestamp = Date.now();
  const hash = Math.random().toString(36).substring(2, 8);
  return `rag-demo-${bucketType}-${config.environment}-${config.region}-${hash}`.toLowerCase();
}

/**
 * Create standardized SSM parameter name
 */
export function getSSMParameterName(config: Config, parameterName: string): string {
  return `/rag-demo/${config.environment}/${parameterName}`;
}

/**
 * Validate AWS region format
 */
export function validateRegion(region: string): boolean {
  const regionPattern = /^[a-z]{2}-[a-z]+-\d{1}$/;
  return regionPattern.test(region);
}

/**
 * Get supported Bedrock regions
 */
export function getSupportedBedrockRegions(): string[] {
  return [
    'us-east-1',
    'us-west-2',
    'eu-west-1',
    'eu-central-1',
    'ap-southeast-1',
    'ap-northeast-1',
  ];
}

/**
 * Validate if Bedrock is available in the region
 */
export function isBedrockSupportedInRegion(region: string): boolean {
  return getSupportedBedrockRegions().includes(region);
}

/**
 * Get OpenSearch Serverless supported regions
 */
export function getSupportedOpenSearchServerlessRegions(): string[] {
  return [
    'us-east-1',
    'us-east-2',
    'us-west-1',
    'us-west-2',
    'eu-west-1',
    'eu-west-2',
    'eu-central-1',
    'ap-southeast-1',
    'ap-southeast-2',
    'ap-northeast-1',
    'ap-northeast-2',
  ];
}

/**
 * Validate if OpenSearch Serverless is available in the region
 */
export function isOpenSearchServerlessSupportedInRegion(region: string): boolean {
  return getSupportedOpenSearchServerlessRegions().includes(region);
}

/**
 * Create conditional construct helper
 */
export function createConditionalConstruct<T extends IConstruct>(
  scope: IConstruct,
  id: string,
  condition: boolean,
  constructFactory: () => T
): T | undefined {
  return condition ? constructFactory() : undefined;
}

/**
 * Format CloudWatch log group name
 */
export function formatLogGroupName(config: Config, service: string): string {
  return `/aws/lambda/rag-demo-${service}-${config.environment}`;
}

/**
 * Generate IAM role name with proper formatting
 */
export function generateIAMRoleName(config: Config, service: string): string {
  return `RagDemo${capitalizeFirst(service)}Role${capitalizeFirst(config.environment)}`;
}

/**
 * Generate Lambda function name
 */
export function generateLambdaFunctionName(config: Config, functionType: string): string {
  return `rag-demo-${functionType}-${config.environment}`;
}

/**
 * Capitalize first letter of a string
 */
export function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Generate CloudWatch alarm name
 */
export function generateAlarmName(config: Config, metric: string, resource: string): string {
  return `RagDemo-${capitalizeFirst(resource)}-${capitalizeFirst(metric)}-${capitalizeFirst(config.environment)}`;
}

/**
 * Get cost allocation tags for billing
 */
export function getCostAllocationTags(config: Config): Record<string, string> {
  return {
    Project: 'RAG-Demo',
    Environment: config.environment,
    CostCenter: 'engineering',
    Owner: 'platform-team',
    Application: 'knowledge-base',
  };
}

/**
 * Generate S3 lifecycle rule ID
 */
export function generateLifecycleRuleId(config: Config, ruleType: string): string {
  return `rag-demo-${ruleType}-${config.environment}`;
}

/**
 * Create environment-specific timeout configuration
 */
export function getTimeoutConfiguration(config: Config): {
  lambdaTimeout: cdk.Duration;
  ingestionTimeout: cdk.Duration;
  queryTimeout: cdk.Duration;
} {
  const baseTimeouts = {
    dev: {
      lambdaTimeout: cdk.Duration.minutes(15),
      ingestionTimeout: cdk.Duration.minutes(30),
      queryTimeout: cdk.Duration.seconds(30),
    },
    staging: {
      lambdaTimeout: cdk.Duration.minutes(20),
      ingestionTimeout: cdk.Duration.minutes(45),
      queryTimeout: cdk.Duration.minutes(1),
    },
    prod: {
      lambdaTimeout: cdk.Duration.minutes(25),
      ingestionTimeout: cdk.Duration.hours(1),
      queryTimeout: cdk.Duration.minutes(2),
    },
  };
  
  return baseTimeouts[config.environment];
}

/**
 * Generate KMS key alias
 */
export function generateKMSKeyAlias(config: Config, purpose: string): string {
  return `alias/rag-demo-${purpose}-${config.environment}`;
}

/**
 * Create resource description with environment context
 */
export function createResourceDescription(config: Config, resourceType: string, purpose?: string): string {
  const parts = [`RAG Demo ${resourceType} for ${config.environment} environment`];
  if (purpose) {
    parts.push(`- ${purpose}`);
  }
  return parts.join(' ');
}

/**
 * Validate and format email address for notifications
 */
export function validateAndFormatEmail(email?: string): string | undefined {
  if (!email) return undefined;
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error(`Invalid email address: ${email}`);
  }
  
  return email.toLowerCase();
}

/**
 * Generate SNS topic name
 */
export function generateSNSTopicName(config: Config, topicType: string): string {
  return `rag-demo-${topicType}-${config.environment}`;
} 