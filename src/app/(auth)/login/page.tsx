"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const authError = searchParams.get("error");
  const verified = searchParams.get("verified");
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  // Forgot password state
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [resetError, setResetError] = useState("");

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setResetError("");
    setResetSuccess(false);
    setResetLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: process.env.NEXT_PUBLIC_SITE_URL + "/reset-password",
    });

    if (error) {
      setResetError(error.message);
    } else {
      setResetSuccess(true);
    }
    setResetLoading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNeedsVerification(false);
    setLoading(true);

    const supabase = createClient();

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }

    // Check email verification status
    const profileRes = await fetch("/api/auth/check-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: data.user?.id }),
    });

    const profileData = await profileRes.json();

    if (profileData.verified === false) {
      // Not verified — sign out and show message
      await supabase.auth.signOut();
      setNeedsVerification(true);
      setLoading(false);
      return;
    }

    const role = data.user?.app_metadata?.role;

    // Honor ?next= for flows that send people here mid-task (the job composer
    // does: the draft waits in localStorage). Same-origin relative paths only —
    // a leading single slash — so this can never become an open redirect.
    const next = searchParams.get("next");
    if (next && next.startsWith("/") && !next.startsWith("//")) {
      router.push(next);
      return;
    }

    if (role === "candidate") {
      router.push("/candidate/dashboard");
    } else if (role === "client") {
      router.push("/browse");
    } else if (role === "admin") {
      router.push("/admin");
    } else if (role === "recruiter" || role === "recruiting_manager") {
      router.push("/recruiter");
    } else {
      router.push("/");
    }
  }

  async function handleResendFromLogin() {
    setResending(true);
    // The response was ignored, so a rejected resend still rendered "Sent!" —
    // on the one action that could rescue an account whose first verification
    // email never arrived.
    const res = await fetch("/api/auth/resend-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setResending(false);

    if (!res.ok) {
      setError(
        res.status === 429
          ? "Too many requests from your network right now. Please wait a minute and try again."
          : "We could not resend the email. Please contact support@staffva.com."
      );
      return;
    }

    setError("");
    setResent(true);
    setTimeout(() => setResent(false), 5000);
  }

  return (
    <>
      <h1 className="text-2xl font-bold text-text">Sign In</h1>
      <p className="mt-1 text-sm text-text/60">
        Welcome back to StaffVA.
      </p>

      {verified === "true" && (
        <div className="mt-4 rounded-lg bg-green-50 border border-green-200 px-3 py-2">
          <p className="text-sm text-green-700 font-medium">Email verified successfully! You can now sign in.</p>
        </div>
      )}
      {verified === "already" && (
        <div className="mt-4 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2">
          <p className="text-sm text-blue-700">Your email is already verified. Please sign in.</p>
        </div>
      )}
      {authError === "auth" && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          Authentication failed. Please try again.
        </p>
      )}
      {authError === "verification" && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          Email verification failed. Please request a new link.
        </p>
      )}
      {authError === "invalid_token" && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          Invalid or expired verification link. Please request a new one.
        </p>
      )}
      {needsVerification && (
        <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-3">
          <p className="text-sm text-amber-800 font-medium">Please verify your email first</p>
          <p className="mt-1 text-xs text-amber-700">
            We sent a verification link to <strong>{email}</strong>. Check your inbox and spam folder.
          </p>
          <button
            onClick={handleResendFromLogin}
            disabled={resending}
            className="mt-2 text-xs font-medium text-primary hover:underline disabled:opacity-50"
          >
            {resending ? "Sending..." : resent ? "Sent!" : "Resend verification email"}
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-text">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text placeholder-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-text">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text placeholder-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Your password"
          />
          <button
            type="button"
            onClick={() => {
              setShowForgotPassword(true);
              setResetEmail(email);
            }}
            className="mt-1 text-xs font-medium text-primary hover:text-primary-dark hover:underline"
          >
            Forgot password?
          </button>
        </div>

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>

      {showForgotPassword && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text">Reset your password</h3>
            <button
              onClick={() => {
                setShowForgotPassword(false);
                setResetSuccess(false);
                setResetError("");
              }}
              className="text-xs text-text/40 hover:text-text/60"
            >
              Close
            </button>
          </div>
          {resetSuccess ? (
            <p className="mt-2 text-sm text-green-700">
              Check your email for a reset link.
            </p>
          ) : (
            <form onSubmit={handleForgotPassword} className="mt-3 space-y-3">
              <input
                type="email"
                required
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text placeholder-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="Enter your email"
              />
              {resetError && (
                <p className="text-sm text-red-600">{resetError}</p>
              )}
              <button
                type="submit"
                disabled={resetLoading}
                className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {resetLoading ? "Sending..." : "Send Reset Link"}
              </button>
            </form>
          )}
        </div>
      )}

      <div className="mt-6 space-y-2 text-center text-sm text-text/60">
        <p>
          Want to apply as a candidate?{" "}
          <Link href="/signup/candidate" className="font-medium text-primary hover:text-primary-dark">
            Apply here
          </Link>
        </p>
        <p>
          Looking to hire?{" "}
          <Link href="/signup/client" className="font-medium text-primary hover:text-primary-dark">
            Sign up as a client
          </Link>
        </p>
      </div>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
