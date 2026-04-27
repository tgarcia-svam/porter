import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGetSecret = vi.fn();
const MockSecretClient = vi.fn().mockImplementation(() => ({ getSecret: mockGetSecret }));
const MockDefaultAzureCredential = vi.fn().mockImplementation(() => ({}));

vi.mock("@azure/identity", () => ({ DefaultAzureCredential: MockDefaultAzureCredential }));
vi.mock("@azure/keyvault-secrets", () => ({ SecretClient: MockSecretClient }));

import { loadSecretsFromKeyVault } from "../secrets";

const ENV_KEYS = [
  "NEXTAUTH_SECRET",
  "APPLICATIONINSIGHTS_CONNECTION_STRING",
  "DATABASE_URL",
  "AZURE_AD_CLIENT_SECRET",
  "GOOGLE_CLIENT_SECRET",
];

function clearSecretEnvVars() {
  for (const k of ENV_KEYS) delete process.env[k];
}

beforeEach(() => {
  vi.clearAllMocks();
  clearSecretEnvVars();
  mockGetSecret.mockResolvedValue({ value: "fetched-value" });
});

afterEach(() => {
  delete process.env.KEY_VAULT_URL;
  clearSecretEnvVars();
});

// ── Early return ──────────────────────────────────────────────────────────────

describe("loadSecretsFromKeyVault — no KEY_VAULT_URL", () => {
  it("returns without calling SecretClient when KEY_VAULT_URL is not set", async () => {
    delete process.env.KEY_VAULT_URL;
    await loadSecretsFromKeyVault();
    expect(MockSecretClient).not.toHaveBeenCalled();
  });

  it("does not throw when KEY_VAULT_URL is absent", async () => {
    await expect(loadSecretsFromKeyVault()).resolves.toBeUndefined();
  });
});

// ── Happy path ────────────────────────────────────────────────────────────────

describe("loadSecretsFromKeyVault — with KEY_VAULT_URL", () => {
  beforeEach(() => {
    process.env.KEY_VAULT_URL = "https://my-vault.vault.azure.net/";
  });

  it("constructs SecretClient with the vault URL and a DefaultAzureCredential", async () => {
    await loadSecretsFromKeyVault();
    expect(MockSecretClient).toHaveBeenCalledWith(
      "https://my-vault.vault.azure.net/",
      expect.any(Object)
    );
  });

  it("fetches all required secrets", async () => {
    await loadSecretsFromKeyVault();
    const names = mockGetSecret.mock.calls.map((c) => c[0]);
    expect(names).toContain("nextauth-secret");
    expect(names).toContain("database-url");
    expect(names).toContain("google-client-secret");
  });

  it("populates process.env from fetched secrets", async () => {
    mockGetSecret.mockResolvedValue({ value: "my-secret-value" });
    await loadSecretsFromKeyVault();
    expect(process.env.NEXTAUTH_SECRET).toBe("my-secret-value");
  });

  it("skips fetch when env var is already set", async () => {
    process.env.NEXTAUTH_SECRET = "already-set";
    await loadSecretsFromKeyVault();
    // getSecret should not have been called for nextauth-secret
    const fetchedNames = mockGetSecret.mock.calls.map((c) => c[0]);
    expect(fetchedNames).not.toContain("nextauth-secret");
  });

  it("does not throw when a secret fetch fails", async () => {
    mockGetSecret.mockRejectedValue(new Error("Key Vault unreachable"));
    await expect(loadSecretsFromKeyVault()).resolves.toBeUndefined();
  });

  it("does not set env var when secret value is empty/null", async () => {
    mockGetSecret.mockResolvedValue({ value: null });
    await loadSecretsFromKeyVault();
    expect(process.env.NEXTAUTH_SECRET).toBeUndefined();
  });
});
