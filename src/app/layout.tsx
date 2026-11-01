/**
 * Root layout for TAMS.
 * Renders the PrototypeBanner on every page.
 * Renders a server-side user bar when a valid session exists.
 * Role-based navigation and authorization belong to M1-T3c, not here.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { PrototypeBanner } from "@/components/PrototypeBanner";
import DemoSwitcher from "@/components/DemoSwitcher";
import { roleLabel } from "@/domain/roles";
import { getCurrentUser, type SafeUser } from "@/server/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "TAMS Prototype — Kisii University",
  description: "Timetabling and Attendance Management System Prototype",
};

/**
 * Server-rendered user bar.
 * Identity comes exclusively from getCurrentUser() (server-side session).
 * No client-supplied values are trusted or displayed.
 */
function UserBar({ user }: { user: SafeUser | null }) {
  if (!user) {
    // Not authenticated — show a sign-in link, no fabricated identity.
    return (
      <div className="flex items-center gap-3">
        <Link
          href="/login"
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white
                     hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500
                     focus:ring-offset-1 transition-colors"
        >
          Sign in
        </Link>
      </div>
    );
  }

  const label = roleLabel(user.role);

  return (
    <div className="flex items-center gap-4">
      {/* User identity — sourced from DB via getCurrentUser(), never from form data */}
      <span className="text-sm text-slate-700 hidden sm:inline">
        <span className="font-medium">{user.name}</span>
        <span className="text-slate-500 ml-1">({label})</span>
      </span>
      {/* Mobile: role only */}
      <span className="text-xs text-slate-500 sm:hidden">{label}</span>

      {/* Logout — POST-only; a plain link would be a GET and is disallowed */}
      <form method="POST" action="/api/auth/logout">
        <button
          type="submit"
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium
                     text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2
                     focus:ring-indigo-500 focus:ring-offset-1 transition-colors"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Get the current user once. The layout is not a security boundary — every
  // page guards itself — but both the user bar and the demo switcher need
  // the same identity from getCurrentUser().
  const user = await getCurrentUser();

  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-slate-50 text-slate-900 flex flex-col">
        {/* Prototype banner — always visible on every page */}
        <PrototypeBanner />

        {/* Top navigation bar with server-rendered user identity */}
        <header className="w-full border-b border-slate-200 bg-white shadow-sm">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2 sm:px-6">
            <Link
              href="/"
              className="text-sm font-bold text-slate-800 hover:text-indigo-700 transition-colors"
            >
              TAMS
            </Link>
            <DemoSwitcher currentUserId={user?.id ?? null} />
            {/* UserBar is a server component receiving identity from the layout */}
            <UserBar user={user} />
          </div>
        </header>

        {children}
      </body>
    </html>
  );
}
