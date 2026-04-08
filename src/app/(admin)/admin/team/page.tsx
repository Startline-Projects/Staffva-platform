"use client";

import InternalChat from "@/components/recruiter/InternalChat";

export default function AdminTeamInboxPage() {
  return (
    <div className="h-[calc(100vh-130px)] flex flex-col">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-[#1C1B1A]">Team Inbox</h1>
        <p className="mt-1 text-sm text-gray-500">Internal messaging for the StaffVA team.</p>
      </div>
      <div className="flex-1 rounded-xl border border-gray-200 overflow-hidden">
        <InternalChat isMobileFullScreen />
      </div>
    </div>
  );
}
