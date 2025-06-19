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

# Default values
ENVIRONMENT=""
REGION=""
PROFILE="default"

# Validation arrays
VALID_ENVIRONMENTS=("dev" "staging" "prod")
SUPPORTED_REGIONS=("us-east-1" "us-west-2" "eu-west-1" "eu-central-1" "ap-southeast-1" "ap-northeast-1")

# Help function
show_help() {
    echo "RAG Demo CDK Deployment Script"
    echo ""
    echo "Usage: $0 --region <region> [OPTIONS]"
    echo ""
    echo "Required Arguments:"
    echo "  --region <region>        AWS region for deployment (e.g., us-east-1, us-west-2)"
    echo ""
    echo "Optional Arguments:"
    echo "  --environment <env>      Deployment environment (dev|staging|prod) [default: dev]"
    echo "  --profile <profile>      AWS CLI profile [default: default]"
    echo "  --help, -h              Show this help message"
    echo ""
    echo "Environment Variables (Optional):"
    echo "  ALLOWED_IPS             JSON array of IP addresses/CIDR blocks for frontend access"
    echo "                          Example: '[\"1.2.3.4/32\", \"10.0.0.0/8\"]'"
    echo ""
    echo "Supported Regions:"
    echo "  ${SUPPORTED_REGIONS[*]}"
    echo ""
    echo "Examples:"
    echo "  $0 --region us-east-1                                    # Deploy to dev in us-east-1"
    echo "  $0 --region us-west-2 --environment staging              # Deploy to staging"
    echo "  $0 --region eu-west-1 --environment prod --profile prod  # Deploy to production"
    echo ""
    echo "Security Examples:"
    echo "  ./scripts/get-my-ip.sh                                   # Get your current IP"
    echo "  export ALLOWED_IPS='[\"1.2.3.4/32\"]'                    # Set IP restriction"
    echo "  $0 --region us-east-1 --environment prod                 # Deploy with IP restriction"
    echo ""
    echo "⚠️  For production deployments, IP restriction is HIGHLY recommended!"
    echo ""
}

# Parse command line arguments
parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --region)
                REGION="$2"
                shift 2
                ;;
            --environment)
                ENVIRONMENT="$2"
                shift 2
                ;;
            --profile)
                PROFILE="$2"
                shift 2
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                echo "Error: Unknown argument '$1'"
                echo "Use --help for usage information"
                exit 1
                ;;
        esac
    done
    
    # Set default environment if not provided
    if [[ -z "$ENVIRONMENT" ]]; then
        ENVIRONMENT="dev"
    fi
    
    # Validate required arguments
    if [[ -z "$REGION" ]]; then
        echo "Error: --region is required"
        echo ""
        show_help
        exit 1
    fi
    
    # Validate environment
    if [[ ! " ${VALID_ENVIRONMENTS[*]} " =~ " ${ENVIRONMENT} " ]]; then
        echo "Error: Invalid environment '$ENVIRONMENT'"
        echo "Valid environments: ${VALID_ENVIRONMENTS[*]}"
        exit 1
    fi
    
    # Validate region format (basic check)
    if [[ ! "$REGION" =~ ^[a-z]{2}-[a-z]+-[0-9]+$ ]]; then
        echo "Error: Invalid region format '$REGION'"
        echo "Expected format: us-east-1, eu-west-1, etc."
        exit 1
    fi
}

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
    
    # Validate region support
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
    
    # Suggest model access check
    log_info "💡 Tip: Run './scripts/check-model-access.sh' to verify Bedrock model access"
    log_info "💡 Most deployment failures are due to missing Bedrock model permissions"
    
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
    
    # Check if already bootstrapped with default stack name
    BOOTSTRAP_STACK="CDKToolkit"
    
    if aws cloudformation describe-stacks --stack-name $BOOTSTRAP_STACK --profile $PROFILE --region $REGION &> /dev/null; then
        log_info "CDK already bootstrapped in $REGION"
    else
        log_info "Bootstrapping CDK in $REGION..."
        cdk bootstrap --profile $PROFILE \
            --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess
        log_success "CDK bootstrap complete"
    fi
}

deploy_core_stack() {
    log_info "Deploying core stack (IAM roles and policies)..."
    
    CORE_STACK="RagDemoCoreStack-$ENVIRONMENT"
    
    # Deploy core stack
    cdk deploy $CORE_STACK \
        --profile $PROFILE \
        --context environment=$ENVIRONMENT \
        --context region=$REGION \
        --require-approval never \
        --outputs-file cdk-outputs-core.json
    
    log_success "Core stack deployed successfully"
    
    # Wait for IAM role propagation
    wait_for_iam_propagation
}

