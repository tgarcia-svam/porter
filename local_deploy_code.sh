docker build -t portercontainerregistry.azurecr.io/porter:latest .
docker push portercontainerregistry.azurecr.io/porter:latest
az deployment group create \
  --resource-group porter-setup \
  --template-file bicep/main.bicep \
  --parameters bicep/main.secrets.bicepparam

az webapp restart --name porter --resource-group porter-setup
