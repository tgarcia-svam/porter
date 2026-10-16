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
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" className={montserrat.variable}>
      <head>
        {/* Trusted Types `default` policy (public/tt-policy.js). Must run before any bundle, so
            it is a synchronous static script in <head>, not an inline innerHTML script (React
            would re-create that via innerHTML on the client and the policy would block itself).
            Inert unless the CSP carries require-trusted-types-for 'script'. */}
        <script src="/tt-policy.js" nonce={nonce} />
      </head>
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        {children}
        <IdleTimeout />
      </body>
    </html>
  );
}
