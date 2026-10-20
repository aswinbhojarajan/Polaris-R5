import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { X, Copy } from "lucide-react";

interface ProjectMember {
  userId: string;
  email: string;
  displayName: string | null;
  role: "admin" | "member" | "viewer";
  grantedAt: string | null;
  grantedByUserId: string | null;
  grantedByEmail: string | null;
  isOwner: boolean;
}

interface ProjectInvitation {
  id: string;
  email: string;
  role: "member" | "viewer";
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

/**
 * Per-project sharing dialog. Available to project owners and org admins
 * (the API enforces this; non-eligible callers will see 403s in the toast).
 */
export function ProjectSharingDialog({
  clientId,
  projectName,
  open,
  onOpenChange,
}: {
  clientId: string;
  projectName: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const { toast } = useToast();
  const [grantEmail, setGrantEmail] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<
    | { kind: "member"; userId: string; email: string }
    | { kind: "invitation"; id: string; email: string }
    | null
  >(null);

  const membersKey = ["/api/v1/clients", clientId, "members"] as const;
  const invitesKey = ["/api/v1/clients", clientId, "invitations"] as const;

  const membersQuery = useQuery<{ members: ProjectMember[] }>({
    queryKey: membersKey,
    enabled: open,
  });
  const invitesQuery = useQuery<{ invitations: ProjectInvitation[] }>({
    queryKey: invitesKey,
    enabled: open,
  });

  const grant = useMutation({
    mutationFn: async (email: string) => {
      const res = await apiRequest("POST", `/api/v1/clients/${clientId}/members`, { email });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: membersKey });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/orgs"] });
      setGrantEmail("");
      toast({ title: "Access granted" });
    },
    onError: (err: Error) =>
      toast({
        title: "Could not grant access",
        description: err.message,
        variant: "destructive",
      }),
  });

  const revoke = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest(
        "DELETE",
        `/api/v1/clients/${clientId}/members/${userId}`,
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: membersKey });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/admin/orgs"] });
      toast({ title: "Access revoked" });
    },
    onError: (err: Error) =>
      toast({
        title: "Could not revoke access",
        description: err.message,
        variant: "destructive",
      }),
  });

  const invite = useMutation({
    mutationFn: async (email: string) => {
      const res = await apiRequest(
        "POST",
        `/api/v1/clients/${clientId}/invitations`,
        { email, role: "member" },
      );
      return res.json() as Promise<{ token: string; acceptUrl: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: invitesKey });
      setInviteEmail("");
      // Surface the token in a dedicated modal so the user can copy it
      // explicitly — it will never be shown again.
      setIssuedToken(data.token);
    },
    onError: (err: Error) =>
      toast({
        title: "Invite failed",
        description: err.message,
        variant: "destructive",
      }),
  });

  const revokeInvite = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest(
        "DELETE",
        `/api/v1/clients/${clientId}/invitations/${id}`,
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: invitesKey });
      toast({ title: "Invitation revoked" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle data-testid="text-sharing-title">
            Share &ldquo;{projectName}&rdquo;
          </DialogTitle>
          <DialogDescription>
            Grant access to existing members of this organization, or invite
            new people by email. Org admins always have access.
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Add an existing org member</h3>
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="user@example.com"
              value={grantEmail}
              onChange={(e) => setGrantEmail(e.target.value)}
              data-testid="input-grant-email"
            />
            <Button
              onClick={() => grant.mutate(grantEmail)}
              disabled={!grantEmail || grant.isPending}
              data-testid="button-grant-access"
            >
              Grant access
            </Button>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">People with access</h3>
          {membersQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (membersQuery.data?.members ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Only the project owner and org admins have access.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead className="w-24">Org role</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {membersQuery.data?.members.map((m) => (
                  <TableRow key={m.userId} data-testid={`row-share-${m.userId}`}>
                    <TableCell>
                      {m.email}
                      {m.isOwner && (
                        <Badge className="ml-2" variant="secondary" data-testid={`badge-owner-${m.userId}`}>
                          Owner
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{m.role}</Badge>
                    </TableCell>
                    <TableCell>
                      {!m.isOwner && m.role !== "admin" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setPendingRevoke({
                              kind: "member",
                              userId: m.userId,
                              email: m.email,
                            })
                          }
                          data-testid={`button-revoke-share-${m.userId}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Invite a new user by email</h3>
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="newteammate@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              data-testid="input-invite-share-email"
            />
            <Button
              onClick={() => invite.mutate(inviteEmail)}
              disabled={!inviteEmail || invite.isPending}
              data-testid="button-send-share-invite"
            >
              <Copy className="h-3 w-3 mr-2" /> Create invitation
            </Button>
          </div>
          {(invitesQuery.data?.invitations ?? []).length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitesQuery.data?.invitations.map((inv) => {
                  const status = inv.acceptedAt
                    ? "Accepted"
                    : inv.revokedAt
                      ? "Revoked"
                      : new Date(inv.expiresAt).getTime() < Date.now()
                        ? "Expired"
                        : "Pending";
                  return (
                    <TableRow key={inv.id} data-testid={`row-share-invitation-${inv.id}`}>
                      <TableCell>{inv.email}</TableCell>
                      <TableCell>
                        <Badge
                          variant={status === "Pending" ? "default" : "outline"}
                          data-testid={`status-share-invitation-${inv.id}`}
                        >
                          {status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {status === "Pending" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              setPendingRevoke({
                                kind: "invitation",
                                id: inv.id,
                                email: inv.email,
                              })
                            }
                            data-testid={`button-revoke-share-invitation-${inv.id}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </section>
      </DialogContent>

      {/* Reusable invite-token reveal modal — token is shown once, must be
          copied explicitly. */}
      <Dialog
        open={!!issuedToken}
        onOpenChange={(o) => !o && setIssuedToken(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Copy invitation token</DialogTitle>
            <DialogDescription>
              Send this token to the invited user. It will only be shown once
              — keep this dialog open until you have copied it.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted px-3 py-2 font-mono text-xs break-all" data-testid="text-issued-token">
            {issuedToken}
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                if (issuedToken) {
                  navigator.clipboard?.writeText(issuedToken).catch(() => {});
                  toast({ title: "Token copied" });
                }
              }}
              data-testid="button-copy-issued-token"
            >
              <Copy className="h-3 w-3 mr-2" />
              Copy to clipboard
            </Button>
            <Button onClick={() => setIssuedToken(null)} data-testid="button-close-issued-token">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Destructive confirmation for any revoke action. */}
      <AlertDialog
        open={!!pendingRevoke}
        onOpenChange={(o) => !o && setPendingRevoke(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingRevoke?.kind === "invitation"
                ? "Revoke invitation?"
                : "Revoke project access?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRevoke?.kind === "invitation"
                ? `The invitation for ${pendingRevoke.email} will no longer be redeemable.`
                : pendingRevoke
                  ? `${pendingRevoke.email} will lose access to this project.`
                  : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-revoke">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-revoke"
              onClick={() => {
                if (!pendingRevoke) return;
                if (pendingRevoke.kind === "invitation") {
                  revokeInvite.mutate(pendingRevoke.id);
                } else {
                  revoke.mutate(pendingRevoke.userId);
                }
                setPendingRevoke(null);
              }}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
