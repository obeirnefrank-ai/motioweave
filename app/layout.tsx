import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Motion Weave Taxi Operations",
  description: "Private event taxi operations test app.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
