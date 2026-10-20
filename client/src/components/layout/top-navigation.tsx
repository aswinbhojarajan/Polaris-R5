import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ProjectSwitcher from "@/components/layout/project-switcher";
import { Bell, User, Menu, LogOut, ShieldCheck, UserCog } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useAuth, useLogout } from "@/lib/auth";

interface TopNavigationProps {
  onMobileMenuClick?: () => void;
  /** Task #151 — current desktop collapse state, for toggle a11y semantics. */
  isSidebarCollapsed?: boolean;
}

export default function TopNavigation({ onMobileMenuClick, isSidebarCollapsed = false }: TopNavigationProps) {
  const { user } = useAuth();
  const logout = useLogout();
  const [, setLocation] = useLocation();

  const handleLogout = async () => {
    try {
      await logout.mutateAsync();
    } finally {
      setLocation("/login");
    }
  };

  const initials =
    user?.displayName?.[0]?.toUpperCase() ||
    user?.email?.[0]?.toUpperCase() ||
    "?";

  return (
    <nav className="bg-card border-b border-border shadow-sm">
      <div className="max-w-full px-4 sm:px-6 py-3 sm:py-4">
        <div className="flex items-center justify-between">
          {/* Mobile Menu Button & Logo */}
          <div className="flex items-center space-x-2 sm:space-x-3">
            {/* Task #151 — visible on desktop too: toggles the sidebar
                collapse there; still opens the drawer on mobile. */}
            <button
              onClick={onMobileMenuClick}
              className="mobile-menu-button"
              data-testid="button-mobile-menu"
              aria-label={isSidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
              aria-expanded={!isSidebarCollapsed}
              aria-controls="app-sidebar"
            >
              <Menu className="h-5 w-5" />
            </button>

            <Link href="/app/clients">
              <div className="flex items-center cursor-pointer" data-testid="link-logo">
                <h1 className="text-lg sm:text-xl font-semibold text-foreground">Polaris AI</h1>
              </div>
            </Link>
          </div>

          {/* Right side */}
          <div className="flex items-center space-x-2 sm:space-x-4">
            <ProjectSwitcher />

            {/* User Menu */}
            <div className="flex items-center space-x-1 sm:space-x-2">
              <Button variant="ghost" size="icon" className="hidden sm:flex" data-testid="button-notifications">
                <Bell className="h-4 w-4 text-muted-foreground" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="w-8 h-8 bg-[#EDE8FF] rounded-full flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-ring"
                    data-testid="button-user-menu"
                    aria-label="User menu"
                  >
                    {user ? (
                      <span className="text-xs font-medium text-foreground" data-testid="text-user-initial">
                        {initials}
                      </span>
                    ) : (
                      <User className="text-foreground h-4 w-4" />
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {user ? (
                    <>
                      <DropdownMenuLabel className="font-normal">
                        <div className="flex flex-col space-y-1">
                          <p className="text-sm font-medium leading-none" data-testid="text-user-name">
                            {user.displayName || user.email}
                          </p>
                          <p className="text-xs leading-none text-muted-foreground" data-testid="text-user-email">
                            {user.email}
                          </p>
                        </div>
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setLocation("/app/account/profile")}
                        data-testid="button-profile"
                      >
                        <UserCog className="mr-2 h-4 w-4" />
                        <span>Profile</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setLocation("/app/account/sessions")}
                        data-testid="button-active-sessions"
                      >
                        <ShieldCheck className="mr-2 h-4 w-4" />
                        <span>Active sessions</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={handleLogout}
                        disabled={logout.isPending}
                        data-testid="button-logout"
                      >
                        <LogOut className="mr-2 h-4 w-4" />
                        <span>Sign out</span>
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <DropdownMenuItem onClick={() => setLocation("/login")} data-testid="button-login">
                      <span>Sign in</span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
