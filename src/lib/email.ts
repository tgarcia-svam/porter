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
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  const connectionString = process.env.ACS_CONNECTION_STRING;
  const sender = process.env.EMAIL_SENDER_ADDRESS;

  if (!connectionString || !sender) {
    // Dev / unconfigured: don't fail the flow — log so the link is recoverable.
    console.warn(
      `[email] ACS not configured — would send to ${opts.to}: ${opts.subject}\n${opts.text}`
    );
    return;
  }

  const { EmailClient } = await import("@azure/communication-email");
  const client = new EmailClient(connectionString);
  const poller = await client.beginSend({
    senderAddress: sender,
    content: { subject: opts.subject, plainText: opts.text, html: opts.html },
    recipients: { to: [{ address: opts.to }] },
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
