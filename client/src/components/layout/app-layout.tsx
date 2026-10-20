import { ReactNode, useEffect, useState } from "react";
import { useLocation } from "wouter";
import TopNavigation from "./top-navigation";
import Sidebar from "./sidebar";

interface AppLayoutProps {
  children: ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [location] = useLocation();

  // Task #151 — desktop sidebar collapse. The catalog/home is the
  // "no project" surface, so the nav starts collapsed there and expanded
  // everywhere else. A manual toggle wins until the user crosses the
  // catalog/non-catalog boundary, where the default is re-applied.
  const isOnCatalog = location === "/app/clients" || location === "/app";
  const [collapseOverride, setCollapseOverride] = useState<boolean | null>(null);
  useEffect(() => {
    setCollapseOverride(null);
  }, [isOnCatalog]);
  const isDesktopCollapsed = collapseOverride ?? isOnCatalog;

  // Reconcile across the breakpoint: an open mobile drawer must not
  // reappear after a desktop detour (drawer state is meaningless ≥1024px).
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setIsMobileSidebarOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const handleMenuClick = () => {
    // Desktop (≥1024px, matches the CSS breakpoint): toggle collapse.
    // Mobile: open the slide-in drawer, unchanged.
    if (typeof window !== "undefined" && window.innerWidth >= 1024) {
      setCollapseOverride(!isDesktopCollapsed);
    } else {
      setIsMobileSidebarOpen(true);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <TopNavigation
        onMobileMenuClick={handleMenuClick}
        isSidebarCollapsed={isDesktopCollapsed}
      />
      <div className="flex flex-1 min-h-0">
        <Sidebar 
          isMobileOpen={isMobileSidebarOpen}
          onMobileClose={() => setIsMobileSidebarOpen(false)}
          isDesktopCollapsed={isDesktopCollapsed}
        />
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
