### **What Happens When You Deploy**

#### **Example 1: Default Development Deployment**
```bash
./scripts/deploy.sh dev
```
**Result:**
- ✅ Uses all defaults (Titan model, 1000 char chunks, public access)
- ✅ Creates: `rag-demo-documents-dev-1703123456789`
- ✅ OpenSearch: `rag-demo-collection-dev`
- 🔓 Frontend: **Public access** (with warning)
- ❌ No monitoring, no replication, no MFA delete

#### **Example 2: Secure Production Deployment**
```bash
export ALLOWED_IPS='["1.2.3.4/32"]'
./scripts/deploy.sh prod
```
**Result:**
- ✅ Uses prod defaults (MFA delete, VPC endpoints, replication)
- ✅ Creates: `rag-demo-documents-prod-1703123456789`
- ✅ Backup region: `us-west-2`
- 🔒 Frontend: **Restricted to your IP only**
- ✅ Full monitoring, cost alerts, 10 concurrent ingestions

#### **Example 3: Custom Model Configuration**
```bash
export EMBEDDING_MODEL='cohere.embed-english-v3'
export VECTOR_DIMENSIONS='1024'
export CHUNK_SIZE='500'
export ALLOWED_IPS='["192.168.1.0/24"]'    # Home network
./scripts/deploy.sh staging
```
**Result:**
- ✅ Uses Cohere model with 1024 dimensions
- ✅ Smaller 500-character chunks
- 🔒 Frontend: **Accessible from home network only**
- ✅ Staging defaults (replication, monitoring, 3 concurrent ingestions)

### **🔍 Configuration Validation**

The system automatically validates your configuration:

```typescript
// Automatic checks:
✅ Chunk size must be positive
✅ Chunk overlap must be less than chunk size  
✅ Vector dimensions must match selected model
✅ Backup region must differ from primary region
✅ Document size must be between 0-1000 MB
```

### **📱 Runtime Configuration Discovery**

Check your active configuration:

```bash
# View current CDK outputs
cat cdk-outputs-*.json

# Check SSM parameters
aws ssm get-parameters-by-path --path "/rag-demo/dev/"

# View Lambda environment variables
aws lambda get-function-configuration --function-name rag-demo-streamlit-app-dev
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