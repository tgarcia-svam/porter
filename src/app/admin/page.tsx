import { redirect } from "next/navigation";

// The admin landing page is the Analytics section.
export default function AdminIndex() {
  redirect("/admin/analytics");
}
