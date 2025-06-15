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