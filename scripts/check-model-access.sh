#!/bin/bash

# RAG Demo - Check Bedrock Model Access
# Verifies that required foundation models are accessible before deployment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
REGION=${1:-us-east-1}
PROFILE=${2:-default}

# Required models
REQUIRED_MODELS=(
    "amazon.titan-embed-text-v1"
    "anthropic.claude-3-sonnet-20240229-v1:0"
)

OPTIONAL_MODELS=(
    "cohere.embed-english-v3"
    "cohere.embed-multilingual-v3"
    "anthropic.claude-3-haiku-20240307-v1:0"
    "amazon.titan-text-express-v1"
)

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
    echo -e "${BLUE}"
    echo "=========================================="
    echo "🤖 Bedrock Model Access Checker"
    echo "=========================================="
    echo -e "${NC}"
    echo "Region:  $REGION"
    echo "Profile: $PROFILE"
    echo ""
}

show_usage() {
    echo "Usage: $0 [region] [aws-profile]"
    echo ""
    echo "Arguments:"
    echo "  region       AWS region (default: us-east-1)"
    echo "  aws-profile  AWS CLI profile (default: default)"
    echo ""
    echo "Examples:"
    echo "  $0                        # Check in us-east-1 with default profile"
    echo "  $0 us-west-2              # Check in us-west-2"
    echo "  $0 us-east-1 myprofile    # Check with custom profile"
    echo ""
}

check_aws_access() {
    log_info "Checking AWS credentials..."
    
    if ! aws sts get-caller-identity --profile $PROFILE --region $REGION &>/dev/null; then
        log_error "AWS credentials not configured or invalid for profile: $PROFILE"
        log_error "Configure with: aws configure --profile $PROFILE"
        exit 1
    fi
    
    local identity=$(aws sts get-caller-identity --profile $PROFILE --output text)
    local account=$(echo $identity | cut -f1)
    
    log_success "AWS credentials valid for account: $account"
}

check_bedrock_service() {
    log_info "Checking Bedrock service availability..."
    
    if aws bedrock list-foundation-models --region $REGION --profile $PROFILE &>/dev/null; then
        log_success "Bedrock service is available in $REGION"
    else
        log_error "Bedrock service is not available in $REGION"
        log_error "Bedrock is only available in specific regions: us-east-1, us-west-2, eu-west-1, ap-southeast-1"
        exit 1
    fi
}

get_available_models() {
    log_info "Retrieving available foundation models..."
    
    # Get list of all available models
    local models_json=$(aws bedrock list-foundation-models \
        --region $REGION \
        --profile $PROFILE \
        --output json 2>/dev/null)
    
    if [ $? -ne 0 ]; then
        log_error "Failed to retrieve foundation models"
        exit 1
    fi
    
    # Extract active models
    echo "$models_json" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    active_models = []
    for model in data.get('modelSummaries', []):
        if model.get('modelLifecycle') == 'ACTIVE':
            active_models.append(model.get('modelId'))
    print('\\n'.join(active_models))
except Exception as e:
    print(f'Error parsing models: {e}', file=sys.stderr)
    sys.exit(1)
"
}

check_model_access() {
    local model_id=$1
    local model_type=$2
    
    # Try to invoke the model to check actual access
    if [[ "$model_id" == *"embed"* ]]; then
        # Test embedding model
        local test_result=$(aws bedrock-runtime invoke-model \
            --model-id "$model_id" \
            --content-type "application/json" \
            --accept "application/json" \
            --body '{"inputText":"test"}' \
            --region $REGION \
            --profile $PROFILE \
            /tmp/bedrock-test-output.json 2>&1)
    else
        # Test text generation model
        local test_result=$(aws bedrock-runtime invoke-model \
            --model-id "$model_id" \
            --content-type "application/json" \
            --accept "application/json" \
            --body '{"messages":[{"role":"user","content":"test"}],"max_tokens":10}' \
            --region $REGION \
            --profile $PROFILE \
            /tmp/bedrock-test-output.json 2>&1)
    fi
    
    if [ $? -eq 0 ]; then
        log_success "✅ $model_type: $model_id (ACCESSIBLE)"
        return 0
    else
        if [[ "$test_result" == *"AccessDeniedException"* ]]; then
            log_error "❌ $model_type: $model_id (ACCESS DENIED)"
        else
            log_warning "⚠️  $model_type: $model_id (UNKNOWN STATUS)"
        fi
        return 1
    fi
}

