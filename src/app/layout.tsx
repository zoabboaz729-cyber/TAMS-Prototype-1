import type { Metadata } from "next";
import { PrototypeBanner } from "@/components/PrototypeBanner";
import "./globals.css";

export const metadata: Metadata = {
  title: "TAMS Prototype — Kisii University",
  description: "Timetabling and Attendance Management System Prototype",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-slate-50 text-slate-900 flex flex-col">
        <PrototypeBanner />
        {children}
      </body>
    </html>
  );
}
