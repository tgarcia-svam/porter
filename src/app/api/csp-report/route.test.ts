import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const warn = vi.fn();
vi.mock("@/lib/logger", () => ({ logger: { warn: (...a: unknown[]) => warn(...a) } }));

import { POST } from "./route";

function req(body: string, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/csp-report", {
    method: "POST",
    headers: { "content-type": "application/csp-report", ...headers },
    body,
  });
}

describe("POST /api/csp-report", () => {
  beforeEach(() => warn.mockClear());

  it("accepts a legacy report-uri payload and logs a sanitized summary", async () => {
    const res = await POST(
      req(
        JSON.stringify({
          "csp-report": {
            "violated-directive": "script-src",
            "blocked-uri": "https://evil.example/x.js?token=secret#frag",
            "document-uri": "https://porterdata.com/admin?session=abc",
          },
        })
      )
    );
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    const summary = warn.mock.calls[0][1] as Record<string, string>;
    expect(summary.blocked).toBe("https://evil.example/x.js");
    expect(summary.document).toBe("https://porterdata.com/admin");
    expect(JSON.stringify(summary)).not.toContain("secret");
  });

  it("accepts a Reporting API array payload", async () => {
    const res = await POST(
      req(JSON.stringify([{ type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: "inline" } }]), {
        "content-type": "application/reports+json",
      })
    );
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("tolerates malformed JSON without logging or erroring", async () => {
    const res = await POST(req("{not json"));
    expect(res.status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies", async () => {
    const res = await POST(req("x".repeat(20 * 1024)));
    expect(res.status).toBe(413);
    expect(warn).not.toHaveBeenCalled();
  });
});
