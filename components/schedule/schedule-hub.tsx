"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import { CalendarRange, Search } from "lucide-react";
import { PRIMARY_ORANGE_CTA } from "@/lib/ui/primary-orange-cta";

export type ScheduleCard = {
  id: string;
  title: string;
  /** Connecteam-style “Assigned” line. */
  assignedLabel: string;
  href: string;
  /** Shown on card as secondary line (e.g. scope). */
  hint?: string;
};

type Props = {
  activeCards: ScheduleCard[];
  /** Archived modules — placeholder until you persist schedules in DB. */
  archivedCards: ScheduleCard[];
  /** When set, “+ Add” opens the week board add-shift flow for the current week. */
  addShiftHref: string | null;
};

export function ScheduleHub({
  activeCards,
  archivedCards,
  addShiftHref,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const tab = searchParams.get("tab") === "archived" ? "archived" : "active";

  const setTab = useCallback(
    (next: "active" | "archived") => {
      startTransition(() => {
        const q = new URLSearchParams(searchParams.toString());
        if (next === "archived") q.set("tab", "archived");
        else q.delete("tab");
        const s = q.toString();
        router.push(s ? `/schedule?${s}` : "/schedule");
      });
    },
    [router, searchParams],
  );

  const [query, setQuery] = useState("");

  const list = tab === "active" ? activeCards : archivedCards;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.assignedLabel.toLowerCase().includes(q),
    );
  }, [list, query]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-900 ring-1 ring-orange-200/80">
            <CalendarRange className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-800">Schedule</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Open a module to work with the week board, layers, and shift grid.
            </p>
          </div>
        </div>
        {addShiftHref ? (
          <Link
            href={addShiftHref}
            className={`${PRIMARY_ORANGE_CTA} inline-flex shrink-0 items-center justify-center px-4 py-2.5 text-sm`}
          >
            + Add
          </Link>
        ) : (
          <button
            type="button"
            className={`${PRIMARY_ORANGE_CTA} inline-flex shrink-0 items-center justify-center px-4 py-2.5 text-sm disabled:opacity-50`}
            disabled
            title="You don’t have permission to add shifts."
          >
            + Add
          </button>
        )}
      </div>

      <div className="border-b border-slate-200">
        <nav className="flex gap-8" aria-label="Schedule folders">
          <button
            type="button"
            disabled={pending}
            onClick={() => setTab("active")}
            className={`border-b-2 pb-3 text-sm font-semibold transition-colors disabled:opacity-50 ${
                tab === "active"
                  ? "border-orange-500 text-orange-950"
                  : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            Active ({activeCards.length})
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setTab("archived")}
            className={`border-b-2 pb-3 text-sm font-semibold transition-colors disabled:opacity-50 ${
                tab === "archived"
                  ? "border-orange-500 text-orange-950"
                  : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            Archived ({archivedCards.length})
          </button>
        </nav>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder="Search schedules"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-800 placeholder:text-slate-400 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
            aria-label="Search schedules"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-6 py-16 text-center text-sm text-slate-600">
          {tab === "archived"
            ? "No archived schedules yet. Archiving can be added when schedule modules are stored in the database."
            : "No schedules match your search."}
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <li key={c.id}>
              <div className="flex h-full flex-col rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
                <h2 className="text-base font-semibold text-slate-900">{c.title}</h2>
                <p className="mt-3 text-xs text-slate-500">
                  <span className="font-medium text-slate-600">Assigned:</span>{" "}
                  <span className="rounded-md bg-orange-50 px-2 py-0.5 text-orange-950 ring-1 ring-orange-200/60">
                    {c.assignedLabel}
                  </span>
                </p>
                {c.hint ? (
                  <p className="mt-2 text-xs text-slate-400">{c.hint}</p>
                ) : null}
                <div className="mt-5 flex flex-1 items-end justify-between gap-2 border-t border-slate-100 pt-4">
                  <Link
                    href={c.href}
                    className={`${PRIMARY_ORANGE_CTA} inline-flex flex-1 items-center justify-center px-4 py-2.5 text-sm`}
                  >
                    Access
                  </Link>
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-500 hover:bg-slate-50"
                    disabled
                    title="More actions — later."
                    aria-label="More actions"
                  >
                    ···
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
