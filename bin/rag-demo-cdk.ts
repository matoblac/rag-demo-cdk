#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { IConstruct } from 'constructs';
import { StorageStack } from '../lib/stacks/storage-stack';
import { InfrastructureStack } from '../lib/stacks/infrastructure-stack';
import { FrontendStack } from '../lib/stacks/frontend-stack';
import { getConfig } from '../lib/utils/config';

const app = new cdk.App();

// Get environment from context or default to 'dev'
const environment = app.node.tryGetContext('environment') || process.env.ENVIRONMENT || 'dev';
const region = app.node.tryGetContext('region') || process.env.AWS_REGION || 'us-east-1';

// Load environment-specific configuration
const config = getConfig(environment);

// Common props for all stacks
const commonProps: cdk.StackProps = {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: region,
  },
  tags: {
    Project: 'RAG-Demo',
    Environment: environment,
    CostCenter: 'engineering',
    ManagedBy: 'CDK',
  },
};

// 1. Storage Stack - Persistent resources that survive teardowns
const storageStack = new StorageStack(app, `RagDemoStorageStack-${environment}`, {
  ...commonProps,
  description: `RAG Demo Storage Stack - Persistent S3 buckets and cross-region replication (${environment})`,
  config,
});

// 2. Infrastructure Stack - Disposable resources for quick iteration
const infrastructureStack = new InfrastructureStack(app, `RagDemoInfrastructureStack-${environment}`, {
  ...commonProps,
  description: `RAG Demo Infrastructure Stack - OpenSearch, Bedrock, IAM (${environment})`,
  config,
  documentsBucket: storageStack.documentsBucket,
  backupBucket: storageStack.backupBucket,
});

// 3. Frontend Stack - Streamlit application deployment
const frontendStack = new FrontendStack(app, `RagDemoFrontendStack-${environment}`, {
  ...commonProps,
  description: `RAG Demo Frontend Stack - Streamlit UI deployment (${environment})`,
  config,
  knowledgeBaseId: infrastructureStack.knowledgeBaseId,
  collectionEndpoint: infrastructureStack.collectionEndpoint,
  documentsBucket: storageStack.documentsBucket,
});

// Stack dependencies
infrastructureStack.addDependency(storageStack);
frontendStack.addDependency(infrastructureStack);

// Add metadata for stack identification
cdk.Tags.of(storageStack).add('StackType', 'persistent');
cdk.Tags.of(infrastructureStack).add('StackType', 'disposable');
cdk.Tags.of(frontendStack).add('StackType', 'frontend');

// Output key information for scripts
new cdk.CfnOutput(app, 'Environment', {
  value: environment,
  description: 'Deployment environment',
});

new cdk.CfnOutput(app, 'Region', {
  value: region,
  description: 'AWS region',
});

// Aspects for additional validation and compliance
cdk.Aspects.of(app).add({
  visit(node: IConstruct) {
    // Add environment validation
    if (cdk.Stack.isStack(node)) {
      const stack = node as cdk.Stack;
      if (!stack.tags.hasTags() || !stack.tags.renderTags()['Environment']) {
        stack.tags.setTag('Environment', environment);
      }
    }
  },
}); 