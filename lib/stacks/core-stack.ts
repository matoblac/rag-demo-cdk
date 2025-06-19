import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { Config } from '../utils/config';
import { getSSMParameterName } from '../utils/helpers';

export interface CoreStackProps extends cdk.StackProps {
  config: Config;
}

/**
 * Core Stack - Contains ALL IAM roles and policies
 * 
 * This stack contains:
 * - Knowledge Base IAM role
 * - Lambda execution roles (index creation, monitoring, etc.)
 * - Service-linked roles and policies
 * - Cross-service permissions
 * 
 * Deploy this stack FIRST to ensure maximum IAM propagation time.
 */
export class CoreStack extends cdk.Stack {
  
  public readonly knowledgeBaseRole: iam.Role;
  public readonly indexCreationLambdaRole: iam.Role;
  public readonly postDeploymentLambdaRole: iam.Role;
  public readonly monitoringLambdaRole: iam.Role;

  constructor(scope: Construct, id: string, props: CoreStackProps) {
    super(scope, id, props);

    const { config } = props;

    // 1. Create Knowledge Base IAM role
    this.knowledgeBaseRole = this.createKnowledgeBaseRole(config);

    // 2. Create Lambda execution roles
    this.indexCreationLambdaRole = this.createIndexCreationLambdaRole(config);
    this.postDeploymentLambdaRole = this.createPostDeploymentLambdaRole(config);
    this.monitoringLambdaRole = this.createMonitoringLambdaRole(config);

    // 3. Create SSM parameters for other stacks to consume
    this.createCoreSSMParameters(config);

    // 4. Create stack outputs for cross-stack references
    this.createOutputs(config);

    // 5. Apply comprehensive tagging
    this.applyTags(config);
  }

  private createKnowledgeBaseRole(config: Config): iam.Role {
    const role = new iam.Role(this, 'KnowledgeBaseRole', {
      roleName: `rag-demo-knowledge-base-role-${config.environment}-${config.region}`,
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      description: 'Role for Bedrock Knowledge Base to access OpenSearch and S3',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockFullAccess'),
      ],
    });

