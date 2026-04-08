import { ServiceBusClient } from "@azure/service-bus";
import { DefaultAzureCredential } from "@azure/identity";

export type UploadJobMessage = {
  uploadId: string;
  blobName: string;
  mimeType: string;
  sheetName?: string;
};

/**
 * Returns true when Service Bus is configured in this environment.
 * When false the upload route falls back to inline synchronous processing.
 */
export function isServiceBusConfigured(): boolean {
  return !!process.env.AZURE_SERVICE_BUS_NAMESPACE;
}

/**
 * Sends an upload processing job to the Service Bus queue.
 * Uses DefaultAzureCredential — run `az login` locally if needed,
 * or assign the "Azure Service Bus Data Sender" role to the managed identity
 * in production.
 */
export async function enqueueUploadJob(message: UploadJobMessage): Promise<void> {
  const namespace = process.env.AZURE_SERVICE_BUS_NAMESPACE;
  const queueName = process.env.AZURE_SERVICE_BUS_QUEUE_NAME ?? "porter-uploads";

  if (!namespace) {
    throw new Error("AZURE_SERVICE_BUS_NAMESPACE is not set");
  }

  const client = new ServiceBusClient(namespace, new DefaultAzureCredential());
  const sender = client.createSender(queueName);
  try {
    await sender.sendMessages({ body: message, contentType: "application/json" });
  } finally {
    await sender.close();
    await client.close();
  }
}
