import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Use only vi.fn() inside the factory — no top-level variable references,
// which would trigger the hoisting-before-initialization error.
vi.mock("@azure/service-bus", () => ({ ServiceBusClient: vi.fn() }));
vi.mock("@azure/identity", () => ({ DefaultAzureCredential: vi.fn().mockImplementation(() => ({})) }));

import { ServiceBusClient } from "@azure/service-bus";
import { isServiceBusConfigured, enqueueUploadJob } from "../service-bus";

const MockServiceBusClient = vi.mocked(ServiceBusClient);

const MSG = { uploadId: "u1", blobName: "file.csv", mimeType: "text/csv" };

let mockSendMessages: ReturnType<typeof vi.fn>;
let mockSenderClose: ReturnType<typeof vi.fn>;
let mockClientClose: ReturnType<typeof vi.fn>;
let mockCreateSender: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockSendMessages = vi.fn().mockResolvedValue(undefined);
  mockSenderClose = vi.fn().mockResolvedValue(undefined);
  mockClientClose = vi.fn().mockResolvedValue(undefined);
  mockCreateSender = vi.fn().mockReturnValue({
    sendMessages: mockSendMessages,
    close: mockSenderClose,
  });
  MockServiceBusClient.mockImplementation(() => ({
    createSender: mockCreateSender,
    close: mockClientClose,
  }));
});

afterEach(() => {
  delete process.env.AZURE_SERVICE_BUS_NAMESPACE;
  delete process.env.AZURE_SERVICE_BUS_CONNECTION_STRING;
  delete process.env.AZURE_SERVICE_BUS_QUEUE_NAME;
});

// ── isServiceBusConfigured ────────────────────────────────────────────────────

describe("isServiceBusConfigured", () => {
  it("returns false when AZURE_SERVICE_BUS_NAMESPACE is unset", () => {
    delete process.env.AZURE_SERVICE_BUS_NAMESPACE;
    expect(isServiceBusConfigured()).toBe(false);
  });

  it("returns true when AZURE_SERVICE_BUS_NAMESPACE is set", () => {
    process.env.AZURE_SERVICE_BUS_NAMESPACE = "my-namespace.servicebus.windows.net";
    expect(isServiceBusConfigured()).toBe(true);
  });
});

// ── enqueueUploadJob — error when not configured ──────────────────────────────

describe("enqueueUploadJob — throws when not configured", () => {
  it("throws when neither connection string nor namespace is set", async () => {
    await expect(enqueueUploadJob(MSG)).rejects.toThrow(
      "AZURE_SERVICE_BUS_NAMESPACE is not set"
    );
  });
});

// ── enqueueUploadJob — connection string path ─────────────────────────────────

describe("enqueueUploadJob — connection string path", () => {
  beforeEach(() => {
    process.env.AZURE_SERVICE_BUS_CONNECTION_STRING =
      "Endpoint=sb://test.servicebus.windows.net/;...";
  });

  it("constructs ServiceBusClient with the connection string", async () => {
    await enqueueUploadJob(MSG);
    expect(MockServiceBusClient).toHaveBeenCalledWith(
      process.env.AZURE_SERVICE_BUS_CONNECTION_STRING
    );
  });

  it("creates a sender for the default queue name", async () => {
    await enqueueUploadJob(MSG);
    expect(mockCreateSender).toHaveBeenCalledWith("porter-uploads");
  });

  it("creates a sender for a custom queue name", async () => {
    process.env.AZURE_SERVICE_BUS_QUEUE_NAME = "custom-queue";
    await enqueueUploadJob(MSG);
    expect(mockCreateSender).toHaveBeenCalledWith("custom-queue");
  });

  it("sends the message with correct body and content type", async () => {
    await enqueueUploadJob(MSG);
    expect(mockSendMessages).toHaveBeenCalledWith({
      body: MSG,
      contentType: "application/json",
    });
  });

  it("closes sender and client after successful send", async () => {
    await enqueueUploadJob(MSG);
    expect(mockSenderClose).toHaveBeenCalled();
    expect(mockClientClose).toHaveBeenCalled();
  });

  it("closes sender and client even when sendMessages throws", async () => {
    mockSendMessages.mockRejectedValueOnce(new Error("send failed"));
    await expect(enqueueUploadJob(MSG)).rejects.toThrow("send failed");
    expect(mockSenderClose).toHaveBeenCalled();
    expect(mockClientClose).toHaveBeenCalled();
  });
});

// ── enqueueUploadJob — namespace + credential path ────────────────────────────

describe("enqueueUploadJob — namespace + DefaultAzureCredential path", () => {
  beforeEach(() => {
    process.env.AZURE_SERVICE_BUS_NAMESPACE = "my-ns.servicebus.windows.net";
  });

  it("constructs ServiceBusClient with namespace and a credential object", async () => {
    await enqueueUploadJob(MSG);
    expect(MockServiceBusClient).toHaveBeenCalledWith(
      "my-ns.servicebus.windows.net",
      expect.any(Object)
    );
  });

  it("sends the message successfully", async () => {
    await enqueueUploadJob(MSG);
    expect(mockSendMessages).toHaveBeenCalledWith(
      expect.objectContaining({ body: MSG })
    );
  });
});
