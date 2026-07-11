"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  Clock,
  Copy,
  Pencil,
  Search,
  Store,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  archiveTimeClock,
  createTimeClock,
  deleteTimeClock,
  duplicateTimeClock,
  unarchiveTimeClock,
  updateTimeClockName,
  type ActionResult,
} from "@/app/actions/time-clock-admin";
import { setSelectedLocationId } from "@/app/actions/location";
import { ALL_LOCATIONS_ID } from "@/lib/dashboard/resolve-location";
import { PRIMARY_ORANGE_CTA } from "@/lib/ui/primary-orange-cta";

export type HubClock = {
  id: string;
  name: string;
  status: "active" | "archived";
  /** When the header is "All locations", which store this clock belongs to. */
  storeName?: string | null;
  /** East/West grouping for All-locations hub. */
  storeSide?: "east" | "west" | null;
  /** Active employees at that store (for the Assigned line when `storeName` is set). */
  employeesAtStore?: number;
  hint?: string;
};

type LocationOption = { id: string; name: string };

type Props = {
  locationName: string;
  /** When false, clock cards can fall back to `locationName` for the store label (single-store scope). */
  scopeAll: boolean;
  activeClocks: HubClock[];
  archivedClocks: HubClock[];
  employeeCount: number;
  errorMessage: string | null;
  locationsForAdd: LocationOption[];
  canManageClocks: boolean;
};

function assignedLabel(c: HubClock, employeeCount: number): string {
  if (c.storeName != null && c.employeesAtStore != null) {
    return `All employees at ${c.storeName} (${c.employeesAtStore})`;
  }
  return `All employees at this store (${employeeCount})`;
}

function storeLabelForCard(
  c: HubClock,
  locationName: string,
  scopeAll: boolean,
): string | null {
  if (c.storeName) return c.storeName;
  if (!scopeAll && locationName !== "All locations") return locationName;
  return null;
}

