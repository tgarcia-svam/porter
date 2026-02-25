"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Schema = { id: string; name: string };
type Assignment = { schema: Schema };
type User = {
  id: string;
  email: string;
  name: string | null;
  role: "ADMIN" | "UPLOADER";
  createdAt: string;
  assignments: Assignment[];
};

export default function UserManager({
  initialUsers,
  allSchemas,
}: {
  initialUsers: User[];
  allSchemas: Schema[];
}) {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<"ADMIN" | "UPLOADER">("UPLOADER");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);

  async function refreshUsers() {
    const res = await fetch("/api/users");
    if (res.ok) {
      setUsers(await res.json());
    }
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    setAdding(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim(), role: newRole }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to add user");
      }
      setNewEmail("");
      setNewRole("UPLOADER");
      await refreshUsers();
      router.refresh();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add user");
    } finally {
      setAdding(false);
    }
  }

  async function handleDeleteUser(id: string, email: string) {
    if (!confirm(`Remove user "${email}"?`)) return;
    await fetch(`/api/users/${id}`, { method: "DELETE" });
    await refreshUsers();
  }

  async function handleRoleChange(id: string, role: "ADMIN" | "UPLOADER") {
    await fetch(`/api/users/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    await refreshUsers();
  }

  async function toggleSchemaAssignment(
    userId: string,
    schemaId: string,
    assigned: boolean
  ) {
    if (assigned) {
      await fetch(`/api/users/${userId}/schemas?schemaId=${schemaId}`, {
        method: "DELETE",
      });
    } else {
      await fetch(`/api/users/${userId}/schemas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schemaId }),
      });
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
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Role
            </label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as "ADMIN" | "UPLOADER")}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="UPLOADER">Uploader</option>
              <option value="ADMIN">Admin</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={adding}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {adding ? "Adding…" : "Add user"}
          </button>
        </form>
        {addError && (
          <p className="mt-2 text-sm text-red-600">{addError}</p>
        )}
      </div>

      {/* User List */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {users.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-gray-400">
            No users yet. Add one above.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left">
                <th className="px-6 py-3 font-medium text-gray-500">User</th>
                <th className="px-6 py-3 font-medium text-gray-500">Role</th>
                <th className="px-6 py-3 font-medium text-gray-500">Schemas</th>
                <th className="px-6 py-3 font-medium text-gray-500" />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const assignedIds = new Set(user.assignments.map((a) => a.schema.id));
                const isExpanded = expandedUser === user.id;

                return (
                  <>
                    <tr
                      key={user.id}
                      className="border-b border-gray-50 last:border-0"
                    >
                      <td className="px-6 py-3">
                        <div className="font-medium text-gray-900">
                          {user.name ?? user.email}
                        </div>
                        {user.name && (
                          <div className="text-xs text-gray-400">{user.email}</div>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        <select
                          value={user.role}
                          onChange={(e) =>
                            handleRoleChange(
                              user.id,
                              e.target.value as "ADMIN" | "UPLOADER"
                            )
                          }
                          className="rounded-md border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="UPLOADER">Uploader</option>
                          <option value="ADMIN">Admin</option>
                        </select>
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex flex-wrap gap-1">
                          {user.assignments.length === 0 ? (
                            <span className="text-gray-400 text-xs">None assigned</span>
                          ) : (
                            user.assignments.slice(0, 3).map((a) => (
                              <span
                                key={a.schema.id}
                                className="inline-block rounded-full bg-blue-50 text-blue-700 px-2 py-0.5 text-xs"
                              >
                                {a.schema.name}
                              </span>
                            ))
                          )}
                          {user.assignments.length > 3 && (
                            <span className="text-xs text-gray-400">
                              +{user.assignments.length - 3} more
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex items-center justify-end gap-3">
                          <button
                            onClick={() =>
                              setExpandedUser(isExpanded ? null : user.id)
                            }
                            className="text-xs text-blue-600 hover:underline"
                          >
                            {isExpanded ? "Close" : "Assign schemas"}
                          </button>
                          <button
                            onClick={() => handleDeleteUser(user.id, user.email)}
                            className="text-xs text-red-500 hover:underline"
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Schema assignment panel */}
                    {isExpanded && (
                      <tr key={`${user.id}-schemas`} className="bg-blue-50/30">
                        <td colSpan={4} className="px-6 py-4">
                          <p className="text-xs font-medium text-gray-600 mb-3">
                            Schema access for {user.name ?? user.email}:
                          </p>
                          {allSchemas.length === 0 ? (
                            <p className="text-xs text-gray-400">
                              No schemas defined yet.
                            </p>
                          ) : (
                            <div className="flex flex-wrap gap-3">
                              {allSchemas.map((schema) => {
                                const assigned = assignedIds.has(schema.id);
                                return (
                                  <label
                                    key={schema.id}
                                    className="flex items-center gap-2 cursor-pointer"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={assigned}
                                      onChange={() =>
                                        toggleSchemaAssignment(
                                          user.id,
                                          schema.id,
                                          assigned
                                        )
                                      }
                                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    <span className="text-sm text-gray-700">
                                      {schema.name}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
