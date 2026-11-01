/**
 * Demo account switcher (task M1-T3c-5).
 *
 * Async Server Component. Renders nothing unless demo mode is enabled
 * (`DEMO_MODE === "true"` and `NODE_ENV !== "production"`), so it never
 * appears in production. Lists demo accounts from the database
 * (id, name, email, role only — never the password hash) and submits one
 * plain server-rendered form per account to the guarded POST /api/demo/switch
 * route. No client JavaScript, no new dependencies.
 */
import type { ReactElement } from "react";
import { roleLabel } from "@/domain/roles";
import { DEMO_EMAIL_DOMAIN, isDemoAccountEmail, isDemoEnabled } from "@/server/demoMode";
import { prisma } from "@/server/db";
import { UserRole, UserRoleSchema } from "@/domain/types";

const ROLE_ORDER: Record<UserRole, number> = {
  ADMIN: 0,
  OFFICER: 1,
  DEPT_REP: 2,
  APPROVER: 3,
  LECTURER: 4,
  STUDENT: 5,
};

type DemoAccount = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
};

export default async function DemoSwitcher({
  currentUserId,
}: {
  currentUserId?: string | null;
}): Promise<ReactElement | null> {
  if (!isDemoEnabled(process.env.DEMO_MODE, process.env.NODE_ENV)) {
    return null;
  }

  const users = await prisma.user.findMany({
    where: { email: { endsWith: DEMO_EMAIL_DOMAIN } },
    select: { id: true, name: true, email: true, role: true },
  });

  const accounts: DemoAccount[] = users
    .filter(
      (user): user is DemoAccount =>
        isDemoAccountEmail(user.email) && UserRoleSchema.safeParse(user.role).success,
    )
    .map((user) => ({ ...user, role: UserRoleSchema.parse(user.role) }))
    .sort((a, b) => {
      const orderDiff = ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
      if (orderDiff !== 0) return orderDiff;
      return a.name.localeCompare(b.name);
    });

  if (accounts.length === 0) {
    return null;
  }

  return (
    <details className="border border-amber-300 rounded-md bg-amber-50 p-3 text-sm">
      <summary className="list-item font-bold text-amber-800 cursor-pointer flex items-center gap-2">
        Switch demo account
        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold text-red-600 bg-red-100 border border-red-200">
          DEMO MODE ON
        </span>
      </summary>
      <div className="mt-2 space-y-1">
        {accounts.map((account) => {
          const isCurrent = account.id === currentUserId;
          return (
            <form key={account.id} method="POST" action="/api/demo/switch">
              <input type="hidden" name="userId" value={account.id} />
              <button
                type="submit"
                disabled={isCurrent}
                className={`inline-block text-xs rounded-md border px-2 py-1.5 text-slate-700 transition-colors ${
                  isCurrent
                    ? "font-bold border-amber-400 bg-amber-100 text-amber-900 disabled:opacity-100 cursor-default"
                    : "border-slate-300 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-1"
                }`}
              >
                {account.name} ({roleLabel(account.role)})
              </button>
            </form>
          );
        })}
      </div>
    </details>
  );
}