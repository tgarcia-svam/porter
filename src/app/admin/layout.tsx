import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import NavBar from "@/components/NavBar";
import LoginNoticeBanner from "@/components/LoginNoticeBanner";

export const dynamic = 'force-dynamic';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/upload");

  // Feature 3 — concurrent session evicted
  if (session.user.sessionRevoked) redirect("/login?reason=session_expired");

  // Feature 2 — password expired (change-password page is outside this layout tree)
  if (session.user.passwordExpired) redirect("/account/change-password?expired=1");

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar
        userEmail={session.user.email ?? ""}
        userName={session.user.name}
        role={session.user.role}
      />
      <LoginNoticeBanner session={session} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
