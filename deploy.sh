#!/bin/bash
# Deploy DAO AI Arena to Databricks Apps
# Following dao-ai-builder's proven deployment pattern

set -e

# Help text
show_help() {
    cat << EOF
DAO AI Arena - Deployment Script

USAGE:
    ./deploy.sh [OPTIONS]

OPTIONS:
    -h, --help              Show this help message and exit
    -p, --profile PROFILE   Use the specified Databricks CLI profile
    -v, --verbose           Show full output from commands
    --force                 Clean rebuild (removes all build artifacts)

EXAMPLES:
    # Normal deployment
    ./deploy.sh

    # Deploy to specific workspace
    ./deploy.sh --profile my-workspace

    # Clean rebuild from scratch
    ./deploy.sh --force

    # Verbose output
    ./deploy.sh --verbose

DESCRIPTION:
    Deploys the DAO AI Arena to Databricks Apps. This script:
    
    1. Checks prerequisites (Databricks CLI, npm, jq)
    2. Builds the React frontend
    3. Prepares static files
    4. Creates the app if it doesn't exist
    5. Syncs files to Databricks workspace using bundle
    6. Deploys the app code
    7. Starts the app and waits for it to be ready

    For more info: https://docs.databricks.com/dev-tools/databricks-apps/

EOF
}

# Parse arguments
FORCE_CLEAN=false
PROFILE=""
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        -p|--profile)
            if [[ -z "$2" ]] || [[ "$2" == -* ]]; then
                echo "Error: --profile requires a profile name"
                exit 1
            fi
            PROFILE="$2"
            shift 2
            ;;
        --force)
            FORCE_CLEAN=true
            shift
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        *)
            echo "Error: Unknown option '$1'"
            echo "Run './deploy.sh --help' for usage information"
            exit 1
            ;;
    esac
done

# Build profile flag for databricks CLI commands
if [[ -n "$PROFILE" ]]; then
    PROFILE_FLAG="--profile $PROFILE"
else
    PROFILE_FLAG=""
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

APP_NAME="dao-ai-arena"
BUNDLE_NAME="dao-ai-arena"

echo -e "${CYAN}╔═════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║       DAO AI Arena - Deployment Script          ║${NC}"
echo -e "${CYAN}╚═════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  App Name: ${BLUE}${APP_NAME}${NC}"
if [[ -n "$PROFILE" ]]; then
    echo -e "  Profile: ${BLUE}${PROFILE}${NC}"
fi
echo ""

# Clean up if --force flag is used
if [ "$FORCE_CLEAN" = true ]; then
    echo -e "${YELLOW}🧹 Force clean enabled - removing all build artifacts...${NC}"
    rm -rf .databricks
    rm -rf backend/static
    rm -rf frontend/dist
    rm -rf frontend/node_modules
    echo -e "  ${GREEN}✓${NC} Cleaned bundle state, static files, and frontend build"
    echo ""
fi

# Check prerequisites
echo -e "${YELLOW}[1/7] Checking prerequisites...${NC}"

if ! command -v databricks &> /dev/null; then
    echo -e "${RED}✗ Databricks CLI not found${NC}"
    echo "  Install with: pip install databricks-cli"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Databricks CLI installed"

if ! command -v npm &> /dev/null; then
    echo -e "${RED}✗ npm not found${NC}"
    echo "  Install Node.js from https://nodejs.org"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} npm installed"

if ! command -v jq &> /dev/null; then
    echo -e "${YELLOW}⚠ jq not found - status polling may not work correctly${NC}"
    echo "  Install with: brew install jq"
    HAS_JQ=false
else
    echo -e "  ${GREEN}✓${NC} jq installed"
    HAS_JQ=true
fi

# Verify Databricks authentication
if [[ -n "$PROFILE" ]]; then
    echo -e "  Using profile: ${BLUE}${PROFILE}${NC}"
fi
if ! databricks $PROFILE_FLAG current-user me &> /dev/null; then
    echo -e "${RED}✗ Databricks CLI not authenticated${NC}"
    if [[ -n "$PROFILE" ]]; then
        echo "  Check that profile '$PROFILE' exists in ~/.databrickscfg"
    else
        echo "  Run: databricks configure"
    fi
    exit 1
