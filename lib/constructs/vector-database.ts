import * as cdk from 'aws-cdk-lib';
import * as opensearchserverless from 'aws-cdk-lib/aws-opensearchserverless';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { Config } from '../utils/config';
import { 
  generateResourceName,
  generateTags,
  getRemovalPolicy,
  getSSMParameterName,
  createResourceDescription,
  isOpenSearchServerlessSupportedInRegion
} from '../utils/helpers';

export interface VectorDatabaseProps {
  config: Config;
  knowledgeBaseRole?: iam.Role;
}

export class VectorDatabaseConstruct extends Construct {
  public readonly collection: opensearchserverless.CfnCollection;
  public readonly collectionEndpoint: string;
  public readonly dashboardsEndpoint: string;
  public readonly dataAccessPolicy: opensearchserverless.CfnAccessPolicy;
  public readonly networkPolicy: opensearchserverless.CfnSecurityPolicy;
  public readonly encryptionPolicy: opensearchserverless.CfnSecurityPolicy;

  constructor(scope: Construct, id: string, props: VectorDatabaseProps) {
    super(scope, id);

    const { config } = props;

    // Validate region support
    if (!isOpenSearchServerlessSupportedInRegion(config.region)) {
      throw new Error(`OpenSearch Serverless not supported in region: ${config.region}`);
    }

    // Create security policies first
    this.encryptionPolicy = this.createEncryptionPolicy(config);
    this.networkPolicy = this.createNetworkPolicy(config);
    
    // Create the collection
    this.collection = this.createCollection(config);
    
    // Set endpoints
    this.collectionEndpoint = `https://${this.collection.ref}.${config.region}.aoss.amazonaws.com`;
    this.dashboardsEndpoint = `https://${this.collection.ref}.${config.region}.aoss.amazonaws.com/_dashboards`;
    
    // Create data access policy
    this.dataAccessPolicy = this.createDataAccessPolicy(config, props.knowledgeBaseRole);
    
    // Create SSM parameters
    this.createSSMParameters(config);
    
    // Create outputs
    this.createOutputs(config);

    // Apply tags
    this.applyTags(config);
  }

  private createEncryptionPolicy(config: Config): opensearchserverless.CfnSecurityPolicy {
    const policyName = generateResourceName(config, 'encryption-policy');
    
    const encryptionPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'EncryptionPolicy', {
      name: policyName,
      type: 'encryption',
      description: createResourceDescription(config, 'Encryption Policy', 'OpenSearch Serverless encryption'),
      policy: JSON.stringify({
        Rules: [
          {
            Resource: [`collection/${config.collectionName}`],
            ResourceType: 'collection',
          },
        ],
        AWSOwnedKey: !config.enableEncryption, // Use AWS owned keys if encryption is disabled
        ...(config.enableEncryption && config.kmsKeyId && {
          KmsKeyId: config.kmsKeyId,
        }),
      }),
    });

