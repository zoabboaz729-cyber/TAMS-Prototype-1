import Link from "next/link";

/**
 * /forbidden — server page, readable by anyone.
 *
 * This page does not call requireAction: the user has already been denied
 * upstream by a guard. It only explains the denial and offers a way back.
 */
export default function ForbiddenPage() {
  return (
    <main className="flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center p-6 text-center">
      <h1 className="text-xl font-bold text-slate-800">
        You do not have permission to open that page.
      </h1>
      <p className="mt-4 text-slate-600">
        Sign in with an account that has the required role, or contact the
        timetabling desk if you believe this is a mistake.
      </p>
      <p className="mt-6">
        <Link
          href="/"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          Back to home
        </Link>
      </p>
    </main>
  );
}
