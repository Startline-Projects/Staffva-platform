"use client";

export default function PlatformSettingsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-text">Platform Settings</h1>

      <div className="mt-8 max-w-lg rounded-xl border border-gray-200 bg-card p-6">
        <p className="text-sm text-text/60">
          Platform settings will be available here as configuration options are
          added. In v5, the platform operates with a fixed 10% fee model — no
          toggleable settings are required at launch.
        </p>
      </div>
    </div>
  );
}
