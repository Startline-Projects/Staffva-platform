import SecuritySettings from "@/components/account/SecuritySettings";

/**
 * The role-neutral home for two-step verification: staff, and the link
 * /api/auth/recover-mfa emails out, both land here and get the legacy
 * chrome, which is correct for them. Candidates and clients reach the same
 * component inside their own portal shells — see
 * candidate/(portal)/settings/security and (client-portal)/settings/security.
 */
export default function AccountSecurityPage() {
  return <SecuritySettings />;
}
