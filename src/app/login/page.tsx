/**
 * Login page for TAMS.
 * Renders email + password form. Error codes come from a query parameter;
 * arbitrary query text is never rendered as trusted content.
 * If the user already has a valid session they are redirected to / by the
 * route handler, but this page also shows a short message if they arrive
 * here authenticated (handled in layout's user bar — the page itself is
 * kept simple and stateless).
 */
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";

// Known error codes returned by the login route handler.
// Only these strings are accepted; anything else is silently ignored.
const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials:
    "Invalid email or password. Please check your details and try again.",
  config:
    "Server configuration error — contact the administrator. Your credentials were not checked.",
  bad_request: "The form submission was invalid. Please try again.",
};

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function LoginPage({ searchParams }: PageProps) {
  // If already authenticated, redirect away from the login page.
  const user = await getCurrentUser();
  if (user) {
    redirect("/");
  }

  const params = await searchParams;
  const rawCode = params.e;
  // Accept only a single string value; ignore arrays or unknown codes.
  const errorCode =
    typeof rawCode === "string" && Object.hasOwn(ERROR_MESSAGES, rawCode) ? rawCode : null;
  const errorMessage = errorCode ? ERROR_MESSAGES[errorCode] : null;

  return (
    <main className="flex min-h-[calc(100vh-2.5rem)] flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-sm rounded-xl bg-white shadow-md border border-slate-200 p-8">
        {/* Header */}
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">
            Sign in to TAMS
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Kisii University — Prototype
          </p>
        </div>

        {/* Error alert */}
        {errorMessage && (
          <div
            role="alert"
            aria-live="polite"
            className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {errorMessage}
          </div>
        )}

        {/* Login form — action is the dedicated route handler */}
        <form method="POST" action="/api/auth/login" noValidate>
          <div className="space-y-4">
            {/* Email */}
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm
                           placeholder-slate-400 focus:border-indigo-500 focus:outline-none
                           focus:ring-1 focus:ring-indigo-500"
                placeholder="you@example.ac.ke"
              />
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm
                           placeholder-slate-400 focus:border-indigo-500 focus:outline-none
                           focus:ring-1 focus:ring-indigo-500"
                placeholder="••••••••"
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold
                         text-white shadow-sm hover:bg-indigo-700 focus:outline-none
                         focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2
                         active:bg-indigo-800 transition-colors"
            >
              Sign in
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
