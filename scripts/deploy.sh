#!/bin/bash

# RAG Demo CDK Deployment Script
# Intelligent deployment orchestration with persistent storage protection

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT=${1:-dev}
REGION=${2:-us-east-1}
PROFILE=${3:-default}

# Validation arrays
VALID_ENVIRONMENTS=("dev" "staging" "prod")
SUPPORTED_REGIONS=("us-east-1" "us-west-2" "eu-west-1" "eu-central-1" "ap-southeast-1" "ap-northeast-1")

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_banner() {
    echo -e "${GREEN}"
    echo "=========================================="
    echo "🚀 RAG Demo CDK Deployment"
    echo "=========================================="
    echo -e "${NC}"
    echo "Environment: $ENVIRONMENT"
    echo "Region:      $REGION"
    echo "Profile:     $PROFILE"
    echo ""
}

validate_inputs() {
    log_info "Validating deployment parameters..."
    
    # Validate environment
    if [[ ! " ${VALID_ENVIRONMENTS[*]} " =~ " ${ENVIRONMENT} " ]]; then
        log_error "Invalid environment: $ENVIRONMENT"
        log_error "Valid environments: ${VALID_ENVIRONMENTS[*]}"
        exit 1
    fi
    
    # Validate region
    if [[ ! " ${SUPPORTED_REGIONS[*]} " =~ " ${REGION} " ]]; then
        log_warning "Region $REGION may not support all required services"
        log_warning "Recommended regions: ${SUPPORTED_REGIONS[*]}"
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
    
    # Security validation for production
    if [[ "$ENVIRONMENT" == "prod" ]] && [[ -z "$ALLOWED_IPS" ]]; then
        log_warning "🔒 SECURITY WARNING: Deploying to production without IP restrictions!"
        log_warning "The frontend will be accessible from ANY IP address on the internet."
        log_warning ""
        log_warning "To restrict access to your IP only:"
        log_warning "1. Run: ./scripts/get-my-ip.sh"
        log_warning "2. Set: export ALLOWED_IPS='[\"YOUR_IP/32\"]'"
        log_warning "3. Re-run this deployment"
        log_warning ""
        read -p "Continue with OPEN ACCESS? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Deployment cancelled. Please set ALLOWED_IPS and try again."
            exit 1
        fi
    fi
    
    # Show IP restriction status
    if [[ ! -z "$ALLOWED_IPS" ]]; then
        log_success "✅ IP restrictions configured: $ALLOWED_IPS"
    else
        if [[ "$ENVIRONMENT" == "dev" ]]; then
            log_info "ℹ️  Open access (no IP restrictions) - OK for development"
        else
            log_warning "⚠️  Open access (no IP restrictions) - Consider security implications"
        fi
    fi
    
    log_success "Validation complete"
}

check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js is required but not installed"
        exit 1
    fi
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        log_error "npm is required but not installed"
        exit 1
    fi
    
    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI is required but not installed"
        exit 1
    fi
    
    # Check CDK
    if ! command -v cdk &> /dev/null; then
        log_error "AWS CDK CLI is required but not installed"
        log_info "Install with: npm install -g aws-cdk"
        exit 1
    fi
    
    # Check Python (for Streamlit frontend)
    if ! command -v python3 &> /dev/null; then
        log_error "Python 3 is required but not installed"
        exit 1
    fi
    
    log_success "All prerequisites satisfied"
}

check_aws_credentials() {
    log_info "Checking AWS credentials..."
    
    # Test AWS credentials
    if ! aws sts get-caller-identity --profile $PROFILE &> /dev/null; then
        log_error "AWS credentials not configured or invalid for profile: $PROFILE"
        log_info "Configure with: aws configure --profile $PROFILE"
        exit 1
    fi
    
    # Get and display identity
    IDENTITY=$(aws sts get-caller-identity --profile $PROFILE --output text)
    ACCOUNT=$(echo $IDENTITY | cut -f1)
    ARN=$(echo $IDENTITY | cut -f2)
    
    log_success "AWS credentials valid"
    log_info "Account: $ACCOUNT"
    log_info "Identity: $ARN"
}

setup_environment() {
    log_info "Setting up deployment environment..."
    
    # Set AWS profile
    export AWS_PROFILE=$PROFILE
    export AWS_REGION=$REGION
    export CDK_DEFAULT_REGION=$REGION
    
    # Environment variables for CDK
    export ENVIRONMENT=$ENVIRONMENT
    
    log_success "Environment configured"
}

