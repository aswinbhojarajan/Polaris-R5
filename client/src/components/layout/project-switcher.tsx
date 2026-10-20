import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  ChevronDown,
  FileText,
  Search,
  LayoutGrid,
  Plus,
  Check,
} from "lucide-react";
import {
  setSelectedClientId,
  useSelectedClientId,
  useUrlClientId,
} from "@/hooks/use-selected-client-id";
import { clientMatchesQuery } from "@/lib/client-search";
import { useAuth } from "@/lib/auth";
import type { Client } from "@shared/schema";

export default function ProjectSwitcher() {
  const [location, setLocation] = useLocation();
  const { user } = useAuth();
  const urlClientId = useUrlClientId();
  const storedClientId = useSelectedClientId();

  const isOnCatalog = location === "/app/clients" || location === "/app";
  const selectedClientId = isOnCatalog
    ? null
    : urlClientId || storedClientId;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [userClosed, setUserClosed] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/v1/clients"],
    queryFn: async () => {
      const res = await fetch("/api/v1/clients?org_id=default-org");
      if (!res.ok) throw new Error("Failed to fetch clients");
      return res.json();
    },
    enabled: !!user,
  });

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selectedClientId) ?? null,
    [clients, selectedClientId],
  );

  const filtered = useMemo(() => {
    return clients
      .filter((c) => clientMatchesQuery(c, query))
      .sort((a, b) =>
        (a.projectName || a.name || "").localeCompare(
          b.projectName || b.name || "",
        ),
      );
  }, [clients, query]);

  // Auto-open when authed but no project is selected, so the user can't
  // miss the switcher. Once the user explicitly closes it, don't reopen
  // until a project is picked. Skip on the catalog/home (own UI).
  useEffect(() => {
    if (!user) return;
    if (isOnCatalog) return;
    if (selectedClientId) {
      setUserClosed(false);
      return;
    }
    if (clients.length === 0) return;
    if (!userClosed && !open) setOpen(true);
  }, [user, isOnCatalog, selectedClientId, clients.length, userClosed, open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next && !selectedClientId) setUserClosed(true);
  };

  const handlePick = (id: string) => {
    setSelectedClientId(id);
    setOpen(false);
    setUserClosed(false);
    setLocation(`/app/dashboard?clientId=${id}`);
  };

  const triggerLabel = selectedClient?.projectName
    ? selectedClient.projectName
    : selectedClient?.name
      ? selectedClient.name
      : "Select a project";

  const triggerSub = selectedClient?.name && selectedClient?.projectName
    ? selectedClient.name
    : null;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-ring max-w-[260px] sm:max-w-[360px]"
          data-testid="button-project-switcher"
          aria-label="Switch project"
        >
          <span className="flex-shrink-0 w-7 h-7 rounded bg-[#EDE8FF] flex items-center justify-center">
            <FileText className="h-4 w-4 text-foreground" />
          </span>
          <span className="flex flex-col items-start min-w-0">
            <span
              className="font-semibold text-foreground text-sm truncate max-w-[200px] sm:max-w-[280px]"
              data-testid="text-current-project-name"
            >
              {triggerLabel}
            </span>
            {triggerSub && (
              <span
                className="text-xs text-muted-foreground truncate max-w-[200px] sm:max-w-[280px]"
                data-testid="text-current-client-name"
              >
                {triggerSub}
              </span>
            )}
          </span>
          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[320px] p-0"
        data-testid="popover-project-switcher"
      >
        <div className="p-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects..."
              className="pl-8 h-9"
              data-testid="input-project-switcher-search"
            />
          </div>
        </div>

        <div
          className="max-h-[320px] overflow-y-auto py-1"
          data-testid="list-project-switcher"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No projects match "{query}"
            </div>
          ) : (
            filtered.map((c) => {
              const isCurrent = c.id === selectedClientId;
              return (
                <button
                  type="button"
                  key={c.id}
                  onClick={() => handlePick(c.id)}
                  className="w-full flex items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60 focus:bg-muted/60 focus:outline-none"
                  data-testid={`button-project-switcher-item-${c.id}`}
                >
                  <Check
                    className={`h-4 w-4 mt-0.5 flex-shrink-0 ${isCurrent ? "text-primary" : "text-transparent"}`}
                  />
                  <span className="flex flex-col min-w-0 flex-1">
                    <span className="font-medium text-foreground truncate">
                      {c.projectName || c.name}
                    </span>
                    {c.projectName && c.name && (
                      <span className="text-xs text-muted-foreground truncate">
                        {c.name}
                        {c.industry ? ` · ${c.industry}` : ""}
                      </span>
                    )}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <Separator />

        <div className="p-1">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setLocation("/app/clients");
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded hover:bg-muted/60 focus:bg-muted/60 focus:outline-none"
            data-testid="button-project-switcher-view-all"
          >
            <LayoutGrid className="h-4 w-4 text-muted-foreground" />
            <span>View all projects</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setLocation("/app/clients?create=1");
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded hover:bg-muted/60 focus:bg-muted/60 focus:outline-none"
            data-testid="button-project-switcher-create"
          >
            <Plus className="h-4 w-4 text-muted-foreground" />
            <span>Create project</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
