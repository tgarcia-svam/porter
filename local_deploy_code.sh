#!/usr/bin/env bash
set -euo pipefail

# Helper: extract a param value from main.secrets.bicepparam
# Matches lines like: param dbName = 'porter-database'
extract() { grep -E "^param $1\s*=" bicep/main.secrets.bicepparam | sed "s/.*= '//; s/'.*//"; }

RG="porter-setup"

# ── 1. Infrastructure ──────────────────────────────────────────────────────────
echo ">> Deploying infrastructure..."
az deployment group create \
  --resource-group "$RG" \
  --template-file bicep/main.bicep \
  --parameters bicep/main.secrets.bicepparam

# ── 2. Database application user ───────────────────────────────────────────────
echo ">> Setting up database application user..."

DB_SERVER_NAME=$(extract dbServerName)
DB_SERVER="${DB_SERVER_NAME}.postgres.database.azure.com"
DB_NAME=$(extract dbName)
DB_ADMIN_USER=$(extract dbAdminUser)
DB_ADMIN_PASSWORD=$(extract dbAdminPassword)
DB_APP_USER_PASSWORD=$(extract dbAppUserPassword)

MY_IP=$(curl -s https://api.ipify.org)
echo "   Opening PostgreSQL firewall for $MY_IP..."
az postgres flexible-server firewall-rule create \
  --resource-group "$RG" \
  --name "$DB_SERVER_NAME" \
  --rule-name AllowDeployTemp \
  --start-ip-address "$MY_IP" \
  --end-ip-address "$MY_IP" \
  --output none

DATABASE_URL="postgresql://${DB_ADMIN_USER}:${DB_ADMIN_PASSWORD}@${DB_SERVER}:5432/${DB_NAME}?sslmode=require" \
PORTER_APP_USER_PASSWORD="$DB_APP_USER_PASSWORD" \
  npm run db:create-app-user

echo "   Removing temporary firewall rule..."
az postgres flexible-server firewall-rule delete \
  --resource-group "$RG" \
  --name "$DB_SERVER_NAME" \
  --rule-name AllowDeployTemp \
  --yes \
  --output none

# ── 3. Function worker ─────────────────────────────────────────────────────────
echo ">> Deploying function worker..."
cd functions/upload-worker
npm install
npm run build
npm prune --omit=dev
rm -rf staging function.zip
mkdir staging
cp host.json package.json staging/
cp -r dist staging/
cp -r node_modules staging/
powershell -Command "Compress-Archive -Path staging\* -DestinationPath function.zip -Force"
az functionapp deployment source config-zip \
  --resource-group "$RG" \
  --name porter-app-worker \
  --src function.zip

cd ../..

# ── 4. App container ───────────────────────────────────────────────────────────
echo ">> Building and pushing app container..."
docker build -t portercontainerregistry.azurecr.io/porter:latest .
docker push portercontainerregistry.azurecr.io/porter:latest

echo ">> Restarting app service..."
az webapp restart --name porter-app --resource-group "$RG"

echo ">> Deployment complete."