install_dependencies() {
    log_info "Installing dependencies..."
    
    # Install Node.js dependencies
    if [ -f "package.json" ]; then
        npm install
        log_success "Node.js dependencies installed"
    else
        log_error "package.json not found in current directory"
        exit 1
    fi
    
    # Install Python dependencies for frontend
    if [ -f "frontend/requirements.txt" ]; then
        log_info "Installing Python dependencies..."
        pip3 install -r frontend/requirements.txt --quiet
        log_success "Python dependencies installed"
    else
        log_warning "frontend/requirements.txt not found, skipping Python dependencies"
    fi
}

bootstrap_cdk() {
    log_info "Bootstrapping CDK (if needed)..."
    
    # Check if already bootstrapped
    BOOTSTRAP_STACK="CDKToolkit-RagDemo"
    
    if aws cloudformation describe-stacks --stack-name $BOOTSTRAP_STACK --profile $PROFILE --region $REGION &> /dev/null; then
        log_info "CDK already bootstrapped in $REGION"
    else
        log_info "Bootstrapping CDK in $REGION..."
        cdk bootstrap --profile $PROFILE --toolkit-stack-name $BOOTSTRAP_STACK \
            --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess
        log_success "CDK bootstrap complete"
    fi
}

deploy_storage_stack() {
    log_info "Deploying storage stack (persistent resources)..."
    
    STORAGE_STACK="RagDemoStorageStack-$ENVIRONMENT"
    
    # Check if storage stack exists
    if aws cloudformation describe-stacks --stack-name $STORAGE_STACK --profile $PROFILE --region $REGION &> /dev/null; then
        log_warning "Storage stack already exists: $STORAGE_STACK"
        log_warning "Persistent storage will NOT be modified to protect data"
        
        read -p "Continue with existing storage? (Y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Nn]$ ]]; then
            log_info "Deployment cancelled by user"
            exit 0
        fi
    else
        log_info "Creating new storage stack: $STORAGE_STACK"
        cdk deploy $STORAGE_STACK \
            --profile $PROFILE \
            --context environment=$ENVIRONMENT \
            --context region=$REGION \
            --require-approval never \
            --outputs-file cdk-outputs-storage.json
        
        log_success "Storage stack deployed successfully"
    fi
}

deploy_infrastructure_stack() {
    log_info "Deploying infrastructure stack (disposable resources)..."
    
    INFRA_STACK="RagDemoInfrastructureStack-$ENVIRONMENT"
    
    # Deploy infrastructure stack
    cdk deploy $INFRA_STACK \
        --profile $PROFILE \
        --context environment=$ENVIRONMENT \
        --context region=$REGION \
        --require-approval never \
        --outputs-file cdk-outputs-infrastructure.json
    
    log_success "Infrastructure stack deployed successfully"
}

