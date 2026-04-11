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
 * Uses connection string when available (production), falls back to
 * DefaultAzureCredential (local dev with `az login`).
 */
export async function enqueueUploadJob(message: UploadJobMessage): Promise<void> {
  const connectionString = process.env.AZURE_SERVICE_BUS_CONNECTION_STRING;
  const namespace = process.env.AZURE_SERVICE_BUS_NAMESPACE;
  const queueName = process.env.AZURE_SERVICE_BUS_QUEUE_NAME ?? "porter-uploads";

  if (!connectionString && !namespace) {
    throw new Error("AZURE_SERVICE_BUS_NAMESPACE is not set");
  }

  const client = connectionString
    ? new ServiceBusClient(connectionString)
    : new ServiceBusClient(namespace!, new DefaultAzureCredential());

  const sender = client.createSender(queueName);
  try {
    await sender.sendMessages({ body: message, contentType: "application/json" });
  } finally {
    await sender.close();
    await client.close();
  }
}
