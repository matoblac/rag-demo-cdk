import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as amplify from '@aws-cdk/aws-amplify-alpha';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';
import { Config } from '../utils/config';
import { 
  generateResourceName,
  generateTags,
  getRemovalPolicy,
  getSSMParameterName,
  createResourceDescription,
  generateLambdaFunctionName,
  getCostAllocationTags
} from '../utils/helpers';

export interface FrontendStackProps extends cdk.StackProps {
  config: Config;
  knowledgeBaseId: string;
  collectionEndpoint: string;
  documentsBucket: s3.IBucket;
}

export class FrontendStack extends cdk.Stack {
  public readonly streamlitApp?: amplify.App;
  public readonly frontendBucket: s3.Bucket;
  public readonly frontendUrl: string;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const { config, knowledgeBaseId, collectionEndpoint, documentsBucket } = props;

    // Create S3 bucket for frontend assets
    this.frontendBucket = this.createFrontendBucket(config);

    // Deploy Streamlit application using Lambda and API Gateway for serverless hosting
    const { api, lambdaUrl } = this.createStreamlitLambda(config, knowledgeBaseId, collectionEndpoint, documentsBucket);

    this.frontendUrl = lambdaUrl;

    // Store frontend configuration
    this.createFrontendSSMParameters(config);

    // Create outputs
    this.createOutputs(config);

