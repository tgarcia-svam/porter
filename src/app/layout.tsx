import type { Metadata } from "next";
import "./globals.css";
import IdleTimeout from "@/components/IdleTimeout";

export const metadata: Metadata = {
  title: "Porter — Data File Uploader",
  description: "Upload and validate structured data files",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        {children}
        <IdleTimeout />
      </body>
    </html>
  );
}
