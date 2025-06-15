## Troubleshooting

### Common Issues

#### 1. 🚨 "AccessDeniedException" for Bedrock Models (MOST COMMON!)
```bash
# Error: Access denied for model amazon.titan-embed-text-v1
# This happens in NEW AWS accounts that haven't requested model access

# Solution 1: Check model access
./scripts/check-model-access.sh

# Solution 2: Request access in Bedrock console
# Go to: https://console.aws.amazon.com/bedrock/
# Click: Model access → Request model access
# Enable: Amazon Titan Embed Text v1 + Anthropic Claude 3 Sonnet

# Solution 3: Use different models you have access to
export EMBEDDING_MODEL='cohere.embed-english-v3'
export VECTOR_DIMENSIONS='1024'
./scripts/deploy.sh dev
```

#### 2. "Stack does not exist" Error
```bash
# Check if stack was deployed
aws cloudformation describe-stacks --stack-name RagDemoStorageStack-dev

# Redeploy if needed
cdk deploy RagDemoStorageStack-dev
```

#### 3. OpenSearch Collection Not Ready
```bash
# Check collection status
aws opensearchserverless list-collections

# Wait for ACTIVE status before proceeding
```

#### 4. Knowledge Base Ingestion Fails
```bash
# Check ingestion job status
aws bedrock-agent list-ingestion-jobs \
  --knowledge-base-id $KB_ID

# Restart ingestion
python scripts/trigger-ingestion.py --knowledge-base-id $KB_ID
```

#### 5. Frontend Can't Connect
```bash
# Check SSM parameters
aws ssm get-parameter --name /rag-demo/dev/frontend-config

# Verify Lambda environment variables
aws lambda get-function-configuration --function-name rag-demo-streamlit-app-dev
```

### Debugging Commands
```bash
# CDK debugging
cdk doctor                       # Check CDK environment
cdk synth                       # Generate CloudFormation templates
cdk diff                        # Show deployment changes

# AWS service debugging  
aws bedrock list-foundation-models           # Available models
aws opensearchserverless list-collections   # OpenSearch status
aws s3 ls s3://your-bucket-name/documents/  # Document count
```
