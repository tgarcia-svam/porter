/**
 * Transactional email via Azure Communication Services. Used for password-auth
 * onboarding (invite / set-password links) and self-service password resets.
 *
 * Config (Key Vault → app settings):
 *   ACS_CONNECTION_STRING  — ACS resource connection string
 *   EMAIL_SENDER_ADDRESS   — verified sender, e.g. DoNotReply@<managed-domain>
 *
 * In local dev (no connection string) emails are logged to the console instead of
 * sent, so the invite/reset flows can be exercised without ACS. Sending is
 * best-effort/awaited but failures are surfaced to the caller (the invite/forgot
 * routes decide how to respond).
 */

function baseUrl(): string {
  return (process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

async function sendMail(opts: {
  to: string | string[];
  cc?: string | string[];
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  const connectionString = process.env.ACS_CONNECTION_STRING;
  const sender = process.env.EMAIL_SENDER_ADDRESS;

  const toList = (Array.isArray(opts.to) ? opts.to : [opts.to]).filter(Boolean);
  const ccList = (opts.cc ? (Array.isArray(opts.cc) ? opts.cc : [opts.cc]) : []).filter(Boolean);
  if (toList.length === 0) return; // nothing to send to

  if (!connectionString || !sender) {
    // Dev / unconfigured: don't fail the flow — log so the content is recoverable.
    console.warn(
      `[email] ACS not configured — would send to ${toList.join(", ")}` +
        (ccList.length ? ` (cc ${ccList.join(", ")})` : "") +
        `: ${opts.subject}\n${opts.text}`
    );
    return;
  }

  const { EmailClient } = await import("@azure/communication-email");
  const client = new EmailClient(connectionString);
  const poller = await client.beginSend({
    senderAddress: sender,
    content: { subject: opts.subject, plainText: opts.text, html: opts.html },
    recipients: {
      to: toList.map((address) => ({ address })),
      ...(ccList.length ? { cc: ccList.map((address) => ({ address })) } : {}),
    },
  });
  await poller.pollUntilDone();
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#111;line-height:1.5">
    <div style="max-width:480px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 16px">${title}</h2>
      ${bodyHtml}
      <p style="margin-top:24px;font-size:12px;color:#666">If you weren't expecting this email, you can safely ignore it.</p>
    </div></body></html>`;
}

export async function sendInviteEmail(to: string, rawToken: string): Promise<void> {
  const link = `${baseUrl()}/account/set-password?token=${encodeURIComponent(rawToken)}`;
  await sendMail({
    to,
    subject: "Set up your Porter account",
    text: `You've been invited to Porter. Set your password and configure two-factor authentication here (link expires in 72 hours):\n\n${link}`,
    html: layout(
      "Set up your Porter account",
      `<p>You've been invited to Porter. Click below to set your password and configure two-factor authentication. This link expires in 72 hours.</p>
       <p><a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Set your password</a></p>
       <p style="font-size:12px;color:#666">Or paste this URL into your browser:<br>${link}</p>`
    ),
  });
}

function schemaListHtml(names: string[]): string {
  if (names.length === 0) return "";
  const items = names.map((n) => `<li>${escapeHtml(n)}</li>`).join("");
  return `<ul style="margin:8px 0 0;padding-left:20px">${items}</ul>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

/**
 * Reminder that an upload is due soon. Sent to every user of the organization
 * that's behind (within-org only — other orgs never see this). `missingSchemas`
 * names the schemas that still need a VALID upload for the current period.
 */
export async function sendUploadReminderEmail(opts: {
  recipients: string[];
  projectName: string;
  dueDate: string; // YYYY-MM-DD
  daysBefore: number;
  missingSchemas: string[];
}): Promise<void> {
  if (opts.recipients.length === 0) return;
  const when =
    opts.daysBefore === 0
      ? "today"
      : `in ${opts.daysBefore} day${opts.daysBefore === 1 ? "" : "s"} (${opts.dueDate})`;
  const listText = opts.missingSchemas.length
    ? `\n\nStill needed:\n${opts.missingSchemas.map((n) => `  • ${n}`).join("\n")}`
    : "";
  await sendMail({
    to: opts.recipients,
    subject: `Reminder: "${opts.projectName}" upload due ${opts.daysBefore === 0 ? "today" : "on " + opts.dueDate}`,
    text:
      `An upload for the project "${opts.projectName}" is due ${when}.` +
      ` Please sign in to Porter and submit the required file(s) before the due date.${listText}`,
    html: layout(
      `Upload due ${opts.daysBefore === 0 ? "today" : "soon"}`,
      `<p>An upload for the project <strong>${escapeHtml(opts.projectName)}</strong> is due <strong>${when}</strong>.</p>
       <p>Please sign in to Porter and submit the required file(s) before the due date.</p>
       ${opts.missingSchemas.length ? `<p style="margin-bottom:0"><strong>Still needed:</strong></p>${schemaListHtml(opts.missingSchemas)}` : ""}`
    ),
  });
}

/**
 * Notice that an upload is overdue — the due date has passed and the org has not
 * submitted every required file. Sent to every user of that organization only.
 */
export async function sendUploadOverdueEmail(opts: {
  recipients: string[];
  projectName: string;
  dueDate: string; // YYYY-MM-DD
  missingSchemas: string[];
}): Promise<void> {
  if (opts.recipients.length === 0) return;
  const listText = opts.missingSchemas.length
    ? `\n\nStill missing:\n${opts.missingSchemas.map((n) => `  • ${n}`).join("\n")}`
    : "";
  await sendMail({
    to: opts.recipients,
    subject: `Overdue: "${opts.projectName}" upload was due ${opts.dueDate}`,
    text:
      `An upload for the project "${opts.projectName}" was due on ${opts.dueDate} and has not been completed.` +
      ` Please sign in to Porter and submit the required file(s) as soon as possible.${listText}`,
    html: layout(
      "Upload overdue",
      `<p>An upload for the project <strong>${escapeHtml(opts.projectName)}</strong> was due on <strong>${opts.dueDate}</strong> and has not been completed.</p>
       <p>Please sign in to Porter and submit the required file(s) as soon as possible.</p>
       ${opts.missingSchemas.length ? `<p style="margin-bottom:0"><strong>Still missing:</strong></p>${schemaListHtml(opts.missingSchemas)}` : ""}`
    ),
  });
}

export async function sendResetEmail(to: string, rawToken: string): Promise<void> {
  const link = `${baseUrl()}/account/set-password?token=${encodeURIComponent(rawToken)}`;
  await sendMail({
    to,
    subject: "Reset your Porter password",
    text: `A password reset was requested for your Porter account. Reset it here (link expires in 1 hour):\n\n${link}\n\nIf you didn't request this, ignore this email.`,
    html: layout(
      "Reset your Porter password",
      `<p>A password reset was requested for your Porter account. Click below to choose a new password. This link expires in 1 hour.</p>
       <p><a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Reset password</a></p>
       <p style="font-size:12px;color:#666">Or paste this URL into your browser:<br>${link}</p>`
    ),
  });
}