check_all_models() {
    log_info "Checking access to required and optional models..."
    echo ""
    
    # Get available models
    local available_models=$(get_available_models)
    
    local required_passed=0
    local required_total=${#REQUIRED_MODELS[@]}
    local optional_passed=0
    local optional_total=${#OPTIONAL_MODELS[@]}
    
    echo "🔹 Required Models:"
    for model in "${REQUIRED_MODELS[@]}"; do
        if echo "$available_models" | grep -q "^$model$"; then
            if check_model_access "$model" "Required"; then
                ((required_passed++))
            fi
        else
            log_error "❌ Required: $model (NOT AVAILABLE IN REGION)"
        fi
    done
    
    echo ""
    echo "🔸 Optional Models:"
    for model in "${OPTIONAL_MODELS[@]}"; do
        if echo "$available_models" | grep -q "^$model$"; then
            if check_model_access "$model" "Optional"; then
                ((optional_passed++))
            fi
        else
            log_warning "⚠️  Optional: $model (NOT AVAILABLE IN REGION)"
        fi
    done
    
    echo ""
    echo "=========================================="
    echo "📊 Model Access Summary"
    echo "=========================================="
    echo "Required Models: $required_passed/$required_total accessible"
    echo "Optional Models: $optional_passed/$optional_total accessible"
    echo ""
    
    # Check if deployment can proceed
    if [ $required_passed -eq $required_total ]; then
        log_success "🎉 All required models are accessible! Deployment can proceed."
        return 0
    else
        log_error "❌ Some required models are not accessible. Deployment will fail."
        echo ""
        show_fix_instructions
        return 1
    fi
}

show_fix_instructions() {
    echo "🔧 How to Fix Model Access Issues:"
    echo ""
    echo "1. Go to AWS Bedrock Console:"
    echo "   https://console.aws.amazon.com/bedrock/"
    echo ""
    echo "2. Click 'Model access' in the left sidebar"
    echo ""
    echo "3. Click 'Request model access'"
    echo ""
    echo "4. Enable these required models:"
    for model in "${REQUIRED_MODELS[@]}"; do
        echo "   ✅ $model"
    done
    echo ""
    echo "5. Fill out use case: 'Building RAG demo for document search'"
    echo ""
    echo "6. Submit request (usually auto-approved)"
    echo ""
    echo "7. Wait for approval and re-run this script"
    echo ""
    echo "Alternative - Use different models:"
    echo "   export EMBEDDING_MODEL='cohere.embed-english-v3'"
    echo "   export VECTOR_DIMENSIONS='1024'"
    echo ""
}

show_available_models() {
    echo ""
    echo "🔍 All Available Models in $REGION:"
    echo "----------------------------------------------------"
    
    aws bedrock list-foundation-models \
        --region $REGION \
        --profile $PROFILE \
        --output table \
        --query 'modelSummaries[?modelLifecycle==`ACTIVE`].[modelId,modelName,providerName]' \
        2>/dev/null || echo "Failed to retrieve model list"
}

cleanup() {
    # Clean up temporary files
    rm -f /tmp/bedrock-test-output.json
}

# Main execution
main() {
    # Set cleanup trap
    trap cleanup EXIT
    
    # Handle help
    if [[ "$1" == "help" || "$1" == "-h" || "$1" == "--help" ]]; then
        show_usage
        exit 0
    fi
    
    # Handle list command
    if [[ "$1" == "list" ]]; then
        REGION=${2:-us-east-1}
        PROFILE=${3:-default}
        show_available_models
        exit 0
    fi
    
    print_banner
    
    # Set AWS environment
    export AWS_PROFILE=$PROFILE
    export AWS_REGION=$REGION
    
    # Run checks
    check_aws_access
    check_bedrock_service
    
    if check_all_models; then
        echo "🚀 Ready to deploy! Run: ./scripts/deploy.sh <environment>"
        exit 0
    else
        echo "❌ Fix model access issues before deploying"
        exit 1
    fi
}

# Execute main function
main "$@" 