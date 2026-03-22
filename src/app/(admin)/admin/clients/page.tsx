"use client";

import { useState, useEffect } from "react";

interface Client {
  id: string;
  full_name: string;
  email: string;
  company_name: string | null;
  stripe_customer_id: string | null;
  created_at: string;
  active_engagements: number;
  total_fees_usd: number;
}

export default function ClientManagementPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/clients")
      .then((res) => res.json())
      .then((data) => {
        setClients(data.clients || []);
        setLoading(false);
      });
  }, []);

  const totalEngagements = clients.reduce(
    (sum, c) => sum + (c.active_engagements || 0),
    0
  );
  const totalFees = clients.reduce(
    (sum, c) => sum + (c.total_fees_usd || 0),
    0
  );

  return (
    <div>
      <h1 className="text-2xl font-bold text-text">Client Management</h1>

      <div className="mt-6 grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-gray-200 bg-card p-4">
          <p className="text-xs text-text/40">Total Clients</p>
          <p className="mt-1 text-2xl font-bold text-text">{clients.length}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-card p-4">
          <p className="text-xs text-text/40">Active Engagements</p>
          <p className="mt-1 text-2xl font-bold text-green-600">
            {totalEngagements}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-card p-4">
          <p className="text-xs text-text/40">Total Platform Fees</p>
          <p className="mt-1 text-2xl font-bold text-text">
            ${totalFees.toLocaleString()}
          </p>
        </div>
      </div>

      {loading ? (
        <p className="mt-8 text-text/60">Loading clients...</p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs font-medium text-text/40 uppercase tracking-wider">
                <th className="py-3 pr-4">Client</th>
                <th className="py-3 pr-4">Company</th>
                <th className="py-3 pr-4">Joined</th>
                <th className="py-3 pr-4">Engagements</th>
                <th className="py-3 pr-4">Fees Paid</th>
                <th className="py-3">Stripe</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {clients.map((client) => (
                <tr key={client.id}>
                  <td className="py-3 pr-4">
                    <p className="font-medium text-text">{client.full_name}</p>
                    <p className="text-xs text-text/40">{client.email}</p>
                  </td>
                  <td className="py-3 pr-4 text-text/60">
                    {client.company_name || "—"}
                  </td>
                  <td className="py-3 pr-4 text-text/60">
                    {new Date(client.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-3 pr-4 text-text/60">
                    {client.active_engagements || 0}
                  </td>
                  <td className="py-3 pr-4 text-text/60">
                    ${(client.total_fees_usd || 0).toLocaleString()}
                  </td>
                  <td className="py-3">
                    {client.stripe_customer_id ? (
                      <a
                        href={`https://dashboard.stripe.com/customers/${client.stripe_customer_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:text-primary-dark"
                      >
                        View in Stripe
                      </a>
                    ) : (
                      <span className="text-xs text-text/40">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
