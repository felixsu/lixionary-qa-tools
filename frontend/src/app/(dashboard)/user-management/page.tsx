"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Shield, RefreshCw, Trash2, ShieldCheck, UserCheck, AlertCircle } from "lucide-react";
import { useAppContext } from "../../context/AppContext";

interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatarUrl: string;
  role: string;
  disabled: boolean;
  createdAt: string;
}

export default function UserManagementPage() {
  const { user, apiCall } = useAppContext();
  const router = useRouter();

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const loadUsers = async () => {
    setIsLoading(true);
    setErrorMsg("");
    try {
      const data = await apiCall("/api/admin/users");
      setUsers(data);
    } catch (e: any) {
      setErrorMsg(e.message || "Failed to load user directory.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (user?.role === "admin") {
      loadUsers();
    }
  }, [user]);

  // Update user role
  const handleUpdateRole = async (targetUser: UserProfile) => {
    const newRole = targetUser.role === "admin" ? "member" : "admin";
    if (targetUser.id === user?.id) {
      alert("You cannot change your own role to prevent locking yourself out of administration functions.");
      return;
    }
    if (!confirm(`Are you sure you want to change ${targetUser.name || targetUser.email}'s role to ${newRole}?`)) return;

    setActionLoadingId(targetUser.id);
    try {
      await apiCall(`/api/admin/users/${targetUser.id}/role`, {
        method: "PUT",
        body: JSON.stringify({ role: newRole }),
      });
      setUsers((prev) =>
        prev.map((u) => (u.id === targetUser.id ? { ...u, role: newRole } : u))
      );
    } catch (e: any) {
      alert(e.message || "Failed to update user role.");
    } finally {
      setActionLoadingId(null);
    }
  };

  // Toggle user status (disabled/enabled)
  const handleToggleStatus = async (targetUser: UserProfile) => {
    const newDisabled = !targetUser.disabled;
    if (targetUser.id === user?.id) {
      alert("You cannot disable your own account.");
      return;
    }
    const actionWord = newDisabled ? "disable" : "enable";
    if (!confirm(`Are you sure you want to ${actionWord} this user account?${newDisabled ? " This will immediately close all their active browser sessions." : ""}`)) return;

    setActionLoadingId(targetUser.id);
    try {
      await apiCall(`/api/admin/users/${targetUser.id}/status`, {
        method: "PUT",
        body: JSON.stringify({ disabled: newDisabled }),
      });
      setUsers((prev) =>
        prev.map((u) => (u.id === targetUser.id ? { ...u, disabled: newDisabled } : u))
      );
    } catch (e: any) {
      alert(e.message || "Failed to toggle user status.");
    } finally {
      setActionLoadingId(null);
    }
  };

  // Delete user
  const handleDeleteUser = async (targetUser: UserProfile) => {
    if (targetUser.id === user?.id) {
      alert("You cannot delete your own account.");
      return;
    }
    if (!confirm(`CAUTION: Are you sure you want to permanently delete the user account for ${targetUser.name || targetUser.email}? This action is irreversible and will close all their active browser sessions.`)) return;

    setActionLoadingId(targetUser.id);
    try {
      await apiCall(`/api/admin/users/${targetUser.id}`, { method: "DELETE" });
      setUsers((prev) => prev.filter((u) => u.id !== targetUser.id));
    } catch (e: any) {
      alert(e.message || "Failed to delete user.");
    } finally {
      setActionLoadingId(null);
    }
  };

  // Auth guard page level
  if (user?.role !== "admin") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-cream text-ink px-6">
        <div className="text-center max-w-md p-8 border border-line bg-panel rounded-2xl shadow-sm">
          <Shield className="h-12 w-12 text-clay mx-auto mb-4" />
          <h2 className="text-xl font-bold text-ink mb-2">Access Denied</h2>
          <p className="text-sm text-stone mb-6">
            You require administrator privileges to access this user directory.
          </p>
          <button
            onClick={() => router.replace("/api-explorer")}
            className="px-4 py-2 bg-clay hover:bg-clay-dark text-white rounded-lg text-sm font-medium transition-colors"
          >
            Back to API explorer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-cream animate-[fadeUp_0.3s_ease-out]">
      {/* Top action bar */}
      <div className="h-14 flex items-center justify-between px-6 border-b border-line flex-shrink-0 bg-cream">
        <h3 className="text-xs font-bold uppercase tracking-wider text-stone">User Directory</h3>
        
        <button
          onClick={loadUsers}
          disabled={isLoading}
          className="h-8 w-8 rounded-lg border border-line flex items-center justify-center hover:bg-panel text-stone hover:text-ink transition-colors disabled:opacity-50"
          title="Refresh user list"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Main content table */}
      <div className="flex-1 overflow-y-auto p-6">
        {errorMsg && (
          <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-danger/30 bg-danger-soft p-4 text-xs text-danger font-semibold max-w-2xl animate-[fadeUp_0.2s_ease-out]">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <p>{errorMsg}</p>
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div
              className="h-7 w-7 rounded-full border-2 border-line border-t-clay mb-3"
              style={{ animation: "spin 0.8s linear infinite" }}
            />
            <p className="text-xs text-stone">Loading user database directory...</p>
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Shield className="h-10 w-10 text-stone/50 mb-3" />
            <div className="text-sm font-semibold text-graphite">No users found</div>
          </div>
        ) : (
          <div className="border border-line rounded-xl overflow-hidden bg-cream max-w-6xl shadow-sm">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="bg-panel border-b border-line text-stone font-semibold uppercase tracking-wider">
                  <th className="px-5 py-3.5">Name / Avatar</th>
                  <th className="px-5 py-3.5">Email Address</th>
                  <th className="px-5 py-3.5">Registration Date</th>
                  <th className="px-5 py-3.5">Role</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {users.map((u) => {
                  const isSelf = u.id === user?.id;
                  const regDate = u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "Legacy User";
                  const isActionLoading = actionLoadingId === u.id;

                  return (
                    <tr key={u.id} className="hover:bg-hover transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          {u.avatarUrl ? (
                            <img src={u.avatarUrl} alt={u.name} className="h-7 w-7 rounded-full border border-line-soft flex-shrink-0" />
                          ) : (
                            <div className="h-7 w-7 rounded-full bg-chip text-graphite flex items-center justify-center font-bold text-[11px] flex-shrink-0">
                              {(u.name || u.email || "D").charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <div className="font-semibold text-ink flex items-center gap-1.5">
                              {u.name || "Developer User"}
                              {isSelf && (
                                <span className="bg-clay text-cream text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                                  You
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-graphite font-medium">{u.email}</td>
                      <td className="px-5 py-4 text-stone">{regDate}</td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            u.role === "admin"
                              ? "bg-clay/5 border-clay/20 text-clay"
                              : "bg-stone/5 border-stone/10 text-stone"
                          }`}
                        >
                          {u.role === "admin" ? <ShieldCheck className="h-3 w-3" /> : <UserCheck className="h-3 w-3" />}
                          {u.role.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            u.disabled
                              ? "bg-danger-soft text-danger border border-danger/10"
                              : "bg-sage/10 text-sage border border-sage/10"
                          }`}
                        >
                          {u.disabled ? "DISABLED" : "ACTIVE"}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-2.5">
                          {/* Update Role Button */}
                          <button
                            onClick={() => handleUpdateRole(u)}
                            disabled={isSelf || isActionLoading}
                            className="px-2.5 py-1.5 border border-line hover:border-clay hover:bg-hover hover:text-clay text-graphite rounded-lg transition-all text-[11px] font-bold disabled:opacity-30 disabled:hover:border-line disabled:hover:bg-transparent disabled:hover:text-graphite"
                            title={isSelf ? "Admins cannot change their own role" : "Toggle user role"}
                          >
                            {u.role === "admin" ? "Make Member" : "Make Admin"}
                          </button>

                          {/* Disable / Enable Button */}
                          <button
                            onClick={() => handleToggleStatus(u)}
                            disabled={isSelf || isActionLoading}
                            className={`px-2.5 py-1.5 border rounded-lg transition-all text-[11px] font-bold disabled:opacity-30 ${
                              u.disabled
                                ? "border-sage/30 hover:border-sage bg-sage/5 hover:bg-sage text-sage hover:text-white"
                                : "border-danger/30 hover:border-danger bg-danger-soft hover:bg-danger text-danger hover:text-white"
                            }`}
                            title={isSelf ? "Admins cannot disable their own account" : u.disabled ? "Enable account" : "Disable account"}
                          >
                            {u.disabled ? "Enable" : "Disable"}
                          </button>

                          {/* Delete Button */}
                          <button
                            onClick={() => handleDeleteUser(u)}
                            disabled={isSelf || isActionLoading}
                            className="p-1.5 border border-danger/20 hover:border-danger hover:bg-danger text-stone hover:text-white rounded-lg transition-all disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-stone"
                            title={isSelf ? "Admins cannot delete their own account" : "Delete account"}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
