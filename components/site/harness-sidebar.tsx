"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export type HarnessRecent = { id: string; label: string };

type HarnessSidebarProps = {
  activeTitle: string | null;
  recents: HarnessRecent[];
  configActive: boolean;
  onConfigure: () => void;
  onNewRun: () => void;
  onPick: (id: string) => void;
};

function Icon({ children, size = 17 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

export default function HarnessSidebar({
  activeTitle,
  recents,
  configActive,
  onConfigure,
  onNewRun,
  onPick,
}: HarnessSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const visible = recents.filter((recent) => recent.label.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const toggleTheme = () => {
    const nextDark = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", nextDark);
    localStorage.setItem("dah-theme", nextDark ? "dark" : "light");
  };

  return (
    <aside
      aria-label="Harness navigation"
      className="relative hidden h-full shrink-0 overflow-hidden transition-[width] duration-300 lg:flex"
      style={{ width: collapsed ? 52 : 224, transitionTimingFunction: "cubic-bezier(0.16,1,0.3,1)" }}
    >
      <div className="flex min-h-0 w-56 shrink-0 flex-col">
        <div className="mb-2.5 flex h-10 shrink-0 items-center px-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[8px] text-ink">
            <Icon size={18}><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></Icon>
          </span>
          <span className={`ml-1.5 min-w-0 flex-1 truncate text-[14px] font-medium text-ink-2 transition-[opacity,transform] duration-150 ${collapsed ? "pointer-events-none -translate-x-2 opacity-0" : "opacity-100"}`}>Harness Studio</span>
          <button
            type="button"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setCollapsed((current) => !current)}
            className={`flex size-8 shrink-0 items-center justify-center rounded-[8px] text-ink-3 transition-[background-color,color,transform] duration-150 hover:bg-hover-2 hover:text-ink ${collapsed ? "-translate-x-[164px] rotate-180" : ""}`}
          >
            <Icon><path d="M4 5h16v14H4zM9 5v14m5-10-3 3 3 3"/></Icon>
          </button>
        </div>

        <nav aria-label="Primary" className="flex shrink-0 flex-col gap-px px-2">
          <button type="button" onClick={onNewRun} className="flex h-8 w-52 items-center rounded-[8px] px-2 text-left text-ink-2 transition-colors duration-100 hover:bg-hover-2 hover:text-ink">
            <span className="flex size-5 shrink-0 items-center justify-center"><Icon><path d="M4 20l4.2-1 10.7-10.7a2 2 0 0 0-2.8-2.8L5.4 16.2zM14.7 6.9l2.8 2.8"/></Icon></span>
            <span className={`ml-1.5 text-[14px] font-medium transition-opacity duration-150 ${collapsed ? "opacity-0" : "opacity-100"}`}>New run</span>
          </button>
          <button type="button" aria-pressed={configActive} onClick={onConfigure} className={`flex h-8 w-52 items-center rounded-[8px] px-2 text-left transition-colors duration-100 hover:bg-hover-2 ${configActive ? "bg-hover-2 text-ink" : "text-ink-2 hover:text-ink"}`}>
            <span className="flex size-5 shrink-0 items-center justify-center"><Icon><circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/></Icon></span>
            <span className={`ml-1.5 text-[14px] font-medium transition-opacity duration-150 ${collapsed ? "opacity-0" : "opacity-100"}`}>Configure harness</span>
          </button>
        </nav>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-2">
          <div className={`mb-1 h-8 transition-opacity duration-150 ${collapsed ? "pointer-events-none opacity-0" : "opacity-100"}`}>
            {searchOpen ? (
              <div className="flex h-8 items-center rounded-[8px] bg-field px-2 text-ink-3 shadow-hairline">
                <Icon size={15}><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></Icon>
                <input ref={searchRef} aria-label="Search runs" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { setSearchOpen(false); setQuery(""); } }} placeholder="Search runs" className="ml-1.5 min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3" />
                <button type="button" aria-label="Close search" onClick={() => { setSearchOpen(false); setQuery(""); }} className="flex size-6 items-center justify-center rounded-[6px] hover:bg-hover-2"><Icon size={14}><path d="m6 6 12 12M18 6 6 18"/></Icon></button>
              </div>
            ) : (
              <div className="flex h-8 items-center justify-between px-2 text-[12.5px] font-medium text-ink-3">
                <span>Runs</span>
                <button type="button" aria-label="Search runs" onClick={() => setSearchOpen(true)} className="flex size-7 items-center justify-center rounded-[7px] hover:bg-hover-2 hover:text-ink"><Icon size={15}><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></Icon></button>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-px">
            {visible.map((recent) => (
              <button key={recent.id} type="button" title={recent.label} onClick={() => onPick(recent.id)} className={`flex h-8 w-52 items-center rounded-[8px] px-2 text-left transition-colors duration-100 hover:bg-hover-2 ${recent.label === activeTitle ? "bg-hover-2 text-ink" : "text-ink-2 hover:text-ink"}`}>
                <span className={`min-w-0 flex-1 truncate text-[14px] font-medium transition-opacity duration-150 ${collapsed ? "opacity-0" : "opacity-100"}`}>{recent.label}</span>
              </button>
            ))}
            {!query && recents.length === 0 && <p className={`px-2 py-2 text-[12px] leading-relaxed text-ink-3 ${collapsed ? "hidden" : "block"}`}>Completed and active runs will appear here.</p>}
            {query && visible.length === 0 && <p className="px-2 py-2 text-[12px] text-ink-3">No runs found</p>}
          </div>
        </div>

        <div className="mx-2 mt-3 flex h-11 shrink-0 items-center border-t border-line px-2">
          <span className="flex size-5 shrink-0 items-center justify-center"><span className="size-1.5 rounded-full bg-green" /></span>
          <span className={`ml-1.5 min-w-0 flex-1 truncate text-[12px] text-ink-3 transition-opacity duration-150 ${collapsed ? "opacity-0" : "opacity-100"}`}>Local conformance</span>
          <button type="button" aria-label="Toggle theme" onClick={toggleTheme} className={`flex size-7 shrink-0 items-center justify-center rounded-[7px] text-ink-3 transition-[background-color,color,transform] duration-150 hover:bg-hover-2 hover:text-ink ${collapsed ? "-translate-x-[172px]" : ""}`}>
            <Icon size={15}><path d="M20 15.5A8 8 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5z"/></Icon>
          </button>
        </div>
      </div>
    </aside>
  );
}
