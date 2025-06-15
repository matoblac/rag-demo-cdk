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

Not Configured yet:
* test-integration.py
* unit tests 
* integration tests
* load-test.py