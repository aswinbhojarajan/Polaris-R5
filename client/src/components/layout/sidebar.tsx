import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  ChartPie,
  ListCheck,
  Settings,
  Database,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  FileText,
  Shield,
  BookOpen,
  Search as SearchIcon,
  Target,
  CheckSquare,
  PenSquare,
} from "lucide-react";
import { useState } from "react";
import { useRole } from "@/hooks/use-role";
import {
  useSelectedClientId,
  useUrlClientId,
} from "@/hooks/use-selected-client-id";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    label: "Overview",
    items: [
      { href: "/app/dashboard", label: "Dashboard", icon: ChartPie },
      { href: "/app/prompts", label: "Prompts Tracker", icon: ListCheck },
    ],
  },
  {
    label: "Analysis",
    items: [
      { href: "/app/site-xray", label: "Site X-Ray", icon: Database },
      { href: "/app/topics-keywords", label: "Topics & Keywords", icon: SearchIcon },
      { href: "/app/prompt-library", label: "Prompt Library", icon: BookOpen },
    ],
  },
  {
    label: "Opportunities",
    items: [
      { href: "/app/citation-analysis", label: "Citation Analysis", icon: Target },
      { href: "/app/recommendations", label: "Recommendations", icon: CheckSquare },
      { href: "/app/content-generator", label: "Content Generator", icon: PenSquare },
    ],
  },
  {
    label: "Reports",
    items: [
      { href: "/app/reports", label: "Executive Reports", icon: FileText },
    ],
  },
];

const ADMIN_ITEMS: { href: string; label: string }[] = [
  { href: "/app/admin", label: "Operational Dashboard" },
  { href: "/app/admin/users", label: "Users & Invitations" },
  { href: "/app/admin/projects", label: "Projects" },
  { href: "/app/admin/queue", label: "Job Queue" },
  { href: "/app/admin/models", label: "AI Models" },
  { href: "/app/admin/audit", label: "Audit Log" },
];

interface SidebarProps {
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
  /** Task #151 — collapse the sidebar on desktop (≥1024px). No effect on the mobile drawer. */
  isDesktopCollapsed?: boolean;
}

export default function Sidebar({ isMobileOpen = false, onMobileClose, isDesktopCollapsed = false }: SidebarProps) {
  const [location] = useLocation();
  const [adminExpanded, setAdminExpanded] = useState(false);
  const { canAdmin } = useRole();

  // URL → store fallback so the sidebar reflects the active project on
  // first paint of a deep-linked tab (see use-selected-client-id).
  // Catalog/home is the "no project" surface.
  const isOnCatalog = location === "/app/clients" || location === "/app";
  const urlClientId = useUrlClientId();
  const storedClientId = useSelectedClientId();
  const selectedClientId = isOnCatalog ? null : urlClientId || storedClientId;

  const handleLinkClick = () => {
    if (onMobileClose) onMobileClose();
  };

  const linkHref = (href: string): string =>
    selectedClientId ? `${href}?clientId=${selectedClientId}` : href;

  const renderItem = (item: NavItem, opts?: { allowWithoutClient?: boolean }) => {
    const Icon = item.icon;
    const allowWithoutClient = !!opts?.allowWithoutClient;
    const disabled = !allowWithoutClient && !selectedClientId;
    const active =
      location === item.href || location.startsWith(`${item.href}?`);
    return (
      <Link key={item.href} href={linkHref(item.href)}>
        <div
          className={cn(
            "nav-item flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium cursor-pointer",
            active && "active",
            disabled && "opacity-50 cursor-not-allowed",
          )}
          data-testid={`nav-${item.href.replace(/\//g, "-").replace(/^-/, "")}`}
          onClick={(e) => {
            if (disabled) {
              e.preventDefault();
              return;
            }
            handleLinkClick();
          }}
        >
          <Icon className="h-4 w-4" />
          <span>{item.label}</span>
        </div>
      </Link>
    );
  };

  return (
    <>
      <div
        className={`sidebar-overlay ${isMobileOpen ? "active" : ""}`}
        onClick={onMobileClose}
        aria-hidden="true"
      />

      <aside
        id="app-sidebar"
        className={`sidebar-mobile ${isMobileOpen ? "active" : ""} ${isDesktopCollapsed ? "desktop-collapsed" : ""} bg-card border-r border-border h-full flex flex-col`}
      >
        <nav className="p-4 space-y-4 flex-1 overflow-y-auto">
          {SECTIONS.map((section) => (
            <div key={section.label} className="space-y-1">
              <div className="px-3 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {section.label}
              </div>
              {section.items.map((item) => renderItem(item))}
            </div>
          ))}

        </nav>

        {/* max-h + scroll so the expanded Admin submenu stays reachable on
            short viewports instead of clipping below the fold. */}
        <div className="p-4 border-t border-border space-y-1 max-h-[60vh] overflow-y-auto">
          {renderItem({
            href: "/app/client-config",
            label: "Project Settings",
            icon: Settings,
          })}

          {/* Task #144 — Admin lives below Project Settings; only rendered
              for admin users (canAdmin). */}
          {canAdmin && (
            <div className="space-y-1">
              <div
                className={cn(
                  "nav-item flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium cursor-pointer",
                  location.startsWith("/app/admin") && "active",
                )}
                onClick={() => setAdminExpanded(!adminExpanded)}
                data-testid="nav-admin"
              >
                <Shield className="h-4 w-4" />
                <span className="flex-1">Admin</span>
                {adminExpanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
              </div>
              {adminExpanded && (
                <div className="ml-6 mt-1 space-y-1">
                  {ADMIN_ITEMS.map((item) => (
                    <Link key={item.href} href={item.href}>
                      <div
                        className={cn(
                          "flex items-center px-3 py-2 rounded-lg text-sm cursor-pointer hover:bg-[#EDE8FF]",
                          location === item.href &&
                            "bg-[#EDE8FF] text-foreground font-medium",
                        )}
                        data-testid={`nav-${item.href.replace(/\//g, "-").replace(/^-/, "")}`}
                        onClick={handleLinkClick}
                      >
                        {item.label}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
