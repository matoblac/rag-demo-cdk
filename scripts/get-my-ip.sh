#!/bin/bash

# RAG Demo - Get Current IP Script
# Helper script to get your current public IP address for security restrictions

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_banner() {
    echo -e "${BLUE}"
    echo "=========================================="
    echo "🌐 Get My IP Address"
    echo "=========================================="
    echo -e "${NC}"
    echo "This script helps you get your current public IP"
    echo "for restricting frontend access to your IP only."
    echo ""
}

get_public_ip() {
    echo -e "${BLUE}[INFO]${NC} Detecting your public IP address..."
    
    # Try multiple IP detection services
    local ip=""
    
    # Method 1: ipify.org
    ip=$(curl -s https://api.ipify.org 2>/dev/null || echo "")
    if [ ! -z "$ip" ]; then
        echo -e "${GREEN}[SUCCESS]${NC} Detected IP via ipify.org: $ip"
        echo "$ip"
        return 0
    fi
    
    # Method 2: httpbin.org
    ip=$(curl -s https://httpbin.org/ip 2>/dev/null | grep -o '"origin":"[^"]*' | cut -d'"' -f4 || echo "")
    if [ ! -z "$ip" ]; then
        echo -e "${GREEN}[SUCCESS]${NC} Detected IP via httpbin.org: $ip"
        echo "$ip"
        return 0
    fi
    
    # Method 3: icanhazip.com
    ip=$(curl -s https://icanhazip.com 2>/dev/null | tr -d '\n' || echo "")
    if [ ! -z "$ip" ]; then
        echo -e "${GREEN}[SUCCESS]${NC} Detected IP via icanhazip.com: $ip"
        echo "$ip"
        return 0
    fi
    
    # Method 4: ifconfig.me
    ip=$(curl -s https://ifconfig.me 2>/dev/null || echo "")
    if [ ! -z "$ip" ]; then
        echo -e "${GREEN}[SUCCESS]${NC} Detected IP via ifconfig.me: $ip"
        echo "$ip"
        return 0
    fi
    
    echo -e "${YELLOW}[WARNING]${NC} Could not detect your public IP address"
    echo "Please manually provide your IP address."
    return 1
}

show_deployment_instructions() {
    local ip=$1
    
    echo ""
    echo "=========================================="
    echo " Deployment Instructions"
    echo "=========================================="
    echo ""
    echo "To deploy with IP restriction to YOUR IP only:"
    echo ""
    echo -e "${GREEN}# Set environment variable:${NC}"
    echo "export ALLOWED_IPS='[\"$ip/32\"]'"
    echo ""
    echo -e "${GREEN}# Deploy:${NC}"
    echo "./scripts/deploy.sh prod"
    echo ""
    echo " This will restrict frontend access to ONLY your IP: $ip"
    echo ""
    echo "Alternative CIDR examples:"
    echo "  • Single IP:     $ip/32"
    echo "  • Home network:  $ip/24  (allows ~254 IPs in your subnet)"
    echo "  • Office range:  192.168.1.0/24"
    echo "  • Multiple IPs:  [\"$ip/32\", \"1.2.3.4/32\"]"
    echo ""
    echo -e "${YELLOW}Note: If your IP changes, redeploy with the new IP.${NC}"
}

# Main execution
main() {
    print_banner
    
    # Get public IP
    local my_ip=$(get_public_ip)
    
    if [ ! -z "$my_ip" ]; then
        show_deployment_instructions "$my_ip"
        
        # Save to file for easy reference
        echo "$my_ip" > .current-ip
        echo ""
        echo -e "${BLUE}[INFO]${NC} Your IP has been saved to '.current-ip' file"
        
        # Output just the IP for script usage
        if [ "$1" == "--ip-only" ]; then
            echo "$my_ip"
        fi
    else
        echo ""
        echo "❌ Could not automatically detect your IP."
        echo ""
        echo "Manual steps:"
        echo "1. Visit https://whatismyipaddress.com/"
        echo "2. Copy your IPv4 address"
        echo "3. Set ALLOWED_IPS='[\"YOUR_IP/32\"]'"
        echo "4. Run ./scripts/deploy.sh prod"
    fi
}

# Execute main function
main "$@" 