export function TimeClockHub({
  locationName,
  scopeAll,
  activeClocks,
  archivedClocks,
  employeeCount,
  errorMessage,
  locationsForAdd,
  canManageClocks,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const tab = searchParams.get("tab") === "archived" ? "archived" : "active";

  const setTab = useCallback(
    (next: "active" | "archived") => {
      startTransition(() => {
        const q = new URLSearchParams(searchParams.toString());
        if (next === "archived") {
          q.set("tab", "archived");
        } else {
          q.delete("tab");
        }
        const suffix = q.toString();
        router.push(suffix ? `/time-clock?${suffix}` : "/time-clock");
      });
    },
    [router, searchParams],
  );

  const [query, setQuery] = useState("");
  const [sideFilter, setSideFilter] = useState<"all" | "east" | "west" | "other">("all");
  const list = tab === "active" ? activeClocks : archivedClocks;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let result = list;
    if (scopeAll && sideFilter !== "all") {
      result = result.filter((c) => {
        if (sideFilter === "east") return c.storeSide === "east";
        if (sideFilter === "west") return c.storeSide === "west";
        return c.storeSide !== "east" && c.storeSide !== "west";
      });
    }
    if (!q) return result;
    return result.filter((c) => {
      const assign = assignedLabel(c, employeeCount).toLowerCase();
      const store = storeLabelForCard(c, locationName, scopeAll)?.toLowerCase() ?? "";
      return (
        c.name.toLowerCase().includes(q) ||
        assign.includes(q) ||
        store.includes(q) ||
        (c.storeName?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [list, query, employeeCount, locationName, scopeAll, sideFilter]);

  const [showAdd, setShowAdd] = useState(false);
  const [addLocationId, setAddLocationId] = useState(() => locationsForAdd[0]?.id ?? "");
  const [addName, setAddName] = useState("Main clock");
  const [addError, setAddError] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editClock, setEditClock] = useState<{ id: string; name: string } | null>(null);
  const [editNameDraft, setEditNameDraft] = useState("");
  const [editNameError, setEditNameError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const grouped = useMemo(() => {
    if (!scopeAll) return null;
    const east: HubClock[] = [];
    const west: HubClock[] = [];
    const other: HubClock[] = [];
    for (const c of filtered) {
      if (c.storeSide === "east") east.push(c);
      else if (c.storeSide === "west") west.push(c);
      else other.push(c);
    }
    return { east, west, other };
  }, [filtered, scopeAll]);

  // `renderClockCard` is defined later (after action handlers) so it can safely reference them.

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    }
    if (menuOpenId) {
      document.addEventListener("click", onDocClick);
      return () => document.removeEventListener("click", onDocClick);
    }
  }, [menuOpenId]);

  const onCreateClock = () => {
    setAddError(null);
    const locId =
      locationsForAdd.find((l) => l.id === addLocationId)?.id ?? locationsForAdd[0]?.id ?? "";
    if (!locId) {
      setAddError("Pick a store.");
      return;
    }
    setBusy(true);
    void (async () => {
      const r = await createTimeClock({ locationId: locId, name: addName });
      setBusy(false);
      if (!r.ok) {
        setAddError(r.error);
        return;
      }
      setShowAdd(false);
      setAddName("Main clock");
      router.refresh();
    })();
  };

  const runAction = (fn: () => Promise<ActionResult>) => {
    setMenuOpenId(null);
    setBusy(true);
    void (async () => {
      const r = await fn();
      setBusy(false);
      if (!r.ok) {
        window.alert(r.error);
        return;
      }
      router.refresh();
    })();
  };

  const openEditName = (c: HubClock) => {
    setMenuOpenId(null);
    setEditClock({ id: c.id, name: c.name });
    setEditNameDraft(c.name);
    setEditNameError(null);
  };

  const saveEditName = () => {
    if (!editClock) return;
    setEditNameError(null);
    setBusy(true);
    void (async () => {
      const r = await updateTimeClockName({ timeClockId: editClock.id, name: editNameDraft });
      setBusy(false);
      if (!r.ok) {
        setEditNameError(r.error);
        return;
      }
      setEditClock(null);
      router.refresh();
    })();
  };

  const confirmDelete = (c: HubClock) => {
    setMenuOpenId(null);
    const ok = window.confirm(
      `Delete “${c.name}”? This cannot be undone. Clocks with any logged time history cannot be deleted — use Archive instead.`,
    );
    if (!ok) return;
    runAction(() => deleteTimeClock(c.id));
  };

  const singleStoreAdd = locationsForAdd.length === 1;

  const renderClockCard = (c: HubClock) => {
    return (
      <li key={c.id}>
        <div className="flex h-full flex-col rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
          {(() => {
            const store = storeLabelForCard(c, locationName, scopeAll);
            const title = store ?? c.name;
            const clockShort =
              store && c.name.startsWith(`${store} — `)
                ? c.name.slice(`${store} — `.length).trim()
                : store && c.name.startsWith(`${store} - `)
                  ? c.name.slice(`${store} - `.length).trim()
                  : store
                    ? c.name.trim()
                    : null;
            const showClockLine =
              store &&
              clockShort != null &&
              clockShort.length > 0 &&
              clockShort.toLowerCase() !== "main clock";

            return (
              <div>
                <h2 className="text-base font-semibold text-slate-900">{title}</h2>
                {showClockLine ? (
                  <p className="mt-1 text-xs text-slate-500">
                    <span className="text-slate-400">Clock:</span> {clockShort}
                  </p>
                ) : null}
              </div>
            );
          })()}
          <p className="mt-3 text-xs text-slate-500">
            <span className="font-medium text-slate-600">Assigned:</span>{" "}
            <span className="rounded-md bg-orange-50 px-2 py-0.5 text-orange-950 ring-1 ring-orange-200/60">
              {assignedLabel(c, employeeCount)}
            </span>
          </p>
          {c.hint ? <p className="mt-2 text-xs text-slate-400">{c.hint}</p> : null}
          <div className="mt-5 flex flex-1 items-end justify-between gap-2 border-t border-slate-100 pt-4">
            {c.status === "active" ? (
              <Link
                href={`/time-clock/${c.id}`}
                className={`${PRIMARY_ORANGE_CTA} inline-flex flex-1 items-center justify-center px-4 py-2.5 text-sm`}
              >
                Access
              </Link>
            ) : (
              <Link
                href={`/time-clock/${c.id}?view=timesheets`}
                className="inline-flex flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                View history
              </Link>
            )}
            <div className="relative shrink-0" ref={menuOpenId === c.id ? menuRef : null}>
              <button
                type="button"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!canManageClocks}
                title={
                  canManageClocks
                    ? "More actions"
                    : "You need time clock management permission for more actions."
                }
                aria-label="More actions"
                aria-haspopup="true"
                aria-expanded={menuOpenId === c.id}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!canManageClocks) return;
                  setMenuOpenId((o) => (o === c.id ? null : c.id));
                }}
              >
                ···
              </button>
              {menuOpenId === c.id && canManageClocks ? (
                <div
                  className="absolute top-full right-0 z-20 mt-1 min-w-[13.5rem] rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
                  role="menu"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                    onClick={() => openEditName(c)}
                  >
                    <Pencil className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                    Edit name
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                    onClick={() => {
                      setMenuOpenId(null);
                      router.push(`/users/groups?timeClock=${encodeURIComponent(c.id)}`);
                    }}
                  >
                    <Users className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                    Edit assignments
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                    onClick={() => runAction(() => duplicateTimeClock(c.id))}
                  >
                    <Copy className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                    Duplicate
                  </button>
                  {c.status === "active" ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                      onClick={() => runAction(() => archiveTimeClock(c.id))}
                    >
                      <Archive className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                      Archive
                    </button>
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                      onClick={() => runAction(() => unarchiveTimeClock(c.id))}
                    >
                      <ArchiveRestore className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                      Restore
                    </button>
                  )}
                  <div className="my-1 border-t border-slate-100" role="separator" />
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-red-700 hover:bg-red-50"
                    onClick={() => confirmDelete(c)}
                  >
                    <Trash2 className="h-4 w-4 shrink-0 text-red-500" aria-hidden />
                    Delete
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-900 ring-1 ring-orange-200/80">
            <Clock className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-800">Time Clock</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Store clocks for tracking hours. Current scope:{" "}
              <span className="font-medium text-slate-700">{locationName}</span>. Pick a clock to open
              Today or Timesheets.
            </p>
          </div>
        </div>
        <button
          type="button"
          className={`${PRIMARY_ORANGE_CTA} inline-flex shrink-0 items-center justify-center px-4 py-2.5 text-sm disabled:opacity-50`}
          disabled={!canManageClocks || locationsForAdd.length === 0 || pending || busy}
          title={
            !canManageClocks
              ? "You need time clock management permission to add clocks."
              : locationsForAdd.length === 0
                ? "Add stores first, then attach a time clock to each store."
                : "Add a time clock for a store"
          }
          onClick={() => {
            setAddError(null);
            if (locationsForAdd.length > 0) {
              const still = locationsForAdd.some((l) => l.id === addLocationId);
              if (!still) setAddLocationId(locationsForAdd[0].id);
            }
            setShowAdd(true);
          }}
        >
          + Add
        </button>
      </div>

      {errorMessage ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {errorMessage}
        </p>
      ) : null}

      {!scopeAll ? (
        <ScopedToStoreBanner locationName={locationName} disabled={pending || busy} />
      ) : null}

      <div className="border-b border-slate-200">
        <nav className="flex gap-8" aria-label="Clock list sections">
          <button
            type="button"
            disabled={pending || busy}
            onClick={() => setTab("active")}
            className={`border-b-2 pb-3 text-sm font-semibold transition-colors disabled:opacity-50 ${
              tab === "active"
                ? "border-orange-500 text-orange-950"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            Active ({activeClocks.length})
          </button>
          <button
            type="button"
            disabled={pending || busy}
            onClick={() => setTab("archived")}
            className={`border-b-2 pb-3 text-sm font-semibold transition-colors disabled:opacity-50 ${
              tab === "archived"
                ? "border-orange-500 text-orange-950"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            Archived ({archivedClocks.length})
          </button>
        </nav>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-800 placeholder:text-slate-400 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
            aria-label="Search time clocks"
          />
        </div>
        {scopeAll ? (
          <div className="relative min-w-[10rem]">
            <select
              value={sideFilter}
              onChange={(e) => setSideFilter(e.target.value as typeof sideFilter)}
              className="h-full w-full cursor-pointer appearance-none rounded-lg border border-slate-200 bg-white py-2 pl-3 pr-9 text-sm font-medium text-slate-700 hover:bg-slate-50"
              aria-label="Filter by store region"
            >
              <option value="all">All regions</option>
              <option value="east">East stores</option>
              <option value="west">West stores</option>
              <option value="other">Other</option>
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
              aria-hidden
            />
          </div>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-6 py-16 text-center text-sm text-slate-600">
          {tab === "archived"
            ? "No archived time clocks. Archived clocks stay here for history without day-to-day use."
            : query.trim()
              ? "No time clocks match your search."
              : canManageClocks && locationsForAdd.length > 0
                ? "No active time clocks yet. Use + Add to create a clock for a store."
                : "No active time clocks yet. Ask your admin to add a clock for this store, or use + Add if you have access."}
        </div>
      ) : (
        <div className="space-y-8">
          {scopeAll && grouped ? (
            <>
              {grouped.east.length > 0 ? (
                <section>
                  <div className="mb-3 flex items-end justify-between gap-3">
                    <h2 className="text-sm font-semibold tracking-wide text-slate-900">East Stores</h2>
                    <span className="text-xs text-slate-500">{grouped.east.length} clocks</span>
                  </div>
                  <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {grouped.east.map(renderClockCard)}
                  </ul>
                </section>
              ) : null}

              {grouped.west.length > 0 ? (
                <section>
                  <div className="mb-3 flex items-end justify-between gap-3">
                    <h2 className="text-sm font-semibold tracking-wide text-slate-900">West Stores</h2>
                    <span className="text-xs text-slate-500">{grouped.west.length} clocks</span>
                  </div>
                  <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {grouped.west.map(renderClockCard)}
                  </ul>
                </section>
              ) : null}

              {grouped.other.length > 0 ? (
                <section>
                  <div className="mb-3 flex items-end justify-between gap-3">
                    <h2 className="text-sm font-semibold tracking-wide text-slate-900">Other</h2>
                    <span className="text-xs text-slate-500">{grouped.other.length} clocks</span>
                  </div>
                  <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {grouped.other.map(renderClockCard)}
                  </ul>
                </section>
              ) : null}
            </>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map(renderClockCard)}
            </ul>
          )}
        </div>
      )}

      {showAdd ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-clock-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setShowAdd(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-e3"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="add-clock-title" className="text-lg font-semibold text-slate-900">
              New time clock
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Attach a clock to a store so employees can clock in from Today or Timesheets.
            </p>

            <div className="mt-5 space-y-4">
              {singleStoreAdd ? (
                <p className="text-sm text-slate-600">
                  Store:{" "}
                  <span className="font-medium text-slate-800">{locationsForAdd[0]?.name}</span>
                </p>
              ) : (
                <label className="block text-sm font-medium text-slate-700">
                  Store
                  <select
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                    value={addLocationId}
                    onChange={(e) => setAddLocationId(e.target.value)}
                  >
                    {locationsForAdd.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block text-sm font-medium text-slate-700">
                Clock name
                <input
                  type="text"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="e.g. Main clock, Warehouse clock"
                />
              </label>
            </div>

            {addError ? (
              <p className="mt-3 text-sm text-red-600" role="alert">
                {addError}
              </p>
            ) : null}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                onClick={() => setShowAdd(false)}
                disabled={pending || busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`${PRIMARY_ORANGE_CTA} px-4 py-2.5 text-sm disabled:opacity-50`}
                disabled={pending || busy}
                onClick={onCreateClock}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editClock ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-clock-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setEditClock(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-e3"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="edit-clock-title" className="text-lg font-semibold text-slate-900">
              Edit name
            </h2>
            <p className="mt-1 text-sm text-slate-500">Update how this clock appears on the hub and in assignments.</p>
            <label className="mt-5 block text-sm font-medium text-slate-700">
              Clock name
              <input
                type="text"
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                value={editNameDraft}
                onChange={(e) => setEditNameDraft(e.target.value)}
                autoFocus
              />
            </label>
            {editNameError ? (
              <p className="mt-3 text-sm text-red-600" role="alert">
                {editNameError}
              </p>
            ) : null}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                onClick={() => setEditClock(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`${PRIMARY_ORANGE_CTA} px-4 py-2.5 text-sm disabled:opacity-50`}
                disabled={busy}
                onClick={saveEditName}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * "You are scoped to a single store" banner with a one-click reset.
 *
 * Why this exists: store scope is held in a global cookie (`hr_location_id`)
 * via `setSelectedLocationId`, which every dashboard page honors. That makes
 * the scope feel "sticky" when users come back to /time-clock from a
 * specific clock — they see only that store's clocks but no obvious way out.
 *
 * Resetting on route change would silently change scope for *every* page
 * (Schedule, Time Off, Users, etc.), which would be a worse bug than the one
 * we're fixing. So instead we surface a high-visibility chip *here* on the
 * Time Clock index, and let the user decide.
 */
function ScopedToStoreBanner({
  locationName,
  disabled,
}: {
  locationName: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const handleReset = () => {
    if (disabled || pending) return;
    startTransition(async () => {
      await setSelectedLocationId(ALL_LOCATIONS_ID);
      router.refresh();
    });
  };
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col gap-2 rounded-xl border border-orange-200 bg-orange-50/60 px-4 py-3 text-sm text-orange-950 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <Store className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" aria-hidden />
        <p className="min-w-0">
          Showing clocks for{" "}
          <span className="font-semibold">{locationName}</span> only.{" "}
          <span className="text-orange-900/80">
            Switch to all stores to see every location.
          </span>
        </p>
      </div>
      <button
        type="button"
        onClick={handleReset}
        disabled={disabled || pending}
        className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border border-orange-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-orange-900 shadow-sm transition hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-60 sm:self-auto"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
        {pending ? "Switching…" : "View all stores"}
      </button>
    </div>
  );
}
