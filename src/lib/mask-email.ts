/** "vledesma@oti.nyc.gov" -> "v•••@oti.nyc.gov". Used where the address is only a label. */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "";
  const at = email.lastIndexOf("@");
  if (at < 1) return email.slice(0, 1) + "•••";
  return `${email[0]}•••@${email.slice(at + 1)}`;
}
