"use client";

import { LogOut, UserCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getPostSignOutRedirect, redirectAfterSignOut } from "@/lib/hub-app-url";

type Props = {
  signedIn: boolean;
  myProfileHref: string | null;
  profileUnlinked: boolean;
  userEmail: string;
  collapsed: boolean;
};

export function SidebarAccountFooter({
  signedIn,
  myProfileHref,
  profileUnlinked,
  userEmail,
  collapsed,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  if (!signedIn) return null;

  async function signOut() {
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    const target = getPostSignOutRedirect("/login");
    if (target.startsWith("http://") || target.startsWith("https://")) {
      redirectAfterSignOut("/login");
      return;
    }
    router.refresh();
    router.push(target);
    setLoading(false);
  }

  return (
    <div className="border-t border-slate-200 bg-slate-50/80 p-2">
      {!collapsed ? (
        <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Your account
        </p>
      ) : null}
      {myProfileHref ? (
        <Link
          href={myProfileHref}
          className={`mb-1 flex items-center gap-2 rounded-lg py-2 text-sm font-medium text-slate-800 hover:bg-white ${
            collapsed ? "justify-center px-0" : "px-3"
          }`}
          title={collapsed ? "My profile" : undefined}
        >
          <UserCircle className="h-5 w-5 shrink-0 text-slate-600" aria-hidden />
          {!collapsed ? <span className="truncate">My profile</span> : null}
        </Link>
      ) : profileUnlinked ? (
        !collapsed ? (
          <p className="mb-2 px-3 text-xs text-amber-800">
            No employee email matches your login. Edit the user in <strong className="font-semibold">Users</strong> so{" "}
            <span className="break-all font-mono">{userEmail || "email"}</span> is on their profile.
          </p>
        ) : null
      ) : null}

      <button
        type="button"
        disabled={loading}
        onClick={() => void signOut()}
        className={`flex w-full items-center gap-2 rounded-lg py-2 text-sm font-medium text-slate-800 hover:bg-white disabled:opacity-50 ${
          collapsed ? "justify-center px-0" : "px-3"
        }`}
        title={collapsed ? "Log out" : undefined}
      >
        <LogOut className="h-5 w-5 shrink-0 text-slate-600" aria-hidden />
        {!collapsed ? (loading ? "Logging out…" : "Log out") : null}
      </button>
      {!collapsed && userEmail ? (
        <p className="mt-2 truncate px-3 text-[11px] text-slate-500" title={userEmail}>
          {userEmail}
        </p>
      ) : null}
    </div>
  );
}
