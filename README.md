# RAG Demo CDK - Enterprise Knowledge Base

[![AWS](https://img.shields.io/badge/AWS-Bedrock-orange)](https://aws.amazon.com/bedrock/)
[![CDK](https://img.shields.io/badge/CDK-TypeScript-blue)](https://aws.amazon.com/cdk/)
[![Streamlit](https://img.shields.io/badge/Frontend-Streamlit-red)](https://streamlit.io/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

A **production-ready** Retrieval Augmented Generation (RAG) demo using AWS CDK with TypeScript that creates a Bedrock Knowledge Base, OpenSearch Serverless vector database, and Streamlit frontend. The key feature is **persistent document storage** - the S3 bucket with knowledge base articles survives infrastructure teardowns for rapid iteration.

## Documentation

1. [Project Runtime Configurations](Documentation/docs/CONFIGS.md)
2. [Deployment](Documentation/docs/DEPLOYMENT.md)
3. [Disaster Recovery](Documentation/docs/DISASTER_RECOVERY.md)
4. [Monitoring & Observability](Documentation/docs/MONITORING.md)
5. [Security & Compliance](Documentation/docs/SECURITY.md)
6. [Cost Optimization](Documentation/docs/COST.md)
7. [Testing](Documentation/docs/TESTING.md)
8. [Troubleshooting](Documentation/docs/TROUBLESHOOTING.md)

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

#### **🔧 Required Software**
- **Node.js** 18+ and npm
- **Python** 3.9+ and pip  
- **AWS CLI** configured with appropriate permissions
- **AWS CDK** CLI (`npm install -g aws-cdk`)

#### **🤖 AWS Bedrock Model Access (CRITICAL!)**

**⚠️ IMPORTANT**: In a **new AWS account**, you must **request access** to Bedrock foundation models before deployment. This project uses these models:

**Required Models (Request Access):**
```
🔹 Embedding Models:
   • amazon.titan-embed-text-v1      (Default - Required)
   • cohere.embed-english-v3         (Alternative)
   • cohere.embed-multilingual-v3    (Alternative)

🔹 Text Generation Models:
   • anthropic.claude-3-sonnet-20240229-v1:0    (Default chat - Required)
   • anthropic.claude-3-haiku-20240307-v1:0     (Alternative)
   • amazon.titan-text-express-v1               (Alternative)
```

**How to Request Model Access:**

1. **Go to AWS Bedrock Console**:
   ```bash
   # Open in your browser
   https://console.aws.amazon.com/bedrock/
   ```

2. **Navigate to Model Access**:
   - Click "**Model access**" in the left sidebar
   - Click "**Request model access**"

3. **Request Required Models**:
   ```
   ✅ Amazon Titan Embed Text v1        (REQUIRED)
   ✅ Anthropic Claude 3 Sonnet         (REQUIRED)
   ✅ Cohere Command                     (Optional)
   ✅ Amazon Titan Text                  (Optional)
   ```

4. **Submit Request**:
   - Fill out the use case form: "**Building RAG demo for document search**"
   - Most requests are **auto-approved instantly**
   - Some may take **up to 24 hours**

5. **Verify Access**:
   ```bash
   # Check if models are available
   aws bedrock list-foundation-models --region us-east-1
   
   # Should show: "modelLifecycle": "ACTIVE" for requested models
   ```

**❌ What Happens If You Skip This:**
```bash
./scripts/deploy.sh dev
# ❌ Error: "AccessDeniedException: Access denied for model amazon.titan-embed-text-v1"
# ❌ Knowledge Base creation fails
# ❌ Chat interface returns errors
```

**✅ Alternative: Use Different Models**
If you have access to different models, override them:
```bash
export EMBEDDING_MODEL='cohere.embed-english-v3'
export VECTOR_DIMENSIONS='1024'
./scripts/deploy.sh dev
```

#### **🔑 AWS Permissions**

Your AWS user/role needs these permissions:
```json
{
  "Version": "2012-10-17", 
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:*",
        "s3:*", 
        "opensearch-serverless:*",
        "iam:*",
        "lambda:*",
        "apigateway:*",
        "cloudformation:*",
        "ssm:*",
        "kms:*"
      ],
      "Resource": "*"
    }
  ]
}
```

### 1-Minute Deployment

```bash
# 1. Clone and setup
git clone https://github.com/matoblac/rag-demo-cdk.git
cd rag-demo-cdk

# 2. Check Bedrock model access (CRITICAL STEP!)
./scripts/check-model-access.sh

# If models aren't accessible, go to:
# https://console.aws.amazon.com/bedrock/ → Model access → Request access

# 3. Get your IP and set security restriction
./scripts/get-my-ip.sh
export ALLOWED_IPS='["YOUR_IP/32"]'  # Replace with your actual IP

# 4. Deploy to development
./scripts/deploy.sh dev

# 5. Access your RAG demo at the provided URL!
```

### **Secure Production Deployment**

**⚠️ SECURITY WARNING**: The frontend is publicly accessible by default! For production, restrict access to your IP:

```bash
# 1. Get your current IP address
./scripts/get-my-ip.sh

# 2. Set IP restriction (replace with your actual IP)
export ALLOWED_IPS='["1.2.3.4/32"]'

# 3. Deploy to production with IP restriction
./scripts/deploy.sh prod

# ✅ Now only YOUR IP can access the frontend!
```

**IP Restriction Examples**:
- Single IP: `["1.2.3.4/32"]`
- Multiple IPs: `["1.2.3.4/32", "5.6.7.8/32"]`
- IP range/subnet: `["192.168.1.0/24"]`
- Office + Home: `["203.0.113.0/24", "198.51.100.50/32"]`

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
│   ├── deploy.sh                     # Main deployment script
│   ├── check-model-access.sh         # Verify Bedrock model access
│   └── get-my-ip.sh                  # Get current IP for security
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
- **Infrastructure as Code**: Rebuild entire stack quickly with CDK
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




## Support

- **Issues**: [GitHub Issues](https://github.com/matoblac/rag-demo-cdk/issues)

---

<div align="center">
  <b>Built with ❤️ using AWS CDK</b><br>
  <i>Enterprise-ready RAG for the modern cloud</i>
</div> 