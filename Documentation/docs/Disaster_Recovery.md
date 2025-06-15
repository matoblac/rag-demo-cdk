# What is Cross-Region Replication?

**Cross-Region Replication** automatically copies your documents to a **second AWS region** for disaster recovery:

```
Primary Region (us-east-1)          Backup Region (us-west-2)
┌─────────────────────────┐        ┌─────────────────────────┐
│  📄 documents/file1.pdf │ ──────▶ │  📄 documents/file1.pdf │
│  📄 documents/file2.txt │ ──────▶ │  📄 documents/file2.txt │
│  📄 documents/file3.md  │ ──────▶ │  📄 documents/file3.md  │
└─────────────────────────┘        └─────────────────────────┘
     Main S3 Bucket                    Backup S3 Bucket
```

**What it does:**
- **Automatic Copying**: Every document uploaded to your main bucket is **automatically copied** to a backup bucket in `us-west-2`
- **Real-time Sync**: Happens within **minutes** of upload
- **Disaster Recovery**: If `us-east-1` goes down, your documents are safe in `us-west-2`
- **Encrypted Replication**: Backup copies maintain the same encryption
- **Cost Optimized**: Backup bucket uses cheaper storage classes (Standard-IA → Glacier)

**Why it matters:**
```
❌ Dev:     Single region only - if us-east-1 fails, documents are lost
✅ Staging: Documents replicated to us-west-2 - protected against regional outages  
✅ Prod:    Documents replicated to us-west-2 - enterprise disaster recovery
```

**Real Example:**
```bash
# Deploy to staging (enables replication)
./scripts/deploy.sh staging

# Upload a document in us-east-1
aws s3 cp mydoc.pdf s3://rag-demo-documents-staging-123/documents/

# Within minutes, it's automatically copied to us-west-2
aws s3 ls s3://rag-demo-backup-staging-123/documents/
# Shows: mydoc.pdf (replicated copy)
```

**Cost Impact:**
- **Dev**: $10/month (single region)  
- **Staging/Prod**: $15/month (main + backup regions, but backup uses cheaper storage)

**Disaster Recovery Scenario:**
```bash
# 🚨 Disaster: us-east-1 region is down!
# Your main bucket is inaccessible, but documents are safe in us-west-2

# 1. Deploy RAG infrastructure in backup region
export DOCUMENTS_BUCKET_NAME=rag-demo-backup-prod-123  # Use backup bucket
./scripts/deploy.sh prod us-west-2

# 2. Your RAG system is now running in us-west-2 with all documents intact!
# 3. When us-east-1 recovers, you can switch back or keep running in us-west-2
```

**Automatic Replication Setup:**
When you deploy with `enableReplication: true`, the CDK automatically:
1. Creates a backup S3 bucket in the backup region (`us-west-2`)
2. Sets up IAM roles for cross-region replication
3. Configures S3 replication rules to copy all `documents/` objects
4. Encrypts replicated objects with the same KMS key
5. Applies lifecycle policies to optimize backup storage costs
