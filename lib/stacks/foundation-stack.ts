import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { VectorDatabaseConstruct } from '../constructs/vector-database';
import { Config } from '../utils/config';
import { getSSMParameterName, isBedrockSupportedInRegion, isOpenSearchServerlessSupportedInRegion } from '../utils/helpers';

export interface FoundationStackProps extends cdk.StackProps {
  config: Config;
  documentsBucket: s3.IBucket;  
  backupBucket?: s3.IBucket;
}

/**
 * Foundation Stack - Contains OpenSearch infrastructure that needs time to propagate
 * 
 * This stack contains:
 * - OpenSearch Serverless collection
 * - Encryption and data access policies  
 * - Basic validation and regional support checks
 * 
 * Deploy this stack AFTER CoreStack and StorageStack, BEFORE ApplicationStack.
 * Imports IAM roles from CoreStack via SSM parameters.
 */
export class FoundationStack extends cdk.Stack {
  
  public readonly vectorDatabase: VectorDatabaseConstruct;
  public readonly collectionEndpoint: string;
  public readonly dashboardsEndpoint: string;

  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props);

    const { config, documentsBucket } = props;

    // Validate regional service availability
    this.validateRegionalSupport(config);

    // Get encryption key from storage stack
    const encryptionKey = this.getEncryptionKeyFromSSM(config);

    // Import IAM roles from CoreStack
    const coreConfig = this.getCoreConfigFromSSM(config);
    
    const knowledgeBaseRole = cdk.aws_iam.Role.fromRoleArn(
      this, 
      'ImportedKnowledgeBaseRole',
      coreConfig.knowledgeBaseRoleArn
    ) as cdk.aws_iam.Role;

    const indexCreationLambdaRole = cdk.aws_iam.Role.fromRoleArn(
      this,
      'ImportedIndexCreationLambdaRole',
      coreConfig.indexCreationLambdaRoleArn
    ) as cdk.aws_iam.Role;

    // Create Vector Database with imported roles
    this.vectorDatabase = new VectorDatabaseConstruct(this, 'VectorDatabase', {
      config,
      knowledgeBaseRole,
      indexCreationLambdaRole,
    });

    // Set public properties for next stack
    this.collectionEndpoint = this.vectorDatabase.collectionEndpoint;
    this.dashboardsEndpoint = this.vectorDatabase.dashboardsEndpoint;

    // Create SSM parameters for ApplicationStack to consume
    this.createFoundationSSMParameters(config, coreConfig);

    // Create stack outputs for cross-stack references
    this.createOutputs(config);

    // Apply comprehensive tagging
    this.applyTags(config);
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
      
      const keyArn = `arn:aws:kms:${config.region}:${this.account}:key/${keyId}`;
      return kms.Key.fromKeyArn(this, 'ImportedEncryptionKey', keyArn);
    } catch (error) {
      console.warn('Could not import encryption key from SSM, proceeding without encryption');
      return undefined;
    }
  }

  private getCoreConfigFromSSM(config: Config): any {
    try {
      const coreConfigString = ssm.StringParameter.valueFromLookup(
        this,
        getSSMParameterName(config, 'core-config')
      );
      
      return JSON.parse(coreConfigString);
    } catch (error) {
      throw new Error(`Failed to import CoreStack configuration. Ensure CoreStack is deployed first: ${error}`);
    }
  }

  private createFoundationSSMParameters(config: Config, coreConfig: any): void {
    // Store foundation infrastructure details for ApplicationStack
    new ssm.StringParameter(this, 'FoundationConfigParameter', {
      parameterName: getSSMParameterName(config, 'foundation-config'),
      stringValue: JSON.stringify({
        collectionEndpoint: this.collectionEndpoint,
        dashboardsEndpoint: this.dashboardsEndpoint,
        collectionId: this.vectorDatabase.collection.ref,
        dataAccessPolicyName: `rag-demo-data-access-policy-${config.environment}`,
        encryptionPolicyName: `rag-demo-encryption-policy-${config.environment}`,
        // Re-export core config for convenience
        ...coreConfig,
      }),
      description: 'Foundation infrastructure configuration for ApplicationStack',
    });

    // Individual parameters for easier consumption
    new ssm.StringParameter(this, 'FoundationCollectionEndpointParameter', {
      parameterName: getSSMParameterName(config, 'foundation-collection-endpoint'),
      stringValue: this.collectionEndpoint,
      description: 'OpenSearch collection endpoint from FoundationStack',
    });

    new ssm.StringParameter(this, 'FoundationCollectionIdParameter', {
      parameterName: getSSMParameterName(config, 'foundation-collection-id'),
      stringValue: this.vectorDatabase.collection.ref,
      description: 'OpenSearch collection ID from FoundationStack',
    });
  }

  private createOutputs(config: Config): void {
    // Foundation infrastructure outputs for cross-stack references
    new cdk.CfnOutput(this, 'CollectionEndpoint', {
      value: this.collectionEndpoint,
      description: 'OpenSearch Serverless collection endpoint',
      exportName: `RagDemo-FoundationCollectionEndpoint-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'DashboardsEndpoint', {
      value: this.dashboardsEndpoint, 
      description: 'OpenSearch Serverless dashboards endpoint',
      exportName: `RagDemo-FoundationDashboardsEndpoint-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'CollectionId', {
      value: this.vectorDatabase.collection.ref,
      description: 'OpenSearch Serverless collection ID',
      exportName: `RagDemo-FoundationCollectionId-${config.environment}`,
    });

    // Status and readiness indicators
    new cdk.CfnOutput(this, 'FoundationStatus', {
      value: 'READY',
      description: 'Foundation stack deployment status - READY means ApplicationStack can be deployed',
      exportName: `RagDemo-FoundationStatus-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'FoundationTimestamp', {
      value: new Date().toISOString(),
      description: 'Foundation stack deployment timestamp',
    });

    // Propagation guidance
    new cdk.CfnOutput(this, 'PropagationGuidance', {
      value: 'OpenSearch collection and policies are ready. Wait 2-3 minutes before deploying ApplicationStack.',
      description: 'OpenSearch propagation timing guidance',
    });
  }

  private applyTags(config: Config): void {
    cdk.Tags.of(this).add('StackType', 'foundation');
    cdk.Tags.of(this).add('StackPurpose', 'opensearch-collection-policies');
    cdk.Tags.of(this).add('DeploymentOrder', '3'); // After CoreStack (1) and StorageStack (2)
    cdk.Tags.of(this).add('Environment', config.environment);
    cdk.Tags.of(this).add('Project', 'RAG-Demo');
    cdk.Tags.of(this).add('Component', 'Infrastructure-Foundation');
    cdk.Tags.of(this).add('CostCenter', 'engineering');
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
    
    // Add configuration tags
    cdk.Tags.of(this).add('EmbeddingModel', config.embeddingModel);
    cdk.Tags.of(this).add('Region', config.region);
    
    // OpenSearch-specific tags
    cdk.Tags.of(this).add('OpenSearchType', 'serverless');
    cdk.Tags.of(this).add('VectorDimensions', config.vectorDimensions.toString());
  }
} 