wait_for_resources() {
    log_info "Waiting for resources to be ready..."
    
    # Wait for OpenSearch collection to be active
    log_info "Checking OpenSearch Serverless collection status..."
    
    # Get collection name from CDK outputs
    if [ -f "cdk-outputs-infrastructure.json" ]; then
        COLLECTION_NAME=$(python3 -c "
import json
with open('cdk-outputs-infrastructure.json', 'r') as f:
    outputs = json.load(f)
    for stack_outputs in outputs.values():
        if 'CollectionName' in stack_outputs:
            print(stack_outputs['CollectionName'])
            break
" 2>/dev/null)
        
        if [ ! -z "$COLLECTION_NAME" ]; then
            log_info "Waiting for collection '$COLLECTION_NAME' to be active..."
            
            # Wait for collection to be active (max 10 minutes)
            TIMEOUT=600
            ELAPSED=0
            
            while [ $ELAPSED -lt $TIMEOUT ]; do
                STATUS=$(aws opensearchserverless list-collections \
                    --profile $PROFILE \
                    --region $REGION \
                    --query "collectionSummaries[?name=='$COLLECTION_NAME'].status" \
                    --output text 2>/dev/null || echo "UNKNOWN")
                
                if [ "$STATUS" = "ACTIVE" ]; then
                    log_success "OpenSearch collection is active"
                    break
                elif [ "$STATUS" = "FAILED" ]; then
                    log_error "OpenSearch collection deployment failed"
                    exit 1
                else
                    log_info "Collection status: $STATUS (waiting...)"
                    sleep 30
                    ELAPSED=$((ELAPSED + 30))
                fi
            done
            
            if [ $ELAPSED -ge $TIMEOUT ]; then
                log_warning "Timeout waiting for OpenSearch collection"
            fi
        fi
    fi
    
    # Additional wait for Knowledge Base to be ready
    sleep 30
    log_success "Resources are ready"
}

seed_initial_data() {
    log_info "Checking for initial documents..."
    
    # Get bucket name from CDK outputs
    BUCKET_NAME=""
    if [ -f "cdk-outputs-storage.json" ]; then
        BUCKET_NAME=$(python3 -c "
import json
with open('cdk-outputs-storage.json', 'r') as f:
    outputs = json.load(f)
    for stack_outputs in outputs.values():
        if 'DocumentsBucketName' in stack_outputs:
            print(stack_outputs['DocumentsBucketName'])
            break
" 2>/dev/null)
    fi
    
    if [ ! -z "$BUCKET_NAME" ]; then
        # Check if bucket has documents
        OBJECT_COUNT=$(aws s3 ls s3://$BUCKET_NAME/documents/ --profile $PROFILE --region $REGION | wc -l)
        
        if [ $OBJECT_COUNT -eq 0 ]; then
            log_info "No documents found, uploading sample documents..."
            
            # Upload sample documents if they exist
            if [ -d "frontend/assets/sample-documents" ]; then
                aws s3 sync frontend/assets/sample-documents/ s3://$BUCKET_NAME/documents/ \
                    --profile $PROFILE --region $REGION
                log_success "Sample documents uploaded"
            else
                log_warning "No sample documents found in frontend/assets/sample-documents/"
            fi
        else
            log_info "Documents already exist in bucket ($OBJECT_COUNT objects)"
        fi
    else
        log_warning "Could not determine bucket name from CDK outputs"
    fi
}

trigger_ingestion() {
    log_info "Starting Knowledge Base ingestion..."
    
    # Get Knowledge Base ID from CDK outputs
    KB_ID=""
    if [ -f "cdk-outputs-infrastructure.json" ]; then
        KB_ID=$(python3 -c "
import json
with open('cdk-outputs-infrastructure.json', 'r') as f:
    outputs = json.load(f)
    for stack_outputs in outputs.values():
        if 'KnowledgeBaseId' in stack_outputs:
            print(stack_outputs['KnowledgeBaseId'])
            break
" 2>/dev/null)
    fi
    
    if [ ! -z "$KB_ID" ]; then
        # Start ingestion job
        if python3 scripts/trigger-ingestion.py --knowledge-base-id $KB_ID --environment $ENVIRONMENT --region $REGION --profile $PROFILE; then
            log_success "Ingestion job started successfully"
        else
            log_warning "Failed to start ingestion job (may start automatically)"
        fi
    else
        log_warning "Could not determine Knowledge Base ID from CDK outputs"
    fi
}

deploy_frontend_stack() {
    log_info "Deploying frontend stack..."
    
    FRONTEND_STACK="RagDemoFrontendStack-$ENVIRONMENT"
    
    # Deploy frontend stack
    cdk deploy $FRONTEND_STACK \
        --profile $PROFILE \
        --context environment=$ENVIRONMENT \
        --context region=$REGION \
        --require-approval never \
        --outputs-file cdk-outputs-frontend.json
    
    log_success "Frontend stack deployed successfully"
}

display_deployment_info() {
    log_success "🎉 Deployment completed successfully!"
    echo ""
    echo "=========================================="
    echo "📋 Deployment Information"
    echo "=========================================="
    
    # Extract and display key information
    if [ -f "cdk-outputs-frontend.json" ]; then
        FRONTEND_URL=$(python3 -c "
import json
with open('cdk-outputs-frontend.json', 'r') as f:
    outputs = json.load(f)
    for stack_outputs in outputs.values():
        if 'FrontendUrl' in stack_outputs:
            print(stack_outputs['FrontendUrl'])
            break
" 2>/dev/null)
        
        if [ ! -z "$FRONTEND_URL" ]; then
            echo -e "${GREEN}🌐 Frontend URL:${NC} $FRONTEND_URL"
        fi
    fi
    
    if [ -f "cdk-outputs-infrastructure.json" ]; then
        KNOWLEDGE_BASE_ID=$(python3 -c "
import json
with open('cdk-outputs-infrastructure.json', 'r') as f:
    outputs = json.load(f)
    for stack_outputs in outputs.values():
        if 'KnowledgeBaseId' in stack_outputs:
            print(stack_outputs['KnowledgeBaseId'])
            break
" 2>/dev/null)
        
        COLLECTION_ENDPOINT=$(python3 -c "
import json
with open('cdk-outputs-infrastructure.json', 'r') as f:
    outputs = json.load(f)
    for stack_outputs in outputs.values():
        if 'CollectionEndpoint' in stack_outputs:
            print(stack_outputs['CollectionEndpoint'])
            break
" 2>/dev/null)
        
        if [ ! -z "$KNOWLEDGE_BASE_ID" ]; then
            echo -e "${GREEN}🧠 Knowledge Base ID:${NC} $KNOWLEDGE_BASE_ID"
        fi
        
        if [ ! -z "$COLLECTION_ENDPOINT" ]; then
            echo -e "${GREEN}🔍 OpenSearch Endpoint:${NC} $COLLECTION_ENDPOINT"
        fi
    fi
    
    echo ""
    echo "=========================================="
    echo "📚 Next Steps"
    echo "=========================================="
    echo "1. 📄 Upload documents to the S3 bucket"
    echo "2. ⏳ Wait for ingestion to complete (~5-10 minutes)"
    echo "3. 🌐 Access the frontend URL above"
    echo "4. 💬 Start chatting with your knowledge base!"
    echo ""
    echo -e "${BLUE}💡 Tip:${NC} Check the CloudWatch dashboard for monitoring"
    echo -e "${BLUE}💡 Tip:${NC} Use 'cdk destroy' to clean up infrastructure (storage will remain)"
    echo ""
}

cleanup_on_error() {
    log_error "Deployment failed! Check the error messages above."
    echo ""
    echo "Common issues and solutions:"
    echo "- Check AWS credentials and permissions"
    echo "- Verify region supports all required services"
    echo "- Ensure no conflicting resources exist"
    echo "- Check CDK version compatibility"
    echo ""
    echo "For detailed logs, check CloudFormation events in AWS Console"
    exit 1
}

# Main deployment flow
main() {
    # Set error handler
    trap cleanup_on_error ERR
    
    print_banner
    validate_inputs
    check_prerequisites
    check_aws_credentials
    setup_environment
    install_dependencies
    bootstrap_cdk
    
    log_info "Starting deployment process..."
    
    deploy_storage_stack
    deploy_infrastructure_stack
    wait_for_resources
    seed_initial_data
    trigger_ingestion
    deploy_frontend_stack
    
    display_deployment_info
}

# Show usage if no arguments
if [ $# -eq 0 ]; then
    echo "Usage: $0 <environment> [region] [aws-profile]"
    echo ""
    echo "Arguments:"
    echo "  environment    dev, staging, or prod (required)"
    echo "  region         AWS region (default: us-east-1)"
    echo "  aws-profile    AWS CLI profile (default: default)"
    echo ""
    echo "🔒 Security: Restrict Frontend Access to Your IP"
    echo "  Set ALLOWED_IPS environment variable to restrict access:"
    echo "  export ALLOWED_IPS='[\"YOUR_IP/32\"]'     # Single IP"
    echo "  export ALLOWED_IPS='[\"1.2.3.4/32\", \"5.6.7.8/24\"]'  # Multiple IPs/ranges"
    echo ""
    echo "Examples:"
    echo "  $0 dev                           # Deploy with open access (dev only)"
    echo "  $0 staging us-west-2             # Deploy to staging"
    echo "  $0 prod us-east-1 production     # Deploy to production"
    echo ""
    echo "Security Examples:"
    echo "  ./scripts/get-my-ip.sh                    # Get your current IP"
    echo "  export ALLOWED_IPS='[\"1.2.3.4/32\"]'    # Set IP restriction"
    echo "  $0 prod                                   # Deploy with IP restriction"
    echo ""
    echo "⚠️  For production deployments, IP restriction is HIGHLY recommended!"
    echo ""
    exit 1
fi

# Run main deployment
main 