wait_for_iam_propagation() {
    log_info "Waiting for IAM role propagation..."
    
    # IAM roles can take 2-5 minutes to propagate globally
    log_info "IAM roles need time to propagate across AWS regions and services"
    log_info "Waiting 3 minutes for optimal propagation..."
    
    for i in {1..180}; do
        echo -n "."
        sleep 1
        if [ $((i % 30)) -eq 0 ]; then
            echo " ${i}s"
        fi
    done
    echo ""
    
    log_success "✅ IAM role propagation complete"
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

deploy_foundation_stack() {
    log_info "Deploying foundation stack (OpenSearch, policies, IAM roles)..."
    
    FOUNDATION_STACK="RagDemoFoundationStack-$ENVIRONMENT"
    
    # Deploy foundation stack
    cdk deploy $FOUNDATION_STACK \
        --profile $PROFILE \
        --context environment=$ENVIRONMENT \
        --context region=$REGION \
        --require-approval never \
        --outputs-file cdk-outputs-foundation.json
    
    log_success "Foundation stack deployed successfully"
    
    # Wait for foundation resources to be ready
    wait_for_foundation_resources
}

wait_for_foundation_resources() {
    log_info "Waiting for foundation resources to be ready..."
    
    # Wait for OpenSearch collection to be active
    log_info "Checking OpenSearch Serverless collection status..."
    
    # Get collection name from CDK outputs (now includes region)
    if [ -f "cdk-outputs-foundation.json" ]; then
        COLLECTION_NAME=$(python3 -c "
import json
with open('cdk-outputs-foundation.json', 'r') as f:
    outputs = json.load(f)
    for stack_outputs in outputs.values():
        if 'CollectionId' in stack_outputs:
            print('rag-demo-collection-$ENVIRONMENT-$REGION')
            break
" 2>/dev/null)
        
        # Replace variables with actual values
        COLLECTION_NAME=${COLLECTION_NAME//\$ENVIRONMENT/$ENVIRONMENT}
        COLLECTION_NAME=${COLLECTION_NAME//\$REGION/$REGION}
        
        if [ ! -z "$COLLECTION_NAME" ]; then
            log_info "Waiting for collection '$COLLECTION_NAME' to be active..."
            
            # Wait for collection to be active (max 22 minutes)
            TIMEOUT=1320
            ELAPSED=0
            
            while [ $ELAPSED -lt $TIMEOUT ]; do
                STATUS=$(aws opensearchserverless list-collections \
                    --profile $PROFILE \
                    --region $REGION \
                    --query "collectionSummaries[?name=='$COLLECTION_NAME'].status" \
                    --output text 2>/dev/null || echo "UNKNOWN")
                
                if [ "$STATUS" = "ACTIVE" ]; then
                    log_success "✅ OpenSearch collection is active"
                    break
                elif [ "$STATUS" = "FAILED" ]; then
                    log_error "❌ OpenSearch collection deployment failed"
                    exit 1
                else
                    log_info "Collection status: $STATUS (waiting...)"
                    sleep 30
                    ELAPSED=$((ELAPSED + 30))
                fi
            done
            
            if [ $ELAPSED -ge $TIMEOUT ]; then
                log_error "❌ Timeout waiting for OpenSearch collection"
                exit 1
            fi
        fi
    fi
    
    # Wait additional time for IAM policy propagation
    log_info "Waiting for IAM policy propagation (30 seconds)..."
    sleep 30
    
    log_success "✅ Foundation resources are ready"
}

deploy_application_stack() {
    log_info "Deploying application stack (Knowledge Base, index creation, monitoring)..."
    
    APPLICATION_STACK="RagDemoApplicationStack-$ENVIRONMENT"
    
    # Deploy application stack  
    cdk deploy $APPLICATION_STACK \
        --profile $PROFILE \
        --context environment=$ENVIRONMENT \
        --context region=$REGION \
        --require-approval never \
        --outputs-file cdk-outputs-application.json
    
    log_success "Application stack deployed successfully"
}

wait_for_resources() {
    log_info "Waiting for application resources to be ready..."
    
    # Additional wait for Knowledge Base to be ready
    sleep 30
    log_success "Application resources are ready"
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
    if [ -f "cdk-outputs-application.json" ]; then
        KB_ID=$(python3 -c "
import json
with open('cdk-outputs-application.json', 'r') as f:
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
    
    if [ -f "cdk-outputs-application.json" ]; then
        KNOWLEDGE_BASE_ID=$(python3 -c "
import json
with open('cdk-outputs-application.json', 'r') as f:
    outputs = json.load(f)
    for stack_outputs in outputs.values():
        if 'KnowledgeBaseId' in stack_outputs:
            print(stack_outputs['KnowledgeBaseId'])
            break
" 2>/dev/null)
        
        if [ ! -z "$KNOWLEDGE_BASE_ID" ]; then
            echo -e "${GREEN}🧠 Knowledge Base ID:${NC} $KNOWLEDGE_BASE_ID"
        fi
    fi
    
    if [ -f "cdk-outputs-foundation.json" ]; then
        COLLECTION_ENDPOINT=$(python3 -c "
import json
with open('cdk-outputs-foundation.json', 'r') as f:
    outputs = json.load(f)
    for stack_outputs in outputs.values():
        if 'CollectionEndpoint' in stack_outputs:
            print(stack_outputs['CollectionEndpoint'])
            break
" 2>/dev/null)
        
        if [ ! -z "$COLLECTION_ENDPOINT" ]; then
            echo -e "${GREEN}🔍 OpenSearch Endpoint:${NC} $COLLECTION_ENDPOINT"
        fi
    fi
    
    echo ""
    echo "=========================================="
    echo "🏗️  Deployment Architecture"
    echo "=========================================="
    echo "✅ 1. CoreStack        - IAM roles and policies"
    echo "✅ 2. StorageStack     - S3 buckets, KMS keys"  
    echo "✅ 3. FoundationStack  - OpenSearch collection, policies"
    echo "✅ 4. ApplicationStack - Knowledge Base, monitoring"
    echo "✅ 5. FrontendStack    - Streamlit UI"
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
    echo -e "${BLUE}💡 Tip:${NC} Use 'cdk destroy' to clean up (storage will remain)"
    echo ""
    echo "=========================================="
    echo "⏱️  IAM Propagation & Deployment Notes"
    echo "=========================================="
    echo "• CoreStack deployed first with 3-minute IAM propagation wait"
    echo "• OpenSearch collection given 22 minutes to provision"
    echo "• All timeouts optimized for AWS service propagation"
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
    
    deploy_core_stack           # 🆕 Deploy IAM roles first
    deploy_storage_stack
    deploy_foundation_stack     # Deploy foundation second  
    deploy_application_stack    # Deploy application third
    wait_for_resources
    seed_initial_data
    trigger_ingestion
    deploy_frontend_stack
    
    display_deployment_info
}

# Show usage if no arguments
if [ $# -eq 0 ]; then
    echo "Usage: $0 --region <region> [OPTIONS]"
    echo ""
    echo "Arguments:"
    echo "  --region <region>        AWS region for deployment (e.g., us-east-1, us-west-2)"
    echo "  --environment <env>      Deployment environment (dev|staging|prod) [default: dev]"
    echo "  --profile <profile>      AWS CLI profile [default: default]"
    echo ""
    echo "🔒 Security: Restrict Frontend Access to Your IP"
    echo "  Set ALLOWED_IPS environment variable to restrict access:"
    echo "  export ALLOWED_IPS='[\"YOUR_IP/32\"]'     # Single IP"
    echo "  export ALLOWED_IPS='[\"1.2.3.4/32\", \"5.6.7.8/24\"]'  # Multiple IPs/ranges"
    echo ""
    echo "Examples:"
    echo "  $0 --region us-east-1                                    # Deploy to dev in us-east-1"
    echo "  $0 --region us-west-2 --environment staging              # Deploy to staging"
    echo "  $0 --region eu-west-1 --environment prod --profile prod  # Deploy to production"
    echo ""
    echo "Security Examples:"
    echo "  ./scripts/get-my-ip.sh                                   # Get your current IP"
    echo "  export ALLOWED_IPS='[\"1.2.3.4/32\"]'                    # Set IP restriction"
    echo "  $0 --region us-east-1 --environment prod                 # Deploy with IP restriction"
    echo ""
    echo "⚠️  For production deployments, IP restriction is HIGHLY recommended!"
    echo ""
    exit 1
fi

# Run main deployment
parse_arguments "$@"
main 