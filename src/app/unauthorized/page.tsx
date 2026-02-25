import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center space-y-6">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-100">
          <svg
            className="w-7 h-7 text-amber-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            />
          </svg>
        </div>

        <div>
          <h1 className="text-xl font-bold text-gray-900">Access not granted</h1>
          <p className="mt-2 text-sm text-gray-500">
            Your email address has not been added to Porter. Please ask an
            administrator to add your account before signing in.
          </p>
        </div>

        <Link
          href="/login"
          className="inline-block rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
