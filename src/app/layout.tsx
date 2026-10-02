import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import { headers } from "next/headers";
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

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Reading headers() opts every route into dynamic rendering so Next.js can
  // stamp the per-request CSP nonce (from x-nonce set in middleware) onto the
  // inline <script> elements it generates for hydration. Without this call,
  // statically rendered pages receive a nonce in the CSP header but their
  // scripts lack the attribute, causing the browser to block them.
  await headers();

  return (
    <html lang="en" className={montserrat.variable}>
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        {children}
        <IdleTimeout />
      </body>
    </html>
  );
}
