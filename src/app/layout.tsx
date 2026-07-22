import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "STVX — Creative Experience",
  description:
    "STVX immersive brand experience: motion, WebGL, luxury digital craft.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl">
      <body className="relative min-h-screen text-[#f5f5f5] antialiased">
        {children}
      </body>
    </html>
  );
}
