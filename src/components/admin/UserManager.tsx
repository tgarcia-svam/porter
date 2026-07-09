"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/apiFetch";

type OrgRef = { id: string; name: string };
type AuthMethod = "PASSWORD" | "SSO";
type User = {
  id: string;
  email: string;
  name: string | null;
  role: "ADMIN" | "UPLOADER";
  createdAt: string;
  organization: OrgRef | null;
  authMethod: AuthMethod;
  mfaEnabled: boolean;
  passkeyCount: number;
  lockedUntil: string | null;
  lockedForReset: boolean;
  failedLoginAttempts: number;
};

export default function UserManager({
  initialUsers,
  allOrganizations,
}: {
  initialUsers: User[];
  allOrganizations: OrgRef[];
}) {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<"ADMIN" | "UPLOADER">("UPLOADER");
  const [newOrgId, setNewOrgId] = useState<string>("");
  const [newAuthMethod, setNewAuthMethod] = useState<AuthMethod>("PASSWORD");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addNotice, setAddNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function refreshUsers() {
    const res = await fetch("/api/users");
    if (res.ok) {
      setUsers(await res.json());
    }
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    setAddNotice(null);
    setAdding(true);
    try {
      const res = await apiFetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail.trim(),
          role: newRole,
          organizationId: newOrgId || null,
          authMethod: newAuthMethod,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to add user");
      }
      setAddNotice(
        newAuthMethod === "PASSWORD"
          ? `Invite sent to ${newEmail.trim()} to set a password and enroll MFA.`
          : `${newEmail.trim()} can now sign in with SSO.`
      );
      setNewEmail("");
      setNewRole("UPLOADER");
      setNewOrgId("");
      setNewAuthMethod("PASSWORD");
      await refreshUsers();
      router.refresh();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add user");
    } finally {
      setAdding(false);
    }
  }

  async function handleResetMfa(id: string, email: string) {
    if (!confirm(`Reset MFA for "${email}"? They'll get an email to set a new password and re-enroll.`)) return;
    setActionError(null);
    const res = await apiFetch(`/api/users/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resetMfa: true }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setActionError(data?.error ?? "Failed to reset MFA");
      return;
    }
    await refreshUsers();
  }

  async function handleResendInvite(id: string, email: string) {
    setActionError(null);
    const res = await apiFetch(`/api/users/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resendInvite: true }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setActionError(data?.error ?? "Failed to resend invite");
      return;
    }
    alert(`Invite re-sent to ${email}.`);
  }

  async function handleUnlock(id: string) {
    setActionError(null);
    const res = await apiFetch(`/api/users/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unlock: true }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setActionError(data?.error ?? "Failed to unlock account");
      return;
    }
    await refreshUsers();
  }

  async function handleDeleteUser(id: string, email: string) {
    if (!confirm(`Remove user "${email}"?`)) return;
    setActionError(null);
    const res = await apiFetch(`/api/users/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setActionError(data?.error ?? "Failed to remove user");
      return;
    }
    await refreshUsers();
  }

  async function handleRoleChange(id: string, role: "ADMIN" | "UPLOADER") {
    setActionError(null);
    const res = await apiFetch(`/api/users/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setActionError(data?.error ?? "Failed to update role");
      return;
    }
    await refreshUsers();
  }

  async function handleOrgChange(id: string, organizationId: string | null) {
    setActionError(null);
    const res = await apiFetch(`/api/users/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setActionError(data?.error ?? "Failed to update organization");
      return;
    }
    await refreshUsers();
  }

  return (
    <div className="space-y-6">
      {/* Add User Form */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-900 mb-4">Add user</h2>
        <form onSubmit={handleAddUser} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[240px]">
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Email address
            </label>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              required
              placeholder="user@example.com"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Sign-in
            </label>
            <select
              value={newAuthMethod}
              onChange={(e) => setNewAuthMethod(e.target.value as AuthMethod)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="PASSWORD">Password + MFA</option>
              <option value="SSO">SSO</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Role
            </label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as "ADMIN" | "UPLOADER")}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="UPLOADER">Uploader</option>
              <option value="ADMIN">Admin</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Organization
            </label>
            <select
              value={newOrgId}
              onChange={(e) => setNewOrgId(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">No organization</option>
              {allOrganizations.map((org) => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={adding}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
          >
            {adding ? "Adding…" : "Add user"}
          </button>
        </form>
        {addError && (
          <p className="mt-2 text-sm text-red-600">{addError}</p>
        )}
        {addNotice && (
          <p className="mt-2 text-sm text-green-700">{addNotice}</p>
        )}
      </div>

      {actionError && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {/* User List */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {users.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-gray-500">
            No users yet. Add one above.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left">
                <th className="px-6 py-3 font-medium text-gray-500">User</th>
                <th className="px-6 py-3 font-medium text-gray-500">Role</th>
                <th className="px-6 py-3 font-medium text-gray-500">Organization</th>
                <th className="px-6 py-3 font-medium text-gray-500">Sign-in</th>
                <th className="px-6 py-3 font-medium text-gray-500" />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2">
                      <div>
                        <div className="font-medium text-gray-900">
                          {user.name ?? user.email}
                        </div>
                        {user.name && (
                          <div className="text-xs text-gray-500">{user.email}</div>
                        )}
                      </div>
                      {((user.lockedUntil && new Date(user.lockedUntil) > new Date()) || user.lockedForReset) && (
                        <span className="inline-flex items-center rounded-md bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20">
                          {user.lockedForReset ? "Locked (reset required)" : "Locked"}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-3">
                    <select
                      value={user.role}
                      onChange={(e) =>
                        handleRoleChange(user.id, e.target.value as "ADMIN" | "UPLOADER")
                      }
                      className="rounded-md border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500"
                    >
                      <option value="UPLOADER">Uploader</option>
                      <option value="ADMIN">Admin</option>
                    </select>
                  </td>
                  <td className="px-6 py-3">
                    <select
                      value={user.organization?.id ?? ""}
                      onChange={(e) =>
                        handleOrgChange(user.id, e.target.value || null)
                      }
                      className="rounded-md border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500 max-w-[160px]"
                    >
                      <option value="">No organization</option>
                      {allOrganizations.map((org) => (
                        <option key={org.id} value={org.id}>{org.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-6 py-3">
                    {user.authMethod === "PASSWORD" ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-medium text-gray-700">Password</span>
                        {(() => {
                          const factors = [
                            user.mfaEnabled ? "authenticator" : null,
                            user.passkeyCount > 0 ? `passkey${user.passkeyCount > 1 ? `×${user.passkeyCount}` : ""}` : null,
                          ].filter(Boolean);
                          return factors.length > 0 ? (
                            <span className="text-[11px] text-green-600">MFA: {factors.join(" + ")}</span>
                          ) : (
                            <span className="text-[11px] text-amber-600">MFA pending</span>
                          );
                        })()}
                      </div>
                    ) : (
                      <span className="text-xs font-medium text-gray-700">SSO</span>
                    )}
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex items-center justify-end gap-3">
                      {((user.lockedUntil && new Date(user.lockedUntil) > new Date()) || user.lockedForReset) && (
                        <button
                          onClick={() => handleUnlock(user.id)}
                          className="text-xs text-amber-600 hover:underline"
                        >
                          Unlock
                        </button>
                      )}
                      {user.authMethod === "PASSWORD" && !user.mfaEnabled && user.passkeyCount === 0 && (
                        <button
                          onClick={() => handleResendInvite(user.id, user.email)}
                          className="text-xs text-brand-600 hover:underline"
                        >
                          Resend invite
                        </button>
                      )}
                      {user.authMethod === "PASSWORD" && (user.mfaEnabled || user.passkeyCount > 0) && (
                        <button
                          onClick={() => handleResetMfa(user.id, user.email)}
                          className="text-xs text-amber-600 hover:underline"
                        >
                          Reset MFA
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteUser(user.id, user.email)}
                        className="text-xs text-red-500 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
