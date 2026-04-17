"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const functions_1 = require("@azure/functions");
functions_1.app.serviceBusQueue("uploadWorker", {
    queueName: process.env.AZURE_SERVICE_BUS_QUEUE_NAME ?? "porter-uploads",
    connection: "ServiceBusConnection",
    handler: async (message, context) => {
        const job = message;
        context.log(`Processing upload job: uploadId=${job.uploadId} blob=${job.blobName}`);
        const appUrl = process.env.APP_URL;
        const workerSecret = process.env.UPLOAD_WORKER_SECRET;
        if (!appUrl || !workerSecret) {
            // Unrecoverable configuration error — throw so the message is dead-lettered
            throw new Error("APP_URL or UPLOAD_WORKER_SECRET is not configured");
        }
        const url = `${appUrl.replace(/\/$/, "")}/api/upload/process`;
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-worker-secret": workerSecret,
            },
            body: JSON.stringify(job),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => "(no body)");
            // Throw so the Service Bus runtime retries up to maxDeliveryCount (3),
            // then dead-letters the message for manual inspection.
            throw new Error(`/api/upload/process responded ${res.status}: ${body}`);
        }
        const result = await res.json();
        context.log(`Upload job complete: uploadId=${job.uploadId} status=${result.status} rows=${result.rowCount}`);
    },
});
