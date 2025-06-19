#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { IConstruct } from 'constructs';
import { CoreStack } from '../lib/stacks/core-stack';
import { StorageStack } from '../lib/stacks/storage-stack';
import { FoundationStack } from '../lib/stacks/foundation-stack';
import { ApplicationStack } from '../lib/stacks/application-stack';
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

// 1. Core Stack - ALL IAM roles and policies (deployed first for maximum propagation time)
const coreStack = new CoreStack(app, `RagDemoCoreStack-${environment}`, {
  ...commonProps,
  description: `RAG Demo Core Stack - IAM roles and policies (${environment})`,
  config,
});

// 2. Storage Stack - Persistent resources that survive teardowns
const storageStack = new StorageStack(app, `RagDemoStorageStack-${environment}`, {
  ...commonProps,
  description: `RAG Demo Storage Stack - Persistent S3 buckets and cross-region replication (${environment})`,
  config,
});

// 3. Foundation Stack - OpenSearch collection, policies (needs IAM roles from CoreStack)
const foundationStack = new FoundationStack(app, `RagDemoFoundationStack-${environment}`, {
  ...commonProps,
  description: `RAG Demo Foundation Stack - OpenSearch collection, policies (${environment})`,
  config,
  documentsBucket: storageStack.documentsBucket,
  backupBucket: storageStack.backupBucket,
});

// 4. Application Stack - Knowledge Base, monitoring (depends on foundation)
const applicationStack = new ApplicationStack(app, `RagDemoApplicationStack-${environment}`, {
  ...commonProps,
  description: `RAG Demo Application Stack - Knowledge Base, index creation, monitoring (${environment})`,
  config,
  documentsBucket: storageStack.documentsBucket,
  backupBucket: storageStack.backupBucket,
});

// 5. Frontend Stack - Streamlit application deployment
const frontendStack = new FrontendStack(app, `RagDemoFrontendStack-${environment}`, {
  ...commonProps,
  description: `RAG Demo Frontend Stack - Streamlit UI deployment (${environment})`,
  config,
  knowledgeBaseId: applicationStack.knowledgeBaseId,
  collectionEndpoint: applicationStack.collectionEndpoint,
  documentsBucket: storageStack.documentsBucket,
});

// Stack dependencies - CRITICAL: Must deploy in order for IAM propagation
// coreStack has no dependencies - deploys first
storageStack.addDependency(coreStack); // Wait for IAM roles
foundationStack.addDependency(storageStack); // Wait for storage + core
applicationStack.addDependency(foundationStack);  // Wait for foundation to complete
frontendStack.addDependency(applicationStack);

// Add metadata for stack identification
cdk.Tags.of(coreStack).add('StackType', 'core');
cdk.Tags.of(storageStack).add('StackType', 'persistent');
cdk.Tags.of(foundationStack).add('StackType', 'foundation');
cdk.Tags.of(applicationStack).add('StackType', 'application');
cdk.Tags.of(frontendStack).add('StackType', 'frontend');

// Deployment order tags
cdk.Tags.of(coreStack).add('DeploymentOrder', '1');
cdk.Tags.of(storageStack).add('DeploymentOrder', '2');
cdk.Tags.of(foundationStack).add('DeploymentOrder', '3');
cdk.Tags.of(applicationStack).add('DeploymentOrder', '4');
cdk.Tags.of(frontendStack).add('DeploymentOrder', '5');

// IAM-specific tags for core stack
cdk.Tags.of(coreStack).add('SecurityLevel', 'core-infrastructure');
cdk.Tags.of(coreStack).add('IamPropagationRequired', 'true');

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