fi
USER_EMAIL=$(databricks $PROFILE_FLAG current-user me --output json | jq -r '.userName' 2>/dev/null || databricks $PROFILE_FLAG current-user me --output json | grep -o '"userName":"[^"]*"' | cut -d'"' -f4)
echo -e "  ${GREEN}✓${NC} Authenticated as ${BLUE}${USER_EMAIL}${NC}"
echo ""

# Workspace path where files are synced by bundle
WORKSPACE_PATH="/Workspace/Users/${USER_EMAIL}/.bundle/${BUNDLE_NAME}/default/files"
echo -e "  Workspace path: ${BLUE}${WORKSPACE_PATH}${NC}"
echo ""

# Step 2: Build frontend
echo -e "${YELLOW}[2/7] Building React frontend...${NC}"
cd frontend

if [ ! -d "node_modules" ] || [ "$FORCE_CLEAN" = true ]; then
    echo -e "  Installing dependencies..."
    npm install --silent 2>/dev/null
fi

echo -e "  Building..."
if [ "$VERBOSE" = true ]; then
    npm run build
else
    npm run build 2>&1 | tail -5
fi
cd ..
echo -e "  ${GREEN}✓${NC} Frontend built"
echo ""

# Step 3: Prepare static files
echo -e "${YELLOW}[3/7] Preparing static files...${NC}"
rm -rf backend/static
cp -r frontend/dist backend/static
echo -e "  ${GREEN}✓${NC} Static files copied to ./backend/static"
echo ""

# Step 4: Check if app exists, create if needed
echo -e "${YELLOW}[4/7] Checking app status...${NC}"

if ! databricks $PROFILE_FLAG apps get "${APP_NAME}" &> /dev/null; then
    echo -e "  App ${BLUE}${APP_NAME}${NC} doesn't exist, creating..."
    
    # Clean bundle state if app doesn't exist but state does
    if [ -d ".databricks" ]; then
        echo -e "  Cleaning stale bundle state..."
        rm -rf .databricks
    fi
    
    # Create the app first
    if [ "$VERBOSE" = true ]; then
        databricks $PROFILE_FLAG apps create "${APP_NAME}" --description "Compare AI agents in Model Serving vs Databricks Apps"
    else
        databricks $PROFILE_FLAG apps create "${APP_NAME}" --description "Compare AI agents in Model Serving vs Databricks Apps" 2>&1 | while read line; do
            echo -e "  ${line}"
        done
    fi
    echo -e "  ${GREEN}✓${NC} App created"
else
    echo -e "  App ${BLUE}${APP_NAME}${NC} exists"
fi
echo ""

# Step 5: Sync files using Databricks Bundle
echo -e "${YELLOW}[5/7] Syncing files to Databricks workspace...${NC}"
echo -e "  Running: ${BLUE}databricks ${PROFILE_FLAG} bundle deploy${NC}"

if [ "$VERBOSE" = true ]; then
    databricks $PROFILE_FLAG bundle deploy
else
    databricks $PROFILE_FLAG bundle deploy 2>&1 | while read line; do
        echo -e "  ${line}"
    done
fi

echo -e "  ${GREEN}✓${NC} Files synced to workspace"
echo ""

# Step 6: Deploy the app code
echo -e "${YELLOW}[6/7] Deploying app code...${NC}"
echo -e "  Source: ${BLUE}${WORKSPACE_PATH}${NC}"
echo -e "  Running: ${BLUE}databricks ${PROFILE_FLAG} apps deploy ${APP_NAME} --source-code-path ${WORKSPACE_PATH}${NC}"

if [ "$VERBOSE" = true ]; then
    databricks $PROFILE_FLAG apps deploy "${APP_NAME}" --source-code-path "${WORKSPACE_PATH}"
else
    databricks $PROFILE_FLAG apps deploy "${APP_NAME}" --source-code-path "${WORKSPACE_PATH}" 2>&1 | while read line; do
        echo -e "  ${line}"
    done
fi

echo -e "  ${GREEN}✓${NC} App code deployed"
echo ""

# Step 7: Ensure app is running and wait for it
echo -e "${YELLOW}[7/7] Starting app and waiting for ready state...${NC}"

