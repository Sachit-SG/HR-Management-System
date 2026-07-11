"use client";

import { ChevronDown, LogOut, UserCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getPostSignOutRedirect, redirectAfterSignOut } from "@/lib/hub-app-url";

type Props = {
  displayName: string;
  userEmail: string;
  signedIn: boolean;
  myProfileHref?: string | null;
  profileUnlinked?: boolean;
};

export function AccountMenu({
  displayName,
  userEmail,
  signedIn,
  myProfileHref = null,
  profileUnlinked = false,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const initial =
    displayName.charAt(0).toUpperCase() || userEmail.charAt(0).toUpperCase() || "?";

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function signOut() {
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    setOpen(false);
    const authEnabled = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";
    const fallback = authEnabled ? "/login" : "/";
    const target = getPostSignOutRedirect(fallback);
    if (target.startsWith("http://") || target.startsWith("https://")) {
      redirectAfterSignOut(fallback);
      return;
    }
    router.refresh();
    router.push(target);
    setLoading(false);
  }

  const authEnabled = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";

  if (!signedIn) {
    if (!authEnabled) {
      return (
        <span
          className="max-w-[11rem] shrink-0 truncate rounded-lg border border-dashed border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600"
          title="Sign-in is turned off in this environment. Turn it on in .env.local and restart the app to use the sign-in page."
        >
          Not signed in — sign-in is turned off
        </span>
      );
    }
    return (
      <Link
        href="/login"
        className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
      >
        Sign in
      </Link>
    );
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        title="Account menu — my profile & log out"
        className="flex max-w-[min(100vw,12rem)] items-center gap-1.5 rounded-lg border border-transparent py-1.5 pl-1 pr-1.5 hover:border-slate-200 hover:bg-slate-50 sm:gap-2 sm:pr-2"
        aria-label="Open account menu (profile and log out)"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-orange-600 text-xs font-semibold text-white shadow-sm">
          {initial}
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block max-w-[7.5rem] truncate text-sm font-medium text-slate-800 sm:max-w-[10rem]">
            {displayName}
          </span>
          <span className="hidden text-[10px] font-medium uppercase tracking-wide text-slate-500 sm:block">
            Account
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1.5 w-64 rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          <div className="border-b border-slate-100 px-3 py-2">
            <p className="truncate text-sm font-semibold text-slate-900">{displayName}</p>
            {userEmail ? (
              <p className="mt-0.5 truncate text-xs text-slate-500" title={userEmail}>
                {userEmail}
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-amber-700">No email found for this session</p>
            )}
          </div>
          {myProfileHref ? (
            <Link
              href={myProfileHref}
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-slate-800 hover:bg-slate-50"
              onClick={() => setOpen(false)}
            >
              <UserCircle className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
              My profile
            </Link>
          ) : signedIn && profileUnlinked ? (
            <p className="px-3 py-2 text-xs leading-snug text-amber-800">
              No employee row matches this login email. In <strong className="font-semibold">Users</strong>
              , set this person&apos;s <strong className="font-semibold">email</strong> to exactly{" "}
              <span className="break-all font-mono">{userEmail || "(missing)"}</span> (we match
              case-insensitively).
            </p>
          ) : null}
          <button
            type="button"
            role="menuitem"
            disabled={loading}
            onClick={() => void signOut()}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            <LogOut className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
            {loading ? "Signing out…" : "Log out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
