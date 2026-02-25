import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import NavBar from "@/components/NavBar";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/upload");

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar
        userEmail={session.user.email ?? ""}
        userName={session.user.name}
        role={session.user.role}
      />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
