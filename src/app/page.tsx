import Link from "next/link";
import { getCurrentUser } from "@/server/auth";
import { menuForRole } from "@/domain/menu";
import { UserRole } from "@/domain/types";

const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: "Admin",
  OFFICER: "Timetabling Officer",
  DEPT_REP: "Department Rep",
  APPROVER: "Head of Department",
  LECTURER: "Lecturer",
  STUDENT: "Student",
};

/**
 * Home page for TAMS (task M1-T3c-5).
 * Public page: no guard is called here — identity comes from the session only.
 * Signed out: welcome + Sign in link, no menu.
 * Signed in: greet by name and role label, then list menuForRole(role) in order.
 * Built items are links; unbuilt items are greyed out with "Coming soon".
 */
export default async function HomePage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <main className="flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center p-6 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-slate-800">
          Welcome to Kisii University TAMS
        </h1>
        <p className="mt-4 max-w-xl text-slate-600">
          Prototype built on assumptions; please correct us
        </p>
        <p className="mt-6">
          <Link
            href="/login"
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Sign in
          </Link>
        </p>
      </main>
    );
  }

  const roleLabel = ROLE_LABEL[user.role] ?? user.role;
  const items = menuForRole(user.role);

  return (
    <main className="flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center p-6 text-center">
      <h1 className="text-2xl font-bold tracking-tight text-slate-800">
        Welcome, {user.name} ({roleLabel})
      </h1>
      <ul className="mt-6 max-w-xl w-full text-left space-y-2">
        {items.map((item) => (
          <li key={item.key} className="px-4 py-2 rounded-lg border border-slate-200 bg-white">
            {item.built ? (
              <Link
                href={item.href}
                className="rounded-md bg-indigo-600 px-3 py-1 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                {item.label}
              </Link>
            ) : (
              <span className="text-sm text-slate-400">
                {item.label} — Coming soon
              </span>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
