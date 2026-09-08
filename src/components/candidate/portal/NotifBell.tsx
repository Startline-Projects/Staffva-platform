"use client";

import PortalNotifBell from "@/components/portal/PortalNotifBell";

/**
 * The candidate bell — the shared portal bell pointed at
 * candidate_notifications (00202). The client portal renders the same
 * component against its own endpoint.
 */
export default function NotifBell() {
  return (
    <PortalNotifBell
      endpoint="/api/candidate/notifications"
      settingsRoute="/candidate/settings/notifications"
      emptyText="Nothing yet. When something happens — a message, an offer, a contract — it lands here."
    />
  );
}