    return encryptionPolicy;
  }

  private createNetworkPolicy(config: Config): opensearchserverless.CfnSecurityPolicy {
    const policyName = generateResourceName(config, 'network-policy');
    
    const networkPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'NetworkPolicy', {
      name: policyName,
      type: 'network',
      description: createResourceDescription(config, 'Network Policy', 'OpenSearch Serverless network access'),
      policy: JSON.stringify([
        {
          Rules: [
            {
              Resource: [`collection/${config.collectionName}`],
              ResourceType: 'collection',
            },
            {
              Resource: [`collection/${config.collectionName}`],
              ResourceType: 'dashboard',
            },
          ],
          AllowFromPublic: !config.enableVpcEndpoints,
          ...(config.enableVpcEndpoints && {
            SourceVPCEs: [], // TODO: Add VPC endpoint IDs when VPC is implemented
          }),
        },
      ]),
    });

    return networkPolicy;
  }

  private createCollection(config: Config): opensearchserverless.CfnCollection {
    const collection = new opensearchserverless.CfnCollection(this, 'VectorCollection', {
      name: config.collectionName,
      type: 'VECTORSEARCH',
      description: createResourceDescription(config, 'Vector Database', 'RAG document embeddings'),
      tags: Object.entries(generateTags(config, {
        ResourceType: 'VectorDatabase',
        CollectionType: 'VECTORSEARCH',
      })).map(([key, value]) => ({ key, value })),
    });

    // Add dependencies on security policies
    collection.addDependency(this.encryptionPolicy);
    collection.addDependency(this.networkPolicy);

    return collection;
  }

  private createDataAccessPolicy(
    config: Config, 
    knowledgeBaseRole?: iam.Role
  ): opensearchserverless.CfnAccessPolicy {
    const policyName = generateResourceName(config, 'data-access-policy');
    
    // Get current AWS account and region
    const account = cdk.Stack.of(this).account;
    const region = cdk.Stack.of(this).region;
    
    // Define principals that can access the collection
    const principals = [
      `arn:aws:iam::${account}:root`, // Root account access
    ];

    // Add knowledge base role if provided
    if (knowledgeBaseRole) {
      principals.push(knowledgeBaseRole.roleArn);
    }

    // Add Bedrock service principal for the region
    principals.push(`arn:aws:iam::${account}:role/service-role/AmazonBedrockExecutionRoleForKnowledgeBase_*`);

    const dataAccessPolicy = new opensearchserverless.CfnAccessPolicy(this, 'DataAccessPolicy', {
      name: policyName,
      type: 'data',
      description: createResourceDescription(config, 'Data Access Policy', 'OpenSearch Serverless data access'),
      policy: JSON.stringify([
        {
          Rules: [
            {
              Resource: [`collection/${config.collectionName}`],
              Permission: [
                'aoss:CollectionAPIActions',
                'aoss:CreateCollectionItems',
                'aoss:DeleteCollectionItems',
                'aoss:UpdateCollectionItems',
                'aoss:DescribeCollectionItems',
              ],
              ResourceType: 'collection',
            },
            {
              Resource: [`index/${config.collectionName}/*`],
              Permission: [
                'aoss:CreateIndex',
                'aoss:DeleteIndex',
                'aoss:UpdateIndex',
                'aoss:DescribeIndex',
                'aoss:ReadDocument',
                'aoss:WriteDocument',
              ],
              ResourceType: 'index',
            },
          ],
          Principal: principals,
        },
      ]),
    });

    // Add dependency on collection
    dataAccessPolicy.addDependency(this.collection);

    return dataAccessPolicy;
  }

  private createSSMParameters(config: Config): void {
    new ssm.StringParameter(this, 'CollectionNameParameter', {
      parameterName: getSSMParameterName(config, 'opensearch-collection-name'),
      stringValue: this.collection.name!,
      description: 'OpenSearch Serverless collection name',
    });

    new ssm.StringParameter(this, 'CollectionIdParameter', {
      parameterName: getSSMParameterName(config, 'opensearch-collection-id'),
      stringValue: this.collection.ref,
      description: 'OpenSearch Serverless collection ID',
    });

    new ssm.StringParameter(this, 'CollectionEndpointParameter', {
      parameterName: getSSMParameterName(config, 'opensearch-collection-endpoint'),
      stringValue: this.collectionEndpoint,
      description: 'OpenSearch Serverless collection endpoint',
    });

    new ssm.StringParameter(this, 'DashboardsEndpointParameter', {
      parameterName: getSSMParameterName(config, 'opensearch-dashboards-endpoint'),
      stringValue: this.dashboardsEndpoint,
      description: 'OpenSearch Serverless dashboards endpoint',
    });

    new ssm.StringParameter(this, 'IndexNameParameter', {
      parameterName: getSSMParameterName(config, 'opensearch-index-name'),
      stringValue: config.indexName,
      description: 'OpenSearch index name for vectors',
    });

    new ssm.StringParameter(this, 'VectorDimensionsParameter', {
      parameterName: getSSMParameterName(config, 'vector-dimensions'),
      stringValue: config.vectorDimensions.toString(),
      description: 'Vector dimensions for embeddings',
    });
  }

  private createOutputs(config: Config): void {
    new cdk.CfnOutput(this, 'CollectionName', {
      value: this.collection.name!,
      description: 'OpenSearch Serverless collection name',
      exportName: `RagDemo-CollectionName-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'CollectionId', {
      value: this.collection.ref,
      description: 'OpenSearch Serverless collection ID',
      exportName: `RagDemo-CollectionId-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'CollectionEndpoint', {
      value: this.collectionEndpoint,
      description: 'OpenSearch Serverless collection endpoint',
      exportName: `RagDemo-CollectionEndpoint-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'DashboardsEndpoint', {
      value: this.dashboardsEndpoint,
      description: 'OpenSearch Serverless dashboards endpoint',
      exportName: `RagDemo-DashboardsEndpoint-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'IndexName', {
      value: config.indexName,
      description: 'OpenSearch index name for vectors',
      exportName: `RagDemo-IndexName-${config.environment}`,
    });
  }

  private applyTags(config: Config): void {
    const tags = generateTags(config, {
      ResourceType: 'VectorDatabase',
      Service: 'OpenSearchServerless',
      CollectionType: 'VECTORSEARCH',
    });
    
    Object.entries(tags).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
  }

  /**
   * Get the IAM policy statements needed for a role to access this vector database
   */
  public getAccessPolicyStatements(): iam.PolicyStatement[] {
    return [
      // OpenSearch Serverless permissions
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'aoss:APIAccessAll',
          'aoss:CollectionAPIActions',
          'aoss:CreateCollectionItems',
          'aoss:DeleteCollectionItems',
          'aoss:UpdateCollectionItems',
          'aoss:DescribeCollectionItems',
        ],
        resources: [
          `arn:aws:aoss:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:collection/${this.collection.ref}`,
        ],
      }),
      // Index permissions
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'aoss:CreateIndex',
          'aoss:DeleteIndex',
          'aoss:UpdateIndex',
          'aoss:DescribeIndex',
          'aoss:ReadDocument',
          'aoss:WriteDocument',
        ],
        resources: [
          `arn:aws:aoss:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:index/${this.collection.ref}/*`,
        ],
      }),
    ];
  }

  /**
   * Create the vector index mapping for the collection
   * This should be called after the collection is created and accessible
   */
  public getIndexMappingTemplate(config: Config): any {
    return {
      mappings: {
        properties: {
          [config.indexName]: {
            type: 'knn_vector',
            dimension: config.vectorDimensions,
            method: {
              name: 'hnsw',
              space_type: 'cosinesimil',
              engine: 'faiss',
              parameters: {
                ef_construction: 256,
                m: 16,
              },
            },
          },
          text: {
            type: 'text',
            analyzer: 'standard',
          },
          metadata: {
            type: 'object',
            properties: {
              source: { type: 'keyword' },
              page: { type: 'integer' },
              chunk_id: { type: 'keyword' },
              document_id: { type: 'keyword' },
              created_at: { type: 'date' },
              updated_at: { type: 'date' },
            },
          },
        },
      },
      settings: {
        index: {
          knn: true,
          number_of_shards: 1,
          number_of_replicas: 0, // Serverless doesn't support replicas
        },
      },
    };
  }
} 