# Function to get app status using jq or fallback
get_app_status() {
    local json=$(databricks $PROFILE_FLAG apps get "${APP_NAME}" --output json 2>/dev/null)
    if [ "$HAS_JQ" = true ]; then
        APP_STATE=$(echo "$json" | jq -r '.app_status.state // "UNKNOWN"')
        COMPUTE_STATE=$(echo "$json" | jq -r '.compute_status.state // "UNKNOWN"')
        APP_URL=$(echo "$json" | jq -r '.url // ""')
    else
        # Fallback to python for JSON parsing
        APP_STATE=$(echo "$json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('app_status',{}).get('state','UNKNOWN'))" 2>/dev/null || echo "UNKNOWN")
        COMPUTE_STATE=$(echo "$json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('compute_status',{}).get('state','UNKNOWN'))" 2>/dev/null || echo "UNKNOWN")
        APP_URL=$(echo "$json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('url',''))" 2>/dev/null || echo "")
    fi
}

# Get current compute state and start if needed
get_app_status
if [ "$COMPUTE_STATE" != "ACTIVE" ]; then
    echo -e "  Starting app compute..."
    databricks $PROFILE_FLAG apps start "${APP_NAME}" > /dev/null 2>&1 || true
fi

# Wait for app to be ready
echo -e "  Waiting for app to be ready..."
MAX_WAIT=180
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    get_app_status
    
    if [ "$APP_STATE" = "RUNNING" ]; then
        echo -e "  ${GREEN}✓${NC} App is running!"
        break
    fi
    
    if [ "$APP_STATE" = "DEPLOYING" ] || [ "$COMPUTE_STATE" = "STARTING" ] || [ "$APP_STATE" = "STARTING" ]; then
        echo -e "  Status: App=${APP_STATE}, Compute=${COMPUTE_STATE} (${WAITED}s)"
    elif [ "$APP_STATE" = "DEPLOY_FAILED" ] || [ "$APP_STATE" = "CRASHED" ]; then
        echo -e "  ${RED}✗ Deployment failed: ${APP_STATE}${NC}"
        echo -e "  Check the Databricks Apps UI for logs"
        break
    else
        echo -e "  Status: App=${APP_STATE}, Compute=${COMPUTE_STATE} (${WAITED}s)"
    fi
    
    sleep 10
    WAITED=$((WAITED + 10))
done

if [ $WAITED -ge $MAX_WAIT ]; then
    echo -e "  ${YELLOW}⚠ Timed out waiting for app. It may still be starting.${NC}"
fi

echo ""

# Final status
echo -e "${GREEN}╔═════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║          Deployment Complete! 🎉                ║${NC}"
echo -e "${GREEN}╚═════════════════════════════════════════════════╝${NC}"
echo ""

if [[ -n "$APP_URL" && "$APP_URL" != "null" ]]; then
    echo -e "🌐 App URL: ${BLUE}${APP_URL}${NC}"
else
    # Try to get URL one more time
    get_app_status
    if [[ -n "$APP_URL" && "$APP_URL" != "null" ]]; then
        echo -e "🌐 App URL: ${BLUE}${APP_URL}${NC}"
    else
        echo -e "🌐 App URL: Check Databricks Apps UI"
    fi
fi

echo ""
echo -e "${CYAN}🛠️  Useful Commands:${NC}"
if [[ -n "$PROFILE" ]]; then
    echo -e "  ${BLUE}databricks --profile ${PROFILE} apps get ${APP_NAME}${NC}"
    echo -e "    View app status"
    echo ""
    echo -e "  ${BLUE}databricks --profile ${PROFILE} apps list-deployments ${APP_NAME}${NC}"
    echo -e "    View deployment history"
    echo ""
    echo -e "  ${BLUE}./deploy.sh --profile ${PROFILE}${NC}"
    echo -e "    Redeploy"
    echo ""
    echo -e "  ${BLUE}./deploy.sh --force --profile ${PROFILE}${NC}"
    echo -e "    Clean rebuild"
else
    echo -e "  ${BLUE}databricks apps get ${APP_NAME}${NC}"
    echo -e "    View app status"
    echo ""
    echo -e "  ${BLUE}databricks apps list-deployments ${APP_NAME}${NC}"
    echo -e "    View deployment history"
    echo ""
    echo -e "  ${BLUE}./deploy.sh${NC}"
    echo -e "    Redeploy"
    echo ""
    echo -e "  ${BLUE}./deploy.sh --force${NC}"
    echo -e "    Clean rebuild"
fi
echo ""
echo -e "${GREEN}✨ Deployment complete!${NC}"
echo ""
