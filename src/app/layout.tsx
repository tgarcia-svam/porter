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
        {/* Trusted Types `default` policy. Must run before any bundle. Allows the
            framework's script.src assignments only for same-origin /_next/ URLs and
            rejects every other string-to-script/HTML sink (DOM-XSS defence). Inert
            unless the CSP carries require-trusted-types-for 'script'. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `(function(){var tt=window.trustedTypes;if(!tt||!tt.createPolicy)return;try{tt.createPolicy("default",{createScriptURL:function(u){try{var x=new URL(u,location.href);if(x.origin===location.origin&&x.pathname.indexOf("/_next/")===0)return x.href;}catch(e){}throw new TypeError("Blocked untrusted script URL");},createScript:function(){throw new TypeError("Blocked inline script string");},createHTML:function(){throw new TypeError("Blocked HTML string");}});}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        {children}
        <IdleTimeout />
      </body>
    </html>
  );
}
