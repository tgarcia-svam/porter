"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/apiFetch";

type OrgRef = { id: string; name: string };
type Organization = OrgRef & { _count: { users: number } };
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

const CREATE_NEW_ORG = "__new__";

export default function UserManager({
  initialUsers,
  allOrganizations,
}: {
  initialUsers: User[];
  allOrganizations: Organization[];
}) {
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<"users" | "organizations">("users");

  // ── Users ──────────────────────────────────────────────────────────────
  const [users, setUsers] = useState<User[]>(initialUsers);

  // ── Filters ────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [filterRole, setFilterRole] = useState<"all" | "ADMIN" | "UPLOADER">("all");
  const [filterOrg, setFilterOrg] = useState<"all" | "unassigned" | string>("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "locked" | "mfa_pending">("all");

  const filteredUsers = users.filter((u) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!u.email.toLowerCase().includes(q) && !(u.name ?? "").toLowerCase().includes(q)) return false;
    }
    if (filterRole !== "all" && u.role !== filterRole) return false;
    if (filterOrg === "unassigned" && u.organization) return false;
    if (filterOrg !== "all" && filterOrg !== "unassigned" && u.organization?.id !== filterOrg) return false;
    if (filterStatus === "locked") {
      const isLocked = (u.lockedUntil && new Date(u.lockedUntil) > new Date()) || u.lockedForReset;
      if (!isLocked) return false;
    }
    if (filterStatus === "mfa_pending") {
      if (!(u.authMethod === "PASSWORD" && !u.mfaEnabled && u.passkeyCount === 0)) return false;
    }
    return true;
  });

  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<"ADMIN" | "UPLOADER">("UPLOADER");
  const [newOrgId, setNewOrgId] = useState("");
  const [newOrgName, setNewOrgName] = useState("");
  const [newAuthMethod, setNewAuthMethod] = useState<AuthMethod>("PASSWORD");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addNotice, setAddNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // ── Organizations ──────────────────────────────────────────────────────
  const [organizations, setOrganizations] = useState<Organization[]>(allOrganizations);
  const [newOrgAddName, setNewOrgAddName] = useState("");
  const [addingOrg, setAddingOrg] = useState(false);
  const [addOrgError, setAddOrgError] = useState<string | null>(null);
  const [editingOrgId, setEditingOrgId] = useState<string | null>(null);
  const [editOrgName, setEditOrgName] = useState("");

  // ── Refresh helpers ────────────────────────────────────────────────────
  async function refreshUsers() {
    const res = await fetch("/api/users");
    if (!res.ok) return;
    // The API returns _count.passkeys; map it to passkeyCount to match the User type
    // (the server component does the same mapping on initial load).
    const raw: Array<Omit<User, "passkeyCount"> & { _count: { passkeys: number } }> =
      await res.json();
    setUsers(raw.map((u) => ({ ...u, passkeyCount: u._count.passkeys })));
  }

  async function refreshOrgs() {
    const res = await fetch("/api/organizations");
    if (res.ok) setOrganizations(await res.json());
  }

  // ── User handlers ──────────────────────────────────────────────────────
  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    setAddNotice(null);
    setAdding(true);
    try {
      let resolvedOrgId: string | null = newOrgId || null;
      if (newOrgId === CREATE_NEW_ORG) {
        if (!newOrgName.trim()) throw new Error("Organization name is required");
        const orgRes = await apiFetch("/api/organizations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newOrgName.trim() }),
        });
        if (!orgRes.ok) {
          const d = await orgRes.json();
          throw new Error(d.error ?? "Failed to create organization");
        }
        const created: Organization = await orgRes.json();
        resolvedOrgId = created.id;
        setOrganizations((prev) =>
          [...prev, created].sort((a, b) => a.name.localeCompare(b.name))
        );
      }

      const res = await apiFetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail.trim(),
          role: newRole,
          organizationId: resolvedOrgId,
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
      setNewOrgName("");
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

  // ── Org handlers ───────────────────────────────────────────────────────
  async function handleAddOrg(e: React.FormEvent) {
    e.preventDefault();
    setAddOrgError(null);
    setAddingOrg(true);
    try {
      const res = await apiFetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newOrgAddName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to add organization");
      }
      setNewOrgAddName("");
      await refreshOrgs();
      router.refresh();
    } catch (err) {
      setAddOrgError(err instanceof Error ? err.message : "Failed to add organization");
    } finally {
      setAddingOrg(false);
    }
  }

  async function handleDeleteOrg(id: string, name: string) {
    if (!confirm(`Delete organization "${name}"? Users in this organization will be unassigned.`)) return;
    await apiFetch(`/api/organizations/${id}`, { method: "DELETE" });
    await refreshOrgs();
    await refreshUsers();
    router.refresh();
  }

  function startEditOrg(org: Organization) {
    setEditingOrgId(org.id);
    setEditOrgName(org.name);
  }

  async function handleRenameOrg(id: string) {
    if (!editOrgName.trim()) return;
    await apiFetch(`/api/organizations/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editOrgName.trim() }),
    });
    setEditingOrgId(null);
    await refreshOrgs();
    router.refresh();
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex border-b border-gray-200">
        {(["users", "organizations"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            {tab === "users" ? "Users" : "Organizations"}
          </button>
        ))}
      </div>

      {/* ── Users tab ─────────────────────────────────────────────────── */}
      {activeTab === "users" && (
        <>
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
                  onChange={(e) => {
                    setNewOrgId(e.target.value);
                    if (e.target.value !== CREATE_NEW_ORG) setNewOrgName("");
                  }}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">No organization</option>
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>{org.name}</option>
                  ))}
                  <option value={CREATE_NEW_ORG}>+ Create new organization…</option>
                </select>
                {newOrgId === CREATE_NEW_ORG && (
                  <input
                    autoFocus
                    type="text"
                    value={newOrgName}
                    onChange={(e) => setNewOrgName(e.target.value)}
                    placeholder="Organization name"
                    required
                    className="mt-1 w-full rounded-lg border border-brand-400 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                )}
              </div>
              <button
                type="submit"
                disabled={adding}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
              >
                {adding ? "Adding…" : "Add user"}
              </button>
            </form>
            {addError && <p className="mt-2 text-sm text-red-600">{addError}</p>}
            {addNotice && <p className="mt-2 text-sm text-green-700">{addNotice}</p>}
          </div>

          {actionError && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              {actionError}
            </div>
          )}

          {/* Filter bar */}
          {users.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search name or email…"
                  className="flex-1 min-w-[200px] rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <select
                  value={filterRole}
                  onChange={(e) => setFilterRole(e.target.value as typeof filterRole)}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="all">All roles</option>
                  <option value="ADMIN">Admin</option>
                  <option value="UPLOADER">Uploader</option>
                </select>
                <select
                  value={filterOrg}
                  onChange={(e) => setFilterOrg(e.target.value)}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="all">All organizations</option>
                  <option value="unassigned">Unassigned</option>
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>{org.name}</option>
                  ))}
                </select>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="all">All statuses</option>
                  <option value="locked">Locked</option>
                  <option value="mfa_pending">MFA pending</option>
                </select>
              </div>
              {filteredUsers.length !== users.length && (
                <p className="text-xs text-gray-500">
                  Showing {filteredUsers.length} of {users.length} users
                </p>
              )}
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {users.length === 0 ? (
              <p className="px-6 py-12 text-center text-sm text-gray-500">
                No users yet. Add one above.
              </p>
            ) : filteredUsers.length === 0 ? (
              <p className="px-6 py-12 text-center text-sm text-gray-500">
                No users match the current filters.
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
                  {filteredUsers.map((user) => (
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
                          {organizations.map((org) => (
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
        </>
      )}

      {/* ── Organizations tab ──────────────────────────────────────────── */}
      {activeTab === "organizations" && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Add organization</h2>
            <form onSubmit={handleAddOrg} className="flex gap-2">
              <input
                type="text"
                value={newOrgAddName}
                onChange={(e) => setNewOrgAddName(e.target.value)}
                placeholder="Organization name"
                required
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <button
                type="submit"
                disabled={addingOrg || !newOrgAddName.trim()}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
              >
                {addingOrg ? "Adding…" : "Add"}
              </button>
            </form>
            {addOrgError && <p className="mt-2 text-sm text-red-600">{addOrgError}</p>}
          </div>

          {organizations.length === 0 ? (
            <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
              <p className="text-gray-500 text-sm">No organizations yet. Add one above.</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
              {organizations.map((org) => (
                <div key={org.id} className="flex items-center gap-3 px-5 py-3.5">
                  {editingOrgId === org.id ? (
                    <input
                      autoFocus
                      value={editOrgName}
                      onChange={(e) => setEditOrgName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRenameOrg(org.id);
                        if (e.key === "Escape") setEditingOrgId(null);
                      }}
                      className="flex-1 rounded-md border border-brand-400 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  ) : (
                    <span className="flex-1 text-sm font-medium text-gray-900">{org.name}</span>
                  )}

                  <span className="text-xs text-gray-500">
                    {org._count.users} {org._count.users === 1 ? "user" : "users"}
                  </span>

                  {editingOrgId === org.id ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleRenameOrg(org.id)}
                        className="text-xs text-brand-600 hover:underline font-medium"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingOrgId(null)}
                        className="text-xs text-gray-500 hover:underline"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => startEditOrg(org)}
                        className="text-xs text-brand-600 hover:underline font-medium"
                      >
                        Rename
                      </button>
                      <button
                        onClick={() => handleDeleteOrg(org.id, org.name)}
                        className="text-xs text-red-500 hover:underline font-medium"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
