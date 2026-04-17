az deployment group create \
  --resource-group porter-setup \
  --template-file bicep/main.bicep \
  --parameters bicep/main.secrets.bicepparam
  

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
  --resource-group porter-setup \
  --name porter-app-worker \
  --src function.zip

cd ../..

docker build -t portercontainerregistry.azurecr.io/porter:latest .
docker push portercontainerregistry.azurecr.io/porter:latest


az webapp restart --name porter-app --resource-group porter-setup
