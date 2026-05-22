import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";
import IdleTimeout from "@/components/IdleTimeout";

const montserrat = Montserrat({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-montserrat",
});

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
    <html lang="en" className={montserrat.variable}>
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        {children}
        <IdleTimeout />
      </body>
    </html>
  );
}