    // Apply tags
    this.applyTags(config);
  }

  private createFrontendBucket(config: Config): s3.Bucket {
    const bucketName = `rag-demo-frontend-${config.environment}-${Math.random().toString(36).substring(2, 8)}`;

    const bucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: getRemovalPolicy(config, 'infrastructure'),
      autoDeleteObjects: config.environment === 'dev',
      versioned: false,
      
      // CORS for web access
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          maxAge: 3600,
        },
      ],
    });

    return bucket;
  }

  private createIpRestrictedPolicy(config: Config): iam.PolicyDocument {
    // Get allowed IP addresses from config
    const allowedIps = config.allowedIps || ['0.0.0.0/0']; // Default to all IPs if not specified
    
    // If all IPs are allowed, don't create restrictive policy
    if (allowedIps.includes('0.0.0.0/0')) {
      return new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            principals: [new iam.AnyPrincipal()],
            actions: ['execute-api:Invoke'],
            resources: ['*'],
          }),
        ],
      });
    }
    
    // Create IP-restricted policy - ALLOW only from specified IPs
    return new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          principals: [new iam.AnyPrincipal()],
          actions: ['execute-api:Invoke'],
          resources: ['*'],
          conditions: {
            IpAddress: {
              'aws:SourceIp': allowedIps,
            },
          },
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.DENY,
          principals: [new iam.AnyPrincipal()],
          actions: ['execute-api:Invoke'],
          resources: ['*'],
          conditions: {
            NotIpAddress: {
              'aws:SourceIp': allowedIps,
            },
          },
        }),
      ],
    });
  }

  private createStreamlitLambda(
    config: Config,
    knowledgeBaseId: string,
    collectionEndpoint: string,
    documentsBucket: s3.IBucket
  ): { api: apigateway.RestApi; lambdaUrl: string } {
    const functionName = generateLambdaFunctionName(config, 'streamlit-app');

    // Create Lambda function for Streamlit
    const streamlitLambda = new lambda.Function(this, 'StreamlitLambda', {
      functionName,
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'app.handler',
      timeout: cdk.Duration.minutes(15),
      memorySize: 2048,
      environment: {
        KNOWLEDGE_BASE_ID: knowledgeBaseId,
        COLLECTION_ENDPOINT: collectionEndpoint,
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        REGION: config.region,
        ENVIRONMENT: config.environment,
        EMBEDDING_MODEL: config.embeddingModel,
        INDEX_NAME: config.indexName,
        VECTOR_DIMENSIONS: config.vectorDimensions.toString(),
        CHUNK_SIZE: config.chunkSize.toString(),
        CHUNK_OVERLAP: config.chunkOverlap.toString(),
        MAX_DOCUMENT_SIZE: config.maxDocumentSize.toString(),
        SUPPORTED_FORMATS: JSON.stringify(config.supportedFormats),
        ENABLE_OCR: config.enableOcr.toString(),
        ENABLE_WEB_SCRAPING: config.enableWebScraping.toString(),
      },
      code: lambda.Code.fromAsset('frontend', {
        bundling: {
          image: lambda.Runtime.PYTHON_3_11.bundlingImage,
          command: [
            'bash', '-c',
            'pip install -r requirements.txt -t /asset-output && cp -au . /asset-output'
          ],
        },
      }),
    });

    // Add permissions for Streamlit Lambda
    streamlitLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:Retrieve',
        'bedrock:InvokeModel',
        'bedrock:GetFoundationModel',
        'bedrock:ListFoundationModels',
      ],
      resources: [
        `arn:aws:bedrock:${config.region}:${this.account}:knowledge-base/${knowledgeBaseId}`,
        `arn:aws:bedrock:${config.region}::foundation-model/*`,
      ],
    }));

    streamlitLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:PutObject',
        's3:DeleteObject',
        's3:ListBucket',
      ],
      resources: [
        documentsBucket.bucketArn,
        `${documentsBucket.bucketArn}/*`,
        this.frontendBucket.bucketArn,
        `${this.frontendBucket.bucketArn}/*`,
      ],
    }));

    streamlitLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ssm:GetParameter',
        'ssm:GetParameters',
        'ssm:GetParametersByPath',
      ],
      resources: [
        `arn:aws:ssm:${config.region}:${this.account}:parameter/rag-demo/${config.environment}/*`,
      ],
    }));

    // Create API Gateway with IP restriction
    const api = new apigateway.RestApi(this, 'StreamlitApi', {
      restApiName: generateResourceName(config, 'streamlit-api'),
      description: createResourceDescription(config, 'Streamlit API', 'RAG demo frontend API'),
      binaryMediaTypes: ['*/*'],
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
      },
      // Add resource policy for IP-based access control
      policy: this.createIpRestrictedPolicy(config),
    });

    // Add proxy integration
    const integration = new apigateway.LambdaIntegration(streamlitLambda, {
      proxy: true,
    });

    // Add catch-all proxy resource
    const proxyResource = api.root.addProxy({
      defaultIntegration: integration,
      anyMethod: true,
    });

    // Add root method
    api.root.addMethod('ANY', integration);

    return {
      api,
      lambdaUrl: api.url,
    };
  }

  private createFrontendSSMParameters(config: Config): void {
    new ssm.StringParameter(this, 'FrontendUrlParameter', {
      parameterName: getSSMParameterName(config, 'frontend-url'),
      stringValue: this.frontendUrl,
      description: 'Frontend application URL',
    });

    new ssm.StringParameter(this, 'FrontendBucketParameter', {
      parameterName: getSSMParameterName(config, 'frontend-bucket'),
      stringValue: this.frontendBucket.bucketName,
      description: 'Frontend assets S3 bucket name',
    });
  }

  private createOutputs(config: Config): void {
    new cdk.CfnOutput(this, 'FrontendUrl', {
      value: this.frontendUrl,
      description: 'Streamlit frontend application URL',
      exportName: `RagDemo-FrontendUrl-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'FrontendBucket', {
      value: this.frontendBucket.bucketName,
      description: 'Frontend assets S3 bucket',
      exportName: `RagDemo-FrontendBucket-${config.environment}`,
    });

    // Instructions for accessing the application
    new cdk.CfnOutput(this, 'ApplicationInstructions', {
      value: `Access the RAG Demo at: ${this.frontendUrl}`,
      description: 'Instructions for accessing the application',
    });
  }

  private applyTags(config: Config): void {
    const tags = getCostAllocationTags(config);
    
    // Add frontend-specific tags
    const frontendTags = {
      ...tags,
      ResourceType: 'Frontend',
      StackType: 'Frontend',
      ApplicationType: 'Streamlit',
    };
    
    Object.entries(frontendTags).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
  }
} 