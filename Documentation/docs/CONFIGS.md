## Configuration

### Default Configuration (No .env File Needed!)

**Important**: This project uses **hardcoded TypeScript defaults** with **optional environment variable overrides**. No `.env` file is required!

#### Base Defaults (Applied to All Environments)

When you deploy without setting any environment variables, these defaults are used:

```typescript
// AI & Knowledge Base
embeddingModel: 'amazon.titan-embed-text-v1'    // Titan embeddings
chunkSize: 1000                                   // Document chunk size (chars)
chunkOverlap: 200                                // Chunk overlap (chars)
maxTokens: 4096                                  // Max tokens per chunk
vectorDimensions: 1536                           // Vector dimensions

// Document Processing
maxDocumentSize: 50                              // 50MB file size limit
supportedFormats: ['pdf', 'docx', 'txt', 'md', 'html']
enableOcr: true                                  // OCR processing enabled

// Storage & Security
enableVersioning: true                           // S3 versioning enabled
enableEncryption: true                          // Encryption enabled
enableCustomDomain: false                       // No custom domain

// Performance
enableCaching: true                              // Response caching enabled
cacheExpirationHours: 24                        // 24-hour cache TTL
```

#### Environment-Specific Defaults

Each environment gets different defaults optimized for its use case:

| Setting | **dev** | **staging** | **prod** |
|---------|---------|-------------|----------|
| **🔒 Security** | | | |
| MFA Delete Protection | ❌ Disabled | ❌ Disabled | ✅ **Enabled** |
| VPC Endpoints | ❌ Disabled | ❌ Disabled | ✅ **Enabled** |
| **🔄 Backup & Replication** | | | |
| Cross-Region Replication | ❌ Disabled | ✅ **Enabled** | ✅ **Enabled** |
| Backup Region | ❌ None | ✅ **us-west-2** | ✅ **us-west-2** |
| **📊 Monitoring** | | | |
| Detailed Monitoring | ❌ Disabled | ✅ **Enabled** | ✅ **Enabled** |
| Cost Alerts | ❌ Disabled | ✅ **Enabled** | ✅ **Enabled** |
| **⚡ Performance** | | | |
| Max Concurrent Ingestions | 2 | 3 | **10** |

#### **🚨 Critical Security Default**

```typescript
allowedIps: undefined  // 🚨 FRONTEND IS PUBLIC BY DEFAULT!
```

**This means:**
- **dev**: Warns but allows public access (OK for development)
- **staging**: Warns about security implications
- **prod**: **Forces confirmation** with security warning before allowing public access

### **🛠️ Environment Variable Overrides**

Override any default by setting environment variables **before deployment**:

#### **Core Configuration**
```bash
# AI Model Configuration
export EMBEDDING_MODEL='cohere.embed-english-v3'  # Override default model
export VECTOR_DIMENSIONS='1024'                   # Must match model dimensions
export CHUNK_SIZE='500'                           # Smaller chunks
export CHUNK_OVERLAP='100'                        # Less overlap

# Security (HIGHLY RECOMMENDED)
export ALLOWED_IPS='["1.2.3.4/32"]'              # Restrict to your IP only

# Optional Overrides
export ALERT_EMAIL='admin@company.com'            # Alert notifications
export FRONTEND_DOMAIN='rag.company.com'          # Custom domain
export KMS_KEY_ID='alias/rag-demo-key'           # Custom KMS key
```

#### **Example: Secure Production Deployment**
```bash
# 1. Get your IP
./scripts/get-my-ip.sh

# 2. Configure security and custom settings
export ALLOWED_IPS='["203.0.113.50/32"]'         # Your IP only
export EMBEDDING_MODEL='anthropic.claude-v2'      # Different model
export CHUNK_SIZE='800'                           # Custom chunk size
export ALERT_EMAIL='admin@yourcompany.com'        # Alert email

# 3. Deploy with overrides
./scripts/deploy.sh prod
```

#### **Model Compatibility Matrix**
```typescript
const modelDimensions = {
  'amazon.titan-embed-text-v1': 1536,      // Default
  'cohere.embed-english-v3': 1024,         // Alternative
  'cohere.embed-multilingual-v3': 1024,    // Multi-language
};
```