# RAG Demo CDK - Enterprise Knowledge Base

[![AWS](https://img.shields.io/badge/AWS-Bedrock-orange)](https://aws.amazon.com/bedrock/)
[![CDK](https://img.shields.io/badge/CDK-TypeScript-blue)](https://aws.amazon.com/cdk/)
[![Streamlit](https://img.shields.io/badge/Frontend-Streamlit-red)](https://streamlit.io/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

A **production-ready** Retrieval Augmented Generation (RAG) demo using AWS CDK with TypeScript that creates a Bedrock Knowledge Base, OpenSearch Serverless vector database, and Streamlit frontend. The key feature is **persistent document storage** - the S3 bucket with knowledge base articles survives infrastructure teardowns for rapid iteration.

## Persistent vs Disposable Resources

| **Persistent (Protected)** | **Disposable (Rapid Iteration)** |
|----------------------------|-----------------------------------|
| S3 Document Bucket | Bedrock Knowledge Base |
| Cross-region Backup | OpenSearch Serverless Collection |
| KMS Encryption Keys | Lambda Functions |
| Document Versioning | IAM Roles & Policies |
| | CloudWatch Dashboards |
| | API Gateway |

## Quick Start

### Prerequisites

- **Node.js** 18+ and npm
- **Python** 3.9+ and pip
- **AWS CLI** configured with appropriate permissions
- **AWS CDK** CLI (`npm install -g aws-cdk`)

### 1-Minute Deployment

```bash
# Clone and setup
git clone https://github.com/matoblac/rag-demo-cdk.git
cd rag-demo-cdk

# Deploy to development
./scripts/deploy.sh dev

# Access your RAG demo at the provided URL!
```

### Detailed Deployment

```bash
# Install dependencies
npm install
pip install -r frontend/requirements.txt

# Bootstrap CDK (one-time per account/region)
cdk bootstrap

# Deploy storage (persistent - safe to keep)
cdk deploy RagDemoStorageStack-dev

# Deploy infrastructure (disposable - iterate rapidly)
cdk deploy RagDemoInfrastructureStack-dev

# Deploy frontend
cdk deploy RagDemoFrontendStack-dev

# Upload sample documents
aws s3 sync frontend/assets/sample-documents/ s3://your-bucket-name/documents/

# Start ingestion job
python scripts/trigger-ingestion.py --environment dev
```

## Project Structure

```
rag-demo-cdk/
├──  Infrastructure (CDK)
│   ├── bin/rag-demo-cdk.ts          #  CDK app entry point
│   ├── lib/
│   │   ├── stacks/
│   │   │   ├── storage-stack.ts      # Persistent S3 resources
│   │   │   ├── infrastructure-stack.ts # Disposable infrastructure
│   │   │   └── frontend-stack.ts     # Streamlit deployment
│   │   ├── constructs/
│   │   │   ├── persistent-storage.ts # S3 bucket with protection
│   │   │   ├── vector-database.ts    # OpenSearch Serverless
│   │   │   ├── knowledge-base.ts     # Bedrock KB configuration
│   │   │   └── monitoring.ts         # CloudWatch dashboards
│   │   └── utils/
│   │       ├── config.ts             # Environment configuration
│   │       └── helpers.ts            # Common utilities
│   
├── Frontend (Streamlit)
│   ├── app.py                        # Main Streamlit application
│   ├── components/
│   │   ├── chat_interface.py         # Chat UI components
│   │   ├── document_manager.py       # Document upload/management
│   │   ├── analytics.py              # Usage analytics
│   │   └── system_status.py          # System health monitoring
│   ├── utils/
│   │   ├── bedrock_client.py         # AWS Bedrock integration
│   │   └── config_loader.py          # Load CDK outputs
│   └── assets/
│       └── sample-documents/         # Initial knowledge base content
│
├── Scripts & Automation
│   ├── deploy.sh                     # Deployment
│
├── Documentation
│   ├── docs/
│   │   ├── DEPLOYMENT.md            # Deployment guide
│   │   ├── ARCHITECTURE.md          # Architecture deep-dive
│   │   └── TROUBLESHOOTING.md       # Common issues
│   └── README.md                    # This file
│
└── Configuration
    ├── cdk.json                     # CDK configuration
    ├── package.json                 # Node.js dependencies
    ├── requirements.txt             # Python dependencies
    └── tsconfig.json               # TypeScript configuration
```

## Key Features

### Persistent Document Storage
- **Protected S3 Bucket**: Survives infrastructure teardowns
- **Cross-region Replication**: Automatic backup to different region
- **Versioning**: Track document changes over time
- **Lifecycle Policies**: Automatic cost optimization
- **Encryption**: KMS encryption at rest and in transit

### Rapid Infrastructure Iteration
- **Disposable Resources**: Rebuild OpenSearch, Bedrock KB in minutes
- **Environment Isolation**: Separate dev/staging/prod deployments
- **Zero-downtime Updates**: Blue/green deployment support
- **Cost Optimization**: Intelligent scaling and resource management

### Production-Ready Frontend
- **Multi-page Streamlit App**: Chat, Document Management, Analytics
- **Real-time Status**: Infrastructure health monitoring
- **Advanced Chat Features**: 
  - Source citations with confidence scores
  - Message regeneration and feedback
  - Model selection and parameter tuning
  - Conversation export/import
- **Document Management**: 
  - Drag-and-drop upload
  - Bulk operations
  - Format validation
  - Ingestion monitoring

### Comprehensive Monitoring
- **CloudWatch Dashboards**: System metrics and KPIs
- **Custom Alarms**: Automated alerting for issues
- **Usage Analytics**: Query patterns and performance
- **Health Scoring**: Overall system health assessment

## Configuration

### Environment-Specific Settings

```typescript
// config.ts - Environment configuration
const environmentConfigs = {
  dev: {
    enableMfaDelete: false,
    enableReplication: false,
    enableDetailedMonitoring: false,
    maxConcurrentIngestions: 2,
  },
  staging: {
    enableMfaDelete: false,
    enableReplication: true,
    enableDetailedMonitoring: true,
    maxConcurrentIngestions: 3,
    backupRegion: 'us-west-2',
  },
  prod: {
    enableMfaDelete: true,
    enableReplication: true,
    enableDetailedMonitoring: true,
    enableVpcEndpoints: true,
    maxConcurrentIngestions: 10,
    backupRegion: 'us-west-2',
  },
};
```

### Environment Variables

```bash
# Core Configuration
ENVIRONMENT=dev                    # dev, staging, prod
REGION=us-east-1                  # AWS region
EMBEDDING_MODEL=amazon.titan-embed-text-v1
CHUNK_SIZE=1000                   # Document chunk size
CHUNK_OVERLAP=200                 # Chunk overlap
VECTOR_DIMENSIONS=1536            # Vector dimensions

# Optional Configuration
ALERT_EMAIL=admin@company.com     # Alert notifications
FRONTEND_DOMAIN=rag.company.com   # Custom domain
KMS_KEY_ID=alias/rag-demo-key    # Custom KMS key
```

## Deployment Strategies

### Development Workflow
```bash
# Quick iteration cycle
cdk diff                          # Review changes
cdk deploy RagDemoInfrastructureStack-dev    # Deploy infrastructure only
# Test and iterate...
cdk destroy RagDemoInfrastructureStack-dev   # Clean up (storage preserved)
```

### Production Deployment
```bash
# Full production deployment
./scripts/deploy.sh prod us-east-1 production

# Blue/green deployment
./scripts/deploy-blue-green.sh prod

# Disaster recovery
./scripts/backup.sh prod
./scripts/restore.sh prod us-west-2
```

### Multi-Environment Management
```bash
# Deploy to all environments
./scripts/deploy.sh dev
./scripts/deploy.sh staging  
./scripts/deploy.sh prod

# Environment-specific overrides
export EMBEDDING_MODEL=anthropic.claude-v2
./scripts/deploy.sh staging
```

## Monitoring & Observability

### CloudWatch Dashboards
- **Query Metrics**: Volume, latency, success rate
- **Ingestion Monitoring**: Job status, processing time
- **System Health**: Component status, error rates
- **Cost Tracking**: Usage patterns, optimization opportunities

### Custom Metrics
```python
# Example custom metrics published by the application
cloudwatch.put_metric_data(
    Namespace=f'RAG-Demo/{environment}',
    MetricData=[
        {
            'MetricName': 'QueryLatency',
            'Value': response_time,
            'Unit': 'Seconds',
        },
        {
            'MetricName': 'UserSatisfaction',
            'Value': feedback_score,
            'Unit': 'Count',
        }
    ]
)
```

### Alarms & Notifications
- **High Error Rate**: >5% query failures
- **Slow Queries**: >10 second response time
- **System Health**: <70% health score
- **Cost Alerts**: Unusual usage patterns

## Security & Compliance

### Security Features
- **Encryption**: All data encrypted in transit and at rest
- **IAM Least Privilege**: Minimal required permissions
- **VPC Endpoints**: Private network communication (prod)
- **MFA Delete**: Protection against accidental deletion (prod)
- **CloudTrail**: Complete audit logging

### Compliance Considerations
- **Data Residency**: Configurable regions for data locality
- **Retention Policies**: Automated data lifecycle management
- **Access Controls**: Fine-grained permission management
- **Audit Trails**: Comprehensive logging and monitoring

## Cost Optimization

### Intelligent Scaling
- **S3 Intelligent Tiering**: Automatic storage class transitions
- **OpenSearch Serverless**: Pay-per-use vector database
- **Lambda**: Serverless compute with automatic scaling
- **Lifecycle Policies**: Automated cleanup of old data

### Cost Monitoring
```bash
# View cost breakdown by environment
aws ce get-cost-and-usage \
  --time-period Start=2023-01-01,End=2023-12-31 \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --group-by Type=DIMENSION,Key=SERVICE

# Set up cost alerts
aws budgets create-budget \
  --account-id $ACCOUNT_ID \
  --budget file://budget-config.json
```

## Testing

### Unit Tests
```bash
npm test                          # Run CDK unit tests
pytest frontend/tests/           # Run frontend tests
```

### Integration Tests
```bash
# Deploy to test environment
./scripts/deploy.sh test

# Run integration tests
python scripts/test-integration.py --environment test

# Cleanup test environment
cdk destroy --all --profile test
```

### Load Testing
```bash
# Simulate high query volume
python scripts/load-test.py \
  --endpoint $FRONTEND_URL \
  --concurrent-users 50 \
  --duration 300
```

## Troubleshooting

### Common Issues

#### 1. "Stack does not exist" Error
```bash
# Check if stack was deployed
aws cloudformation describe-stacks --stack-name RagDemoStorageStack-dev

# Redeploy if needed
cdk deploy RagDemoStorageStack-dev
```

#### 2. OpenSearch Collection Not Ready
```bash
# Check collection status
aws opensearchserverless list-collections

# Wait for ACTIVE status before proceeding
```

#### 3. Knowledge Base Ingestion Fails
```bash
# Check ingestion job status
aws bedrock-agent list-ingestion-jobs \
  --knowledge-base-id $KB_ID

# Restart ingestion
python scripts/trigger-ingestion.py --knowledge-base-id $KB_ID
```

#### 4. Frontend Can't Connect
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

## Contributing

### Development Setup
```bash
# Fork and clone the repository
git clone https://github.com/your-username/rag-demo-cdk.git
cd rag-demo-cdk

# Create feature branch
git checkout -b feature/your-feature-name

# Install dependencies
npm install
pip install -r requirements.txt

# Run tests
npm test
pytest

# Deploy to dev environment for testing
./scripts/deploy.sh dev
```

### Code Quality
```bash
# Lint TypeScript
npm run lint

# Format code
npm run format

# Type checking
npm run type-check

# Python linting
flake8 frontend/
black frontend/
```

## Roadmap

### Upcoming Features
- [ ] **Multi-modal Support**: Image and audio document processing
- [ ] **Advanced RAG**: Hybrid search, re-ranking, context compression
- [ ] **Authentication**: Cognito integration for user management
- [ ] **Multi-tenancy**: Isolated knowledge bases per organization
- [ ] **Advanced Analytics**: Query optimization recommendations
- [ ] **API Extensions**: REST API for external integrations

### Performance Improvements
- [ ] **Caching Layer**: Redis for frequent queries
- [ ] **Parallel Processing**: Concurrent document ingestion
- [ ] **Edge Deployment**: CloudFront integration
- [ ] **Model Optimization**: Fine-tuned embedding models


## Support

- **Issues**: [GitHub Issues](https://github.com/matoblac/rag-demo-cdk/issues)

---

<div align="center">
  <b>Built with ❤️ using AWS CDK</b><br>
  <i>Enterprise-ready RAG for the modern cloud</i>
</div> 