"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

type NavLink = { href: string; label: string };

interface NavBarProps {
  userEmail: string;
  userName?: string | null;
  role: "ADMIN" | "UPLOADER";
}

export default function NavBar({ userEmail, userName, role }: NavBarProps) {
  const pathname = usePathname();

  const adminLinks: NavLink[] = [
    { href: "/admin", label: "Dashboard" },
    { href: "/admin/schemas", label: "File Formats" },
    { href: "/admin/users", label: "Users" },
    { href: "/admin/organizations", label: "Organizations" },
    { href: "/admin/projects", label: "Projects" },
    { href: "/admin/settings", label: "Settings" },
  ];

  const uploaderLinks: NavLink[] = [{ href: "/upload", label: "Upload" }];

  const links = role === "ADMIN" ? adminLinks : uploaderLinks;

  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-base font-bold text-blue-600 tracking-tight">
              Porter
            </Link>
            <div className="hidden sm:flex items-center gap-1">
              {links.map((link) => {
                const active =
                  link.href === "/admin"
                    ? pathname === "/admin"
                    : pathname.startsWith(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      active
                        ? "bg-blue-50 text-blue-700"
                        : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-xs text-gray-500 max-w-[200px] truncate">
              {userName ?? userEmail}
            </span>
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700">
              {role}
            </span>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
