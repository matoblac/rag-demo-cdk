# RAG Demo CDK - Enterprise Knowledge Base

[![AWS](https://img.shields.io/badge/AWS-Bedrock-orange)](https://aws.amazon.com/bedrock/)
[![CDK](https://img.shields.io/badge/CDK-TypeScript-blue)](https://aws.amazon.com/cdk/)
[![Streamlit](https://img.shields.io/badge/Frontend-Streamlit-red)](https://streamlit.io/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## What is This Project?

**RAG Demo CDK** is a production-ready **Retrieval Augmented Generation (RAG)** system that allows you to chat with your documents using AI. Think of it as creating your own "ChatGPT" but trained on your company's documents and knowledge.

### What is RAG?
**RAG** combines the power of:
- **Document Search**: Finding relevant information from your document library
- **AI Generation**: Using that information to generate intelligent, contextual responses
- **Source Citations**: Always showing where answers came from for trust and verification

### Real-World Use Cases
- **Customer Support**: Chat with product manuals, FAQs, and knowledge bases
- **Legal Research**: Query contracts, policies, and legal documents
- **Technical Documentation**: Get answers from API docs, troubleshooting guides
- **Training & Onboarding**: Interactive learning from company handbooks
- **Research & Analysis**: Extract insights from reports and academic papers

## Key Innovation: Persistent + Disposable Architecture

This project solves a critical problem in RAG development: **balancing rapid iteration with data protection**.

| **Persistent (Protected)** | **Disposable (Rapid Iteration)** |
|----------------------------|-----------------------------------|
| 📁 S3 Document Bucket | 🔍 Bedrock Knowledge Base |
| 🔄 Cross-region Backup | 🗂️ OpenSearch Vector Database |
| 🔐 KMS Encryption Keys | ⚡ Lambda Functions |
| 📝 Document Versioning | 🔧 IAM Roles & Policies |
| | 📊 CloudWatch Dashboards |
| | 🌐 API Gateway |

**Why This Matters**: You can tear down and rebuild the entire AI infrastructure in minutes without losing your documents or having to re-upload gigabytes of data.

## 🎯 Demo Scope & Limitations

### ✅ **What This Demo Includes**
- **Complete RAG Chat Interface**: Professional chat UI with source citations
- **Multi-Model AI Support**: Switch between Claude, Titan, and other Bedrock models  
- **Smart Document Retrieval**: Hybrid search with confidence scores and context
- **Persistent Storage**: Documents survive infrastructure teardowns
- **Enterprise Architecture**: Multi-environment deployment with monitoring
- **One-Command Deploy**: Full system running in under 5 minutes

### 🚧 **Demo Limitations (By Design)**
- **No Document Management UI**: Can't browse/manage uploaded documents via web interface
- **No Usage Analytics**: No dashboard showing query patterns or document popularity
- **No System Health UI**: No frontend monitoring of infrastructure status
- **Basic Settings**: Limited user preferences and configuration options
- **Single User**: No authentication or multi-user support

### 🗺️ **Evolution Path**
This demo provides a **solid foundation** that can evolve into a full production system. See our [Roadmap](Documentation/docs/ROADMAP.md) for planned enhancements including document management, analytics dashboards, system monitoring, and enterprise features.

**Perfect for:**
- **Proof of Concepts**: Demonstrate RAG capabilities to stakeholders
- **Learning & Development**: Understand AWS Bedrock and RAG architecture
- **Rapid Prototyping**: Build and test document-based AI applications
- **Architecture Foundation**: Starting point for production applications

## Documentation

- 📖 [Project Configuration](Documentation/docs/CONFIGS.md) - Environment settings and customization
- 🚀 [Deployment Guide](Documentation/docs/DEPLOYMENT.md) - Step-by-step deployment instructions
- 🆘 [Disaster Recovery](Documentation/docs/Disaster_Recovery.md) - Backup and recovery procedures
- 📊 [Monitoring & Observability](Documentation/docs/MONITORING.md) - System monitoring setup
- 🔒 [Security & Compliance](Documentation/docs/SECURITY.md) - Security best practices
- 💰 [Cost Optimization](Documentation/docs/COST.md) - Managing AWS costs
- 🧪 [Testing](Documentation/docs/TESTING.md) - Testing strategies
- 🔧 [Troubleshooting](Documentation/docs/TROUBLESHOOTING.md) - Common issues and solutions
- 🗺️ [Roadmap & Future Features](Documentation/docs/ROADMAP.md) - Planned enhancements and evolution

## Quick Start (5 Minutes to Running System)

### Prerequisites

#### **🔧 Required Software**
```bash
# Check if you have these installed
node --version    # Need 18+
python --version  # Need 3.9+
aws --version     # Need AWS CLI configured
cdk --version     # Need AWS CDK CLI
```

**Install Missing Tools**:
```bash
# Install Node.js (if needed)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install AWS CLI (if needed)
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip && sudo ./aws/install

# Install CDK CLI (if needed)
npm install -g aws-cdk

# Configure AWS credentials (if needed)
aws configure
```

#### **🤖 AWS Bedrock Model Access (CRITICAL!)**

⚠️ **IMPORTANT**: You must request access to AI models before deployment. This takes 2 minutes but is often forgotten!

**Required Models**:
```
🔹 amazon.titan-embed-text-v2:0         (For document embeddings - REQUIRED)
🔹 anthropic.claude-3-5-sonnet-20240620-v1:0  (For chat responses - REQUIRED)
```

**How to Request Access**:

1. **Open AWS Bedrock Console**: https://console.aws.amazon.com/bedrock/
2. **Click "Model access"** in left sidebar
3. **Click "Request model access"**
4. **Check these models**:
   - ✅ Amazon Titan Embed Text v2
   - ✅ Anthropic Claude 3.5 Sonnet
5. **Submit** (usually auto-approved instantly)

**Verify Access**:
```bash
./scripts/check-model-access.sh
# ✅ Should show: "All required models are accessible!"
```

#### **🔑 AWS Permissions**

Your AWS user needs these key permissions:
- `bedrock:*` - For AI models and knowledge base
- `s3:*` - For document storage
- `opensearch-serverless:*` - For vector database
- `iam:*`, `lambda:*`, `cloudformation:*` - For infrastructure

**Quick Permission Check**:
```bash
# Test if you have required permissions
aws bedrock list-foundation-models --region us-east-1 > /dev/null && echo "✅ Bedrock OK" || echo "❌ Need Bedrock permissions"
aws s3 ls > /dev/null && echo "✅ S3 OK" || echo "❌ Need S3 permissions"
```

### 🚀 Deploy in 1 Minute

```bash
# 1. Clone and setup
git clone <your-repo-url>
cd rag-demo-cdk

# 2. Quick permission and model check
./scripts/check-model-access.sh

# 3. Get your IP for security (restricts access to you only)
export ALLOWED_IPS='["$(curl -s ifconfig.me)/32"]'

# 4. One-command deployment to development environment
./scripts/deploy.sh dev

# 🎉 Done! The script will output your RAG chat URL
```

**What Just Happened?**
1. Created a secure S3 bucket for your documents
2. Set up a vector database for AI search
3. Created a Bedrock Knowledge Base for RAG
4. Deployed a beautiful Streamlit chat interface
5. All resources are tagged and monitored

### 🔐 Production Deployment

For production, add proper security:

```bash
# 1. Set your company's allowed IP addresses
export ALLOWED_IPS='["203.0.113.0/24", "198.51.100.50/32"]'  # Replace with actual IPs

# 2. Deploy to production environment
./scripts/deploy.sh prod

# 3. The URL will be restricted to your specified IPs only
```

## Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Documents     │    │   AI Processing  │    │   User Access   │
│                 │    │                  │    │                 │
│  📁 S3 Bucket   │───▶│  🤖 Bedrock KB   │───▶│  💬 Streamlit   │
│  🔐 Encrypted   │    │  🔍 Vector DB    │    │  🌐 Web UI      │
│  🔄 Versioned   │    │  ⚡ Lambda Fns   │    │  🔒 IP Restricted│
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### AWS Services Used

| Service | Purpose | Why We Use It |
|---------|---------|---------------|
| **Amazon Bedrock** | AI/ML foundation models | Provides Claude/Titan models without managing infrastructure |
| **Bedrock Knowledge Base** | RAG orchestration | Handles document ingestion, chunking, and retrieval |
| **OpenSearch Serverless** | Vector database | Stores document embeddings for semantic search |
| **S3** | Document storage | Durable, versioned storage for source documents |
| **Lambda** | Serverless compute | Handles document processing and API endpoints |
| **Streamlit** | Web frontend | Rapid development of interactive chat interface |
| **CloudWatch** | Monitoring | Tracks performance, costs, and system health |

## Project Structure

```
rag-demo-cdk/
│
├── 🏗️ Infrastructure (CDK TypeScript)
│   ├── bin/rag-demo-cdk.ts              # CDK app entry point
│   ├── lib/
│   │   ├── stacks/
│   │   │   ├── storage-stack.ts          # Persistent S3 resources
│   │   │   ├── infrastructure-stack.ts   # Disposable AI infrastructure
│   │   │   └── frontend-stack.ts         # Streamlit deployment
│   │   ├── constructs/
│   │   │   ├── vector-database.ts        # OpenSearch Serverless setup
│   │   │   ├── knowledge-base.ts         # Bedrock KB configuration
│   │   │   └── monitoring.ts             # CloudWatch dashboards
│   │   └── utils/
│   │       ├── config.ts                 # Environment configuration
│   │       └── helpers.ts                # Common utilities
│   
├── 💻 Frontend (Python Streamlit)
│   ├── app.py                            # Main Streamlit application
│   ├── components/
│   │   └── chat_interface.py             # Chat UI with citations
│   ├── utils/
│   │   ├── bedrock_client.py             # AWS Bedrock integration
│   │   └── config_loader.py              # Load infrastructure outputs
│   └── requirements.txt                  # Python dependencies
│
├── 🛠️ Scripts & Automation
│   ├── deploy.sh                         # Main deployment orchestration
│   ├── check-model-access.sh             # Verify Bedrock model access
│   └── get-my-ip.sh                      # Get current IP for security
│
├── 📚 Documentation
│   └── docs/                             # Comprehensive guides
│
└── ⚙️ Configuration
    ├── cdk.json                          # CDK settings
    ├── package.json                      # Node.js dependencies
    └── tsconfig.json                     # TypeScript configuration
```

## Key Features

### 🔒 Enterprise Security
- **KMS Encryption**: All data encrypted at rest and in transit
- **IP Restrictions**: Control who can access the system
- **IAM Roles**: Least-privilege access controls
- **VPC Security**: Network isolation for sensitive workloads

### 📊 Production Monitoring
- **Real-time Dashboards**: System health and performance metrics
- **Cost Tracking**: Monitor AWS spending by component
- **Usage Analytics**: Query patterns and user behavior
- **Automated Alerts**: Get notified of issues before users do

### 🚀 Developer Experience
- **One-Command Deploy**: Get running in under 5 minutes
- **Hot Reloading**: Rapid iteration on frontend changes
- **Environment Isolation**: Separate dev/staging/prod deployments
- **Infrastructure as Code**: Version control your entire stack

### 💡 Advanced RAG Features
- **Source Citations**: Every answer shows exactly where it came from
- **Confidence Scores**: Know how certain the AI is about answers
- **Multi-Model Support**: Switch between different AI models
- **Document Versioning**: Track changes to your knowledge base
- **Bulk Operations**: Upload and manage hundreds of documents

## Using Your RAG System

### Adding Documents

> **📋 Note**: This demo doesn't include a document management interface. You'll see which documents are used when they appear as sources in chat responses, but there's no UI to browse all uploaded documents. See the [Roadmap](Documentation/docs/ROADMAP.md) for planned document management features.

**Option 1: S3 Direct Upload** (Primary Method)
```bash
# Upload a single document
aws s3 cp my-document.pdf s3://your-bucket-name/documents/

# Upload entire folder (bulk upload)
aws s3 sync ./my-documents/ s3://your-bucket-name/documents/

# Verify upload
aws s3 ls s3://your-bucket-name/documents/ --recursive

# Bedrock will automatically process new documents
```

**Option 2: AWS Console Upload**
1. Go to AWS S3 Console
2. Navigate to your documents bucket  
3. Upload files to the `documents/` folder
4. Bedrock Knowledge Base auto-processes new files

**Supported Formats**: PDF, Word, PowerPoint, Text, Markdown, HTML

**Document Visibility**: Documents will appear as **source citations** in chat responses when relevant to your questions. To see all uploaded documents, use AWS CLI or S3 Console.

### Chatting with Documents

1. **Ask Questions**: Type natural language questions about your documents
2. **Review Sources**: Click on citations to see original document excerpts  
3. **Adjust Settings**: Change AI model, temperature, and response length
4. **Export Conversations**: Save important Q&A sessions

**Example Queries**:
- "What are the main security requirements in our API documentation?"
- "Summarize the key points from the Q3 financial report"
- "How do I troubleshoot database connection issues according to our runbook?"

## Development Workflow

### 🎯 **For Demo Usage (Recommended)**

Most users should use the **deployed version** rather than local development:

```bash
# Deploy complete system (includes frontend)
./scripts/deploy.sh dev

# ✅ Access your RAG system via the provided URL
# ✅ No local setup required
# ✅ Everything works out of the box
```

### 🛠️ **For Development (Advanced)**

#### **Quick Local Development (No Infrastructure Required)**

For frontend UI development without deploying infrastructure:

```bash
# 1. Set up Python environment
cd frontend/
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# 2. Install Python dependencies
pip install -r requirements.txt

# 3. Run with placeholder configuration
streamlit run app.py
# ✅ App starts in "Local Development Mode"
# ✅ Shows placeholder responses instead of real RAG
# ✅ Perfect for UI development and testing

# Opens in browser at http://localhost:8501
```

#### **Full Local Development (With Real Backend)**

For testing against deployed infrastructure:

**Prerequisites**: Deploy the infrastructure first:
```bash
# Deploy backend infrastructure first
./scripts/deploy.sh dev
# Note the outputs: Knowledge Base ID, S3 bucket, etc.
```

**Connect Local Frontend to Deployed Backend**:
```bash
# 1. Set up Python environment (if not done above)
cd frontend/
python -m venv venv
source venv/bin/activate

# 2. Set up environment variables (get values from CDK outputs)
export AWS_REGION=us-east-1
export KNOWLEDGE_BASE_ID=your-kb-id-from-deployment
export DOCUMENTS_BUCKET=your-bucket-name-from-deployment
export ENVIRONMENT=dev

# 3. Run frontend locally with real backend
streamlit run app.py
# ✅ Full RAG functionality with real Knowledge Base
# ✅ Real document search and AI responses

# 4. Deploy changes when ready
./scripts/deploy.sh dev
```

### Adding New Features
```bash
# 1. Create feature branch
git checkout -b feature/new-chat-feature

# 2. Develop and test locally
npm run test          # CDK tests
pytest frontend/      # Python tests

# 3. Deploy to dev environment
./scripts/deploy.sh dev

# 4. Create pull request when ready
```

## Cost Management

**Typical Monthly Costs** (estimated):
- **Development**: $20-50/month (light usage)
- **Production**: $100-500/month (depends on query volume)

**Cost Breakdown**:
- Bedrock Knowledge Base: $0.10 per 1K documents ingested
- Bedrock Model Usage: $0.0008 per 1K input tokens, $0.024 per 1K output tokens
- OpenSearch Serverless: ~$300/month for always-on collection
- S3 Storage: $0.023 per GB per month
- Lambda: First 1M requests free, then $0.20 per 1M requests

**Cost Optimization Tips**:
- Use development environment for testing (tears down easily)
- Monitor usage in CloudWatch dashboards
- Set up billing alerts
- Review the [Cost Optimization Guide](Documentation/docs/COST.md)

## Troubleshooting

### Common Issues

**❌ "Access denied for model amazon.titan-embed-text-v2:0"**
```bash
# Solution: Request model access in Bedrock console
./scripts/check-model-access.sh
# Then go to: https://console.aws.amazon.com/bedrock/ → Model access
```

**❌ "Cannot assume role for CDK deployment"**  
```bash
# Solution: Bootstrap CDK in your account/region
cdk bootstrap aws://ACCOUNT-ID/REGION
```

**❌ "Streamlit app shows 'Configuration not found'"**
```bash
# Solution: Deploy infrastructure stack first
./scripts/deploy.sh dev
# Frontend depends on infrastructure outputs
```

**❌ "Documents uploaded but not searchable"**
```bash
# Solution: Check ingestion job status in AWS Console
# Go to: AWS Console → Bedrock → Knowledge bases → Your KB → Ingestion jobs
# Note: Demo doesn't include ingestion status UI (see Roadmap)
```

**❌ "Can't see my uploaded documents in the interface"**
```bash
# Expected behavior: Demo has no document management UI
# To verify uploads: aws s3 ls s3://your-bucket/documents/ --recursive
# Documents appear as sources when relevant to chat queries
# See Roadmap for planned document management features
```

**❌ "streamlit: command not found" when running locally**
```bash
# Solution: Install Python dependencies first
cd frontend/
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
streamlit run app.py

# Alternative: Use deployed frontend instead of local development
./scripts/deploy.sh dev  # Then use the deployed URL
```

**❌ "Missing required configuration fields: ['knowledgeBaseId']"**
```bash
# Solution 1: The app now supports local development mode!
cd frontend/
source venv/bin/activate
streamlit run app.py
# ✅ Will now start with placeholder values and show development mode banner

# Solution 2: Deploy infrastructure first (recommended for real functionality)
./scripts/deploy.sh dev
# Then use the deployed URL for full RAG capabilities
```

For more issues, see [Troubleshooting Guide](Documentation/docs/TROUBLESHOOTING.md).

## Contributing

### Getting Started
```bash
# 1. Fork the repository
# 2. Clone your fork
git clone https://github.com/YOUR-USERNAME/rag-demo-cdk.git
cd rag-demo-cdk

# 3. Install CDK dependencies
npm install

# 4. Set up Python environment for frontend
cd frontend/
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
cd ..

# 5. Create feature branch
git checkout -b feature/your-feature-name

# 6. Deploy to your dev environment
./scripts/deploy.sh dev
```

### Code Quality Standards
```bash
# TypeScript linting and formatting
npm run lint
npm run format
npm run type-check

# Python code quality
cd frontend/
black .
flake8 .
pytest
```

### Pull Request Process
1. Create feature branch from `main`
2. Make changes with tests
3. Update documentation if needed
4. Deploy and test in dev environment
5. Create PR with clear description
6. Address review feedback
7. Merge after approval

## Support & Community

- **🐛 Bug Reports**: [GitHub Issues](https://github.com/matoblac/rag-demo-cdk/issues)
- **💡 Feature Requests**: [GitHub Discussions](https://github.com/matoblac/rag-demo-cdk/discussions)
- **📖 Documentation**: [Project Wiki](https://github.com/matoblac/rag-demo-cdk/wiki)
- **💬 Questions**: Use GitHub Discussions or create an issue

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with [AWS CDK](https://aws.amazon.com/cdk/) for infrastructure as code
- Powered by [Amazon Bedrock](https://aws.amazon.com/bedrock/) for AI capabilities  
- Frontend created with [Streamlit](https://streamlit.io/) for rapid development
- Uses [OpenSearch Serverless](https://aws.amazon.com/opensearch-service/features/serverless/) for vector search

---

<div align="center">
  <b>🚀 Ready to build your own ChatGPT for documents?</b><br>
  <i>Deploy in 5 minutes with one command!</i><br><br>
  <code>./scripts/deploy.sh dev</code>
</div> 