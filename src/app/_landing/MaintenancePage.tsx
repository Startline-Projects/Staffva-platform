'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type UserType = 'employee' | 'employer';

interface FormState {
  name: string;
  email: string;
  phone: string;
  country: string;
  user_type: UserType;
  position: string;
  company_name: string;
  hiring_needs: string;
}

const INITIAL_STATE: FormState = {
  name: '',
  email: '',
  phone: '',
  country: '',
  user_type: 'employee',
  position: '',
  company_name: '',
  hiring_needs: '',
};

export default function MaintenancePage() {
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.name.trim() || !form.email.trim() || !form.phone.trim() || !form.country.trim()) {
      setError('Please fill in name, email, phone, and country.');
      return;
    }
    if (form.user_type === 'employee' && !form.position.trim()) {
      setError('Please tell us what position you want to apply for.');
      return;
    }
    if (form.user_type === 'employer' && !form.company_name.trim()) {
      setError('Please enter your company name.');
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { error: insertError } = await supabase.from('waitlist_users').insert({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        country: form.country.trim(),
        user_type: form.user_type,
        position: form.user_type === 'employee' ? form.position.trim() : null,
        company_name: form.user_type === 'employer' ? form.company_name.trim() : null,
        hiring_needs:
          form.user_type === 'employer' && form.hiring_needs.trim()
            ? form.hiring_needs.trim()
            : null,
      });

      if (insertError) throw insertError;
      setSuccess(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#FAFAFA',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 20px',
        fontFamily: 'var(--font-body), system-ui, -apple-system, sans-serif',
        color: '#1C1B1A',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 560,
          background: '#FFFFFF',
          border: '1px solid #E4E0D8',
          borderRadius: 16,
          padding: '40px 32px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.04)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              borderRadius: 999,
              background: '#FFF4EF',
              color: '#E55A2B',
              fontSize: 13,
              fontWeight: 500,
              marginBottom: 20,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#FE6E3E',
              }}
            />
            StaffVA
          </div>
          <h1
            style={{
              fontFamily: 'var(--font-display), Georgia, serif',
              fontSize: 28,
              lineHeight: 1.2,
              margin: '0 0 12px',
              fontWeight: 400,
            }}
          >
            Our site is under maintenance, will be back soon
          </h1>
          <p style={{ color: '#5A5550', fontSize: 15, margin: 0 }}>
            Join the waitlist and we&apos;ll let you know the moment we&apos;re live.
          </p>
        </div>

        {success ? (
          <div
            role="status"
            style={{
              padding: '20px',
              background: '#F1F8F4',
              border: '1px solid #C8E6C9',
              borderRadius: 12,
              textAlign: 'center',
              color: '#2e7d32',
              fontSize: 16,
              fontWeight: 500,
            }}
          >
            You&apos;re on the waitlist!
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Field label="Name">
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                style={inputStyle}
              />
            </Field>

            <Field label="Email">
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                style={inputStyle}
              />
            </Field>

            <Field label="Phone Number">
              <input
                type="tel"
                required
                placeholder="+1 555 000 0000"
                value={form.phone}
                onChange={(e) => update('phone', e.target.value)}
                style={inputStyle}
              />
            </Field>

            <Field label="Country">
              <input
                type="text"
                required
                value={form.country}
                onChange={(e) => update('country', e.target.value)}
                style={inputStyle}
              />
            </Field>

            <Field label="I am a…">
              <div style={{ display: 'flex', gap: 8 }}>
                <RadioChip
                  checked={form.user_type === 'employee'}
                  onClick={() => update('user_type', 'employee')}
                  label="Employee"
                />
                <RadioChip
                  checked={form.user_type === 'employer'}
                  onClick={() => update('user_type', 'employer')}
                  label="Employer"
                />
              </div>
            </Field>

            {form.user_type === 'employee' && (
              <Field label="Position (role) you want to apply for">
                <input
                  type="text"
                  required
                  value={form.position}
                  onChange={(e) => update('position', e.target.value)}
                  style={inputStyle}
                />
              </Field>
            )}

            {form.user_type === 'employer' && (
              <>
                <Field label="Company Name">
                  <input
                    type="text"
                    required
                    value={form.company_name}
                    onChange={(e) => update('company_name', e.target.value)}
                    style={inputStyle}
                  />
                </Field>
                <Field label="Hiring Needs (optional)">
                  <textarea
                    rows={3}
                    value={form.hiring_needs}
                    onChange={(e) => update('hiring_needs', e.target.value)}
                    style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
                  />
                </Field>
              </>
            )}

            {error && (
              <div
                role="alert"
                style={{
                  padding: '10px 12px',
                  background: '#FDECEA',
                  border: '1px solid #F5C2BD',
                  borderRadius: 8,
                  color: '#C0392B',
                  fontSize: 14,
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                marginTop: 8,
                padding: '12px 20px',
                background: loading ? '#F7A181' : '#FE6E3E',
                color: '#fff',
                border: 'none',
                borderRadius: 10,
                fontSize: 15,
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'background 120ms',
              }}
            >
              {loading ? 'Joining…' : 'Join the waitlist'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #E4E0D8',
  borderRadius: 8,
  fontSize: 15,
  color: '#1C1B1A',
  background: '#FFFFFF',
  outline: 'none',
  fontFamily: 'inherit',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: '#5A5550' }}>{label}</span>
      {children}
    </label>
  );
}

function RadioChip({
  checked,
  onClick,
  label,
}: {
  checked: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={checked}
      style={{
        flex: 1,
        padding: '10px 12px',
        borderRadius: 8,
        border: `1px solid ${checked ? '#FE6E3E' : '#E4E0D8'}`,
        background: checked ? '#FFF4EF' : '#FFFFFF',
        color: checked ? '#E55A2B' : '#1C1B1A',
        fontSize: 14,
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'all 120ms',
      }}
    >
      {label}
    </button>
  );
}