    // S3 permissions for document access (will be scoped to specific bucket later)
    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:ListBucket',
        's3:GetBucketLocation',
        's3:GetBucketNotification',
        's3:PutBucketNotification',
        's3:DeleteObject',
      ],
      resources: [
        `arn:aws:s3:::rag-demo-documents-${config.environment}-*`,
        `arn:aws:s3:::rag-demo-documents-${config.environment}-*/*`,
      ],
    }));

    // OpenSearch Serverless permissions
    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'aoss:APIAccessAll',  // Full API access to collections
        'aoss:CreateIndex',
        'aoss:DescribeIndex', 
        'aoss:UpdateIndex',
        'aoss:DeleteIndex',
        'aoss:QueryIndex',
        'aoss:SearchIndex',
        'aoss:DashboardsAccessAll',
      ],
      resources: ['*'], // Will be scoped by data access policy
    }));

    // Bedrock model invocation permissions
    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
      ],
      resources: [
        `arn:aws:bedrock:${config.region}::foundation-model/${config.embeddingModel}`,
        `arn:aws:bedrock:${config.region}::foundation-model/${config.embeddingModel}`, // Use embeddingModel for both since chatModel doesn't exist
      ],
    }));

    // KMS permissions (will be scoped to specific key later)
    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'kms:Decrypt',
        'kms:DescribeKey',
        'kms:GenerateDataKey',
      ],
      resources: [
        `arn:aws:kms:${config.region}:${this.account}:key/*`,
      ],
      conditions: {
        StringEquals: {
          'kms:ViaService': [
            `s3.${config.region}.amazonaws.com`,
            `aoss.${config.region}.amazonaws.com`,
          ],
        },
      },
    }));

    return role;
  }

  private createIndexCreationLambdaRole(config: Config): iam.Role {
    const role = new iam.Role(this, 'IndexCreationLambdaRole', {
      roleName: `rag-demo-index-creation-role-${config.environment}-${config.region}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for Lambda function to create OpenSearch index',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // OpenSearch Serverless permissions for index creation
    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'aoss:APIAccessAll',
        'aoss:CreateIndex',
        'aoss:DescribeIndex',
        'aoss:UpdateIndex',
      ],
      resources: ['*'], // Will be scoped by data access policy
    }));

    return role;
  }

  private createPostDeploymentLambdaRole(config: Config): iam.Role {
    const role = new iam.Role(this, 'PostDeploymentLambdaRole', {
      roleName: `rag-demo-post-deployment-role-${config.environment}-${config.region}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for post-deployment validation Lambda function',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Bedrock permissions for Knowledge Base validation
    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:GetKnowledgeBase',
        'bedrock:ListKnowledgeBases',
        'bedrock:GetDataSource',
        'bedrock:ListDataSources',
      ],
      resources: [
        `arn:aws:bedrock:${config.region}:${this.account}:knowledge-base/*`,
        `arn:aws:bedrock:${config.region}:${this.account}:data-source/*`,
      ],
    }));

    // CloudWatch permissions for metrics
    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'cloudwatch:PutMetricData',
        'cloudwatch:GetMetricData',
        'cloudwatch:ListMetrics',
      ],
      resources: ['*'],
    }));

    return role;
  }

  private createMonitoringLambdaRole(config: Config): iam.Role {
    const role = new iam.Role(this, 'MonitoringLambdaRole', {
      roleName: `rag-demo-monitoring-role-${config.environment}-${config.region}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for monitoring and API Lambda functions',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Bedrock permissions for queries and monitoring
    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
        'bedrock:GetKnowledgeBase',
        'bedrock:Retrieve',
        'bedrock:RetrieveAndGenerate',
      ],
      resources: [
        `arn:aws:bedrock:${config.region}::foundation-model/${config.embeddingModel}`,
        `arn:aws:bedrock:${config.region}::foundation-model/${config.embeddingModel}`, // Use embeddingModel for both since chatModel doesn't exist
        `arn:aws:bedrock:${config.region}:${this.account}:knowledge-base/*`,
      ],
    }));

    // CloudWatch permissions for dashboards and metrics
    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'cloudwatch:PutMetricData',
        'cloudwatch:GetMetricData',
        'cloudwatch:ListMetrics',
        'cloudwatch:PutDashboard',
        'cloudwatch:GetDashboard',
        'cloudwatch:ListDashboards',
      ],
      resources: ['*'],
    }));

    // SNS permissions for alerts
    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'sns:Publish',
        'sns:Subscribe',
        'sns:Unsubscribe',
      ],
      resources: [
        `arn:aws:sns:${config.region}:${this.account}:rag-demo-notifications-${config.environment}-${config.region}`,
      ],
    }));

    return role;
  }

  private createCoreSSMParameters(config: Config): void {
    // Store all IAM role ARNs for other stacks to consume
    new ssm.StringParameter(this, 'CoreConfigParameter', {
      parameterName: getSSMParameterName(config, 'core-config'),
      stringValue: JSON.stringify({
        knowledgeBaseRoleArn: this.knowledgeBaseRole.roleArn,
        indexCreationLambdaRoleArn: this.indexCreationLambdaRole.roleArn,
        postDeploymentLambdaRoleArn: this.postDeploymentLambdaRole.roleArn,
        monitoringLambdaRoleArn: this.monitoringLambdaRole.roleArn,
        deploymentTimestamp: new Date().toISOString(),
      }),
      description: 'Core IAM configuration for all other stacks',
    });

    // Individual parameters for easier consumption
    new ssm.StringParameter(this, 'KnowledgeBaseRoleArnParameter', {
      parameterName: getSSMParameterName(config, 'core-kb-role-arn'),
      stringValue: this.knowledgeBaseRole.roleArn,
      description: 'Knowledge Base IAM role ARN from CoreStack',
    });

    new ssm.StringParameter(this, 'IndexCreationRoleArnParameter', {
      parameterName: getSSMParameterName(config, 'core-index-role-arn'),
      stringValue: this.indexCreationLambdaRole.roleArn,
      description: 'Index creation Lambda IAM role ARN from CoreStack',
    });

    new ssm.StringParameter(this, 'PostDeploymentRoleArnParameter', {
      parameterName: getSSMParameterName(config, 'core-post-deploy-role-arn'),
      stringValue: this.postDeploymentLambdaRole.roleArn,
      description: 'Post-deployment Lambda IAM role ARN from CoreStack',
    });

    new ssm.StringParameter(this, 'MonitoringRoleArnParameter', {
      parameterName: getSSMParameterName(config, 'core-monitoring-role-arn'),
      stringValue: this.monitoringLambdaRole.roleArn,
      description: 'Monitoring Lambda IAM role ARN from CoreStack',
    });
  }

  private createOutputs(config: Config): void {
    // IAM role outputs for cross-stack references
    new cdk.CfnOutput(this, 'KnowledgeBaseRoleArn', {
      value: this.knowledgeBaseRole.roleArn,
      description: 'Knowledge Base IAM role ARN',
      exportName: `RagDemo-CoreKnowledgeBaseRoleArn-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'IndexCreationLambdaRoleArn', {
      value: this.indexCreationLambdaRole.roleArn,
      description: 'Index creation Lambda IAM role ARN',
      exportName: `RagDemo-CoreIndexCreationLambdaRoleArn-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'PostDeploymentLambdaRoleArn', {
      value: this.postDeploymentLambdaRole.roleArn,
      description: 'Post-deployment Lambda IAM role ARN',
      exportName: `RagDemo-CorePostDeploymentLambdaRoleArn-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'MonitoringLambdaRoleArn', {
      value: this.monitoringLambdaRole.roleArn,
      description: 'Monitoring Lambda IAM role ARN',
      exportName: `RagDemo-CoreMonitoringLambdaRoleArn-${config.environment}`,
    });

    // Status and readiness indicators
    new cdk.CfnOutput(this, 'CoreStatus', {
      value: 'READY',
      description: 'Core stack deployment status - READY means IAM roles are created and propagating',
      exportName: `RagDemo-CoreStatus-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'CoreTimestamp', {
      value: new Date().toISOString(),
      description: 'Core stack deployment timestamp',
    });

    // IAM propagation guidance
    new cdk.CfnOutput(this, 'IamPropagationGuidance', {
      value: 'Wait 2-5 minutes after this stack completes before deploying dependent stacks',
      description: 'IAM role propagation timing guidance',
    });
  }

  private applyTags(config: Config): void {
    cdk.Tags.of(this).add('StackType', 'core');
    cdk.Tags.of(this).add('StackPurpose', 'iam-roles-policies');
    cdk.Tags.of(this).add('DeploymentOrder', '1'); // First stack to deploy
    cdk.Tags.of(this).add('Environment', config.environment);
    cdk.Tags.of(this).add('Project', 'RAG-Demo');
    cdk.Tags.of(this).add('Component', 'Infrastructure-Core');
    cdk.Tags.of(this).add('CostCenter', 'engineering');
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
    
    // Add configuration tags
    cdk.Tags.of(this).add('EmbeddingModel', config.embeddingModel);
    cdk.Tags.of(this).add('ChatModel', config.chatModel);
    cdk.Tags.of(this).add('Region', config.region);
    
    // IAM-specific tags
    cdk.Tags.of(this).add('IamStackType', 'primary');
    cdk.Tags.of(this).add('SecurityLevel', 'core-infrastructure');
  }
} 