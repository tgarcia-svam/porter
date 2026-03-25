import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import NavBar from "@/components/NavBar";

export const dynamic = 'force-dynamic';

export default async function UploadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) redirect("/login");

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar
        userEmail={session.user.email ?? ""}
        userName={session.user.name}
        role={session.user.role}
      />
      <main className="w-full px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
