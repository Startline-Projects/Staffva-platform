"use client";

import { useRouter } from "next/navigation";

interface Props {
  candidateId: string;
  candidateName: string;
  isLoggedIn: boolean;
  isLocked: boolean;
  isLockingClient: boolean;
  clientId: string | null;
}

export default function MessageButton({
  candidateId,
  candidateName,
  isLoggedIn,
  isLocked,
  isLockingClient,
  clientId,
}: Props) {
  const router = useRouter();

  // Locked by another client — cannot message
  if (isLocked && !isLockingClient) {
    return (
      <div className="text-center">
        <button
          disabled
          className="w-full rounded-lg bg-gray-200 px-6 py-3 text-sm font-semibold text-gray-500 cursor-not-allowed"
        >
          Not Available — Currently Engaged
        </button>
      </div>
    );
  }

  // Not logged in — sign up (free)
  if (!isLoggedIn) {
    return (
      <div className="text-center">
        <button
          onClick={() => router.push("/signup/client")}
          className="w-full rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-white hover:bg-primary-dark transition-colors"
        >
          Create Free Account to Message {candidateName}
        </button>
        <p className="mt-2 text-xs text-text/40">
          Free to join. Free to message. No subscription required.
        </p>
      </div>
    );
  }

  // Locking client — manage in team portal
  if (isLockingClient) {
    return (
      <button
        onClick={() => router.push("/team")}
        className="w-full rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-white hover:bg-primary-dark transition-colors"
      >
        Manage in Team Portal
      </button>
    );
  }

  // Logged-in client — free to message + hire
  return (
    <div className="flex gap-3">
      <button
        onClick={() =>
          router.push(`/inbox?candidate=${candidateId}&client=${clientId}`)
        }
        className="flex-1 rounded-lg border border-primary px-6 py-3 text-sm font-semibold text-primary hover:bg-primary/5 transition-colors"
      >
        Message
      </button>
      <button
        onClick={() => router.push(`/hire/${candidateId}`)}
        className="flex-1 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-white hover:bg-primary-dark transition-colors"
      >
        Hire {candidateName}
      </button>
    </div>
  );
}
