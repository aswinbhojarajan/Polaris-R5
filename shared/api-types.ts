/**
 * AUTO-GENERATED — do not edit by hand.
 *
 * Regenerate with:
 *   npx tsx scripts/generate-api-types.ts
 *
 * Source: server/routes/openapi.ts (`buildOpenApiDocument()`).
 */
/* eslint-disable */
export interface paths {
    "/api/admin/queue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description JobQueue tunable configuration plus active session count */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["QueueConfigWithSessions"];
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/clients/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        isActive?: boolean;
                        name?: string;
                        ownerUserId?: string | null;
                        projectName?: string;
                    };
                };
            };
            responses: {
                /** @description Project updated (rename / project owner / soft-delete) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            project: {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/admin/orgs/{orgId}/audit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    limit?: number;
                };
                header?: never;
                path: {
                    orgId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Audit log entries */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            entries: {
                                action: string;
                                actorUserId: string | null;
                                createdAt: string;
                                id: string;
                                metadata: {
                                    [key: string]: unknown;
                                };
                                orgId: string | null;
                                targetId: string | null;
                                targetType: string | null;
                            }[];
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/orgs/{orgId}/invitations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    orgId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Invitations list */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            invitations: {
                                acceptedAt: string | null;
                                createdAt: string;
                                /** Format: email */
                                email: string;
                                expiresAt: string;
                                id: string;
                                invitedByUserId: string | null;
                                orgId: string;
                                revokedAt: string | null;
                                /** @enum {string} */
                                role: "admin" | "member" | "viewer";
                            }[];
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    orgId: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        /** Format: email */
                        email: string;
                        /** @enum {string} */
                        role: "admin" | "member" | "viewer";
                    };
                };
            };
            responses: {
                /** @description Invitation created — capture `token` once and deliver to the invitee */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            acceptUrl: string;
                            invitation: {
                                acceptedAt: string | null;
                                createdAt: string;
                                /** Format: email */
                                email: string;
                                expiresAt: string;
                                id: string;
                                invitedByUserId: string | null;
                                orgId: string;
                                revokedAt: string | null;
                                /** @enum {string} */
                                role: "admin" | "member" | "viewer";
                            };
                            token: string;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/orgs/{orgId}/invitations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    orgId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Invitation revoked */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {boolean} */
                            ok: true;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/orgs/{orgId}/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    orgId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Org members */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            members: {
                                displayName: string | null;
                                /** Format: email */
                                email: string;
                                joinedAt: string;
                                membershipId: string;
                                /** @enum {string} */
                                role: "admin" | "member" | "viewer";
                                userId: string;
                            }[];
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    orgId: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        /** Format: email */
                        email: string;
                        /**
                         * @default member
                         * @enum {string}
                         */
                        role?: "admin" | "member" | "viewer";
                    };
                };
            };
            responses: {
                /** @description Member added */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {boolean} */
                            ok: true;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/orgs/{orgId}/members/{userId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    orgId: string;
                    userId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Member removed */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {boolean} */
                            ok: true;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    orgId: string;
                    userId: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        role: "admin" | "member" | "viewer";
                    };
                };
            };
            responses: {
                /** @description Role updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {boolean} */
                            ok: true;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/admin/orgs/{orgId}/pending-resets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    orgId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Active self-service password_reset grants for org members. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            pendingResets: {
                                createdAt: string;
                                email: string;
                                expiresAt: string;
                                id: string;
                                issuedByUserId: string | null;
                                userId: string | null;
                            }[];
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/orgs/{orgId}/users/{userId}/disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    orgId: string;
                    userId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description User disabled and signed out everywhere. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {boolean} */
                            ok: true;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/orgs/{orgId}/users/{userId}/enable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    orgId: string;
                    userId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description User re-enabled. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {boolean} */
                            ok: true;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/orgs/{orgId}/users/{userId}/reset-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    orgId: string;
                    userId: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        reason?: string;
                    };
                };
            };
            responses: {
                /** @description Single-use reset link issued; target user is signed out everywhere. Atomically revokes any outstanding self-service /forgot-password grants for this email so only one valid recovery link exists at a time — `revokedSelfService` reports how many were superseded. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            acceptUrl: string;
                            expiresAt: string;
                            revokedSelfService: number;
                            token: string;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/orgs/{orgId}/users/{userId}/sign-out-everywhere": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    orgId: string;
                    userId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Session epoch bumped; all of the target user's existing sessions are now invalid. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {boolean} */
                            ok: true;
                            sessionEpoch: number;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/orgs/{orgId}/users/{userId}/temp-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    orgId: string;
                    userId: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        reason?: string;
                    };
                };
            };
            responses: {
                /** @description Random temporary password issued; mustChangeOnNextLogin set; sessions revoked. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {boolean} */
                            mustChangeOnNextLogin: true;
                            tempPassword: string;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/ai-models": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description List of AI models with key availability */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AiModelWithStatus"][];
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/change-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        currentPassword: string;
                        newPassword: string;
                    };
                };
            };
            responses: {
                /** @description Password changed; all other sessions revoked. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {boolean} */
                            ok: true;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/credential-grants/{token}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    token: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Grant status (valid|consumed|revoked|expired) for the supplied token. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            email?: string;
                            expiresAt?: string;
                            kind: string;
                            /** @enum {string} */
                            status: "valid" | "consumed" | "revoked" | "expired";
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/credential-grants/{token}/redeem": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    token: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        displayName?: string;
                        password: string;
                    };
                };
            };
            responses: {
                /** @description Grant consumed; user authenticated. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {boolean} */
                            ok: true;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/forgot-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        /** Format: email */
                        email: string;
                    };
                };
            };
            responses: {
                /** @description Always 202, regardless of whether the email exists (anti-enumeration). */
                202: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description List of the caller's active sessions; the current one is flagged. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            currentSessionId: string;
                            sessions: {
                                createdAt: string;
                                current: boolean;
                                ipAddress: string | null;
                                lastSeenAt: string;
                                sessionId: string;
                                userAgent: string | null;
                            }[];
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/sessions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Session revoked (idempotent). */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/sessions/sign-out-others": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Bumps the caller's session epoch — every other session is now invalid. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            newEpoch: number;
                            /** @enum {boolean} */
                            ok: true;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/clients": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    /** @description Organization id (legacy: org_id) */
                    orgId?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description List of clients */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            aliases?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            brandAliases?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            customGeography?: string | null;
                            customIndustry?: string | null;
                            disabledModelNotifications?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            focusAreas?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            geography?: string | null;
                            id: string;
                            industry?: string | null;
                            isActive?: boolean;
                            name: string;
                            /** @enum {string|null} */
                            onboardingStatus?: "draft" | "inprogress" | "completed" | null;
                            orgId: string;
                            ownerUserId?: string | null;
                            primaryLanguage?: string | null;
                            primaryTestLocation?: string | null;
                            projectName: string;
                            selectedAiModelIds?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            targetCustomerPersona?: string | null;
                            targetMarketCountry?: string | null;
                            urls?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            website?: string | null;
                        }[];
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        aliases?: string | number | boolean | unknown | {
                            [key: string]: unknown;
                        } | unknown[] | unknown;
                        brandAliases?: string | number | boolean | unknown | {
                            [key: string]: unknown;
                        } | unknown[] | unknown;
                        competitors?: {
                            aliases?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            name: string;
                            website?: string | null;
                        }[];
                        customGeography?: string | null;
                        customIndustry?: string | null;
                        disabledModelNotifications?: string | number | boolean | unknown | {
                            [key: string]: unknown;
                        } | unknown[] | unknown;
                        focusAreas?: string | number | boolean | unknown | {
                            [key: string]: unknown;
                        } | unknown[] | unknown;
                        geography?: string | null;
                        industry?: string | null;
                        isActive?: boolean;
                        modelIds?: string[];
                        name: string;
                        /** @enum {string|null} */
                        onboardingStatus?: "draft" | "inprogress" | "completed" | null;
                        orgId: string;
                        ownerUserId?: string | null;
                        primaryLanguage?: string | null;
                        primaryTestLocation?: string | null;
                        projectName: string;
                        selectedAiModelIds?: string | number | boolean | unknown | {
                            [key: string]: unknown;
                        } | unknown[] | unknown;
                        targetCustomerPersona?: string | null;
                        targetMarketCountry?: string | null;
                        urls?: string | number | boolean | unknown | {
                            [key: string]: unknown;
                        } | unknown[] | unknown;
                        website?: string | null;
                    };
                };
            };
            responses: {
                /** @description Created client */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            aliases?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            brandAliases?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            customGeography?: string | null;
                            customIndustry?: string | null;
                            disabledModelNotifications?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            focusAreas?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            geography?: string | null;
                            id: string;
                            industry?: string | null;
                            isActive?: boolean;
                            name: string;
                            /** @enum {string|null} */
                            onboardingStatus?: "draft" | "inprogress" | "completed" | null;
                            orgId: string;
                            ownerUserId?: string | null;
                            primaryLanguage?: string | null;
                            primaryTestLocation?: string | null;
                            projectName: string;
                            selectedAiModelIds?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            targetCustomerPersona?: string | null;
                            targetMarketCountry?: string | null;
                            urls?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            website?: string | null;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/clients/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The client */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            aliases?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            brandAliases?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            customGeography?: string | null;
                            customIndustry?: string | null;
                            disabledModelNotifications?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            focusAreas?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            geography?: string | null;
                            id: string;
                            industry?: string | null;
                            isActive?: boolean;
                            name: string;
                            /** @enum {string|null} */
                            onboardingStatus?: "draft" | "inprogress" | "completed" | null;
                            orgId: string;
                            ownerUserId?: string | null;
                            primaryLanguage?: string | null;
                            primaryTestLocation?: string | null;
                            projectName: string;
                            selectedAiModelIds?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            targetCustomerPersona?: string | null;
                            targetMarketCountry?: string | null;
                            urls?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            website?: string | null;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        aliases?: string | number | boolean | unknown | {
                            [key: string]: unknown;
                        } | unknown[] | unknown;
                        brandAliases?: string | number | boolean | unknown | {
                            [key: string]: unknown;
                        } | unknown[] | unknown;
                        customGeography?: string | null;
                        customIndustry?: string | null;
                        disabledModelNotifications?: string | number | boolean | unknown | {
                            [key: string]: unknown;
                        } | unknown[] | unknown;
                        focusAreas?: string | number | boolean | unknown | {
                            [key: string]: unknown;
                        } | unknown[] | unknown;
                        geography?: string | null;
                        industry?: string | null;
                        isActive?: boolean;
                        name?: string;
                        /** @enum {string|null} */
                        onboardingStatus?: "draft" | "inprogress" | "completed" | null;
                        orgId?: string;
                        ownerUserId?: string | null;
                        primaryLanguage?: string | null;
                        primaryTestLocation?: string | null;
                        projectName?: string;
                        selectedAiModelIds?: string | number | boolean | unknown | {
                            [key: string]: unknown;
                        } | unknown[] | unknown;
                        targetCustomerPersona?: string | null;
                        targetMarketCountry?: string | null;
                        urls?: string | number | boolean | unknown | {
                            [key: string]: unknown;
                        } | unknown[] | unknown;
                        website?: string | null;
                    };
                };
            };
            responses: {
                /** @description Updated client */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            aliases?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            brandAliases?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            customGeography?: string | null;
                            customIndustry?: string | null;
                            disabledModelNotifications?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            focusAreas?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            geography?: string | null;
                            id: string;
                            industry?: string | null;
                            isActive?: boolean;
                            name: string;
                            /** @enum {string|null} */
                            onboardingStatus?: "draft" | "inprogress" | "completed" | null;
                            orgId: string;
                            ownerUserId?: string | null;
                            primaryLanguage?: string | null;
                            primaryTestLocation?: string | null;
                            projectName: string;
                            selectedAiModelIds?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            targetCustomerPersona?: string | null;
                            targetMarketCountry?: string | null;
                            urls?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            website?: string | null;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Deleted */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            message: string;
                            success?: boolean;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/clients/{id}/copy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        projectName?: string;
                    };
                };
            };
            responses: {
                /** @description Copy job started */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            jobId: string;
                            message: string;
                            success: boolean;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/clients/{id}/generate-metadata": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        enableSiteXRay?: boolean;
                    };
                };
            };
            responses: {
                /** @description Metadata generation started */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            clientId: string;
                            jobId: string;
                            message: string;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/clients/{id}/models": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Models selected for the client */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {string} */
                            category?: "core" | "additional";
                            costPer1kInput?: string | null;
                            costPer1kOutput?: string | null;
                            disabledAt?: string | null;
                            disabledByUserId?: string | null;
                            disabledReason?: string | null;
                            displayName: string;
                            enabled?: boolean;
                            id: string;
                            internalOnly?: boolean;
                            maxRpm?: number | null;
                            maxTpm?: number | null;
                            model: string;
                            vendor: string;
                        }[];
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        model_ids: string[];
                    };
                };
            };
            responses: {
                /** @description Updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            success: boolean;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/clients/{id}/refresh-prompts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Prompts refreshed from accepted topics */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            message: string;
                            promptCount?: number;
                            prompts?: {
                                accepted?: boolean;
                                categoryId?: string | null;
                                clientId: string;
                                diagnosticFocus?: string | null;
                                id: string;
                                /** @enum {string|null} */
                                intentTier?: "branded" | "semi_branded" | "unbranded" | null;
                                /** @enum {string} */
                                source: "crawl" | "manual" | "csv" | "ai";
                                text: string;
                            }[];
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/clients/validate-project-name": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query: {
                    /** @description Optional client id to exclude (used when renaming) */
                    excludeId?: string;
                    /** @description Organization id (legacy: org_id). Required — the handler returns 400 without it. */
                    orgId: string;
                    /** @description Project name to validate for uniqueness within the org */
                    projectName: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Project name availability */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            available: boolean;
                            conflictingProjectId: string | null;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/competitors": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    clientId?: components["parameters"]["ClientIdQuery"];
                };
                header?: {
                    "x-client-id"?: components["parameters"]["XClientIdHeader"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description List of competitors */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            aliases?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            clientId: string;
                            id: string;
                            name: string;
                            website?: string | null;
                        }[];
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        aliases?: string | number | boolean | unknown | {
                            [key: string]: unknown;
                        } | unknown[] | unknown;
                        clientId: string;
                        name: string;
                        website?: string | null;
                    };
                };
            };
            responses: {
                /** @description Created competitor */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            aliases?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            clientId: string;
                            id: string;
                            name: string;
                            website?: string | null;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/competitors/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Competitor deleted */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/crawler/crawl-and-format": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        crawlOptions?: {
                            maxPages?: number;
                            /** @enum {string} */
                            method?: "auto" | "cheerio" | "playwright";
                            timeout?: number;
                        };
                        formatOptions?: {
                            includePageTypes?: string[];
                            maxCharsPerPage?: number;
                        };
                        /** Format: uri */
                        url: string;
                    };
                };
            };
            responses: {
                /** @description Crawl + format combined response */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            crawledAt: string;
                            formatted: {
                                formatted: string;
                                stats: {
                                    excludedPages: number;
                                    includedPages: number;
                                    pagesByType: {
                                        [key: string]: number;
                                    };
                                    totalChars: number;
                                    totalPages: number;
                                };
                            };
                            result: {
                                crawlMethod: string;
                                pages: {
                                    content: string;
                                    pageType: string;
                                    title: string;
                                    url: string;
                                }[];
                                totalPages: number;
                            };
                            url: string;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/crawler/execute": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        options?: {
                            maxPages?: number;
                            /** @enum {string} */
                            method?: "auto" | "cheerio" | "playwright";
                            timeout?: number;
                        };
                        /** Format: uri */
                        url: string;
                    };
                };
            };
            responses: {
                /** @description Crawl result (synchronous) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            crawledAt: string;
                            duration: number;
                            result: {
                                crawlMethod: string;
                                pages: {
                                    content: string;
                                    pageType: string;
                                    title: string;
                                    url: string;
                                }[];
                                totalPages: number;
                            };
                            url: string;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/crawler/execute/async": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        options?: {
                            maxPages?: number;
                            /** @enum {string} */
                            method?: "auto" | "cheerio" | "playwright";
                            timeout?: number;
                        };
                        /** Format: uri */
                        url: string;
                    };
                };
            };
            responses: {
                /** @description Crawl job queued; poll the returned pollUrl for status */
                202: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            jobId: string;
                            pollUrl: string;
                            status: ("queued" | "running" | "done" | "error" | "failed") | string;
                            url: string;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Rate limit exceeded */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/crawler/format-for-llm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        crawlResult: {
                            crawlMethod: string;
                            pages: {
                                content: string;
                                pageType: string;
                                title: string;
                                url: string;
                            }[];
                            totalPages: number;
                        };
                        options?: {
                            includePageTypes?: string[];
                            maxCharsPerPage?: number;
                        };
                    };
                };
            };
            responses: {
                /** @description Crawl result formatted for LLM */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            formatted: string;
                            stats: {
                                excludedPages: number;
                                includedPages: number;
                                pagesByType: {
                                    [key: string]: number;
                                };
                                totalChars: number;
                                totalPages: number;
                            };
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/crawler/jobs/{jobId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    jobId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Crawler job status (result/error/progress fields appear conditionally based on status) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            crawledAt?: string;
                            createdAt?: string;
                            error?: string;
                            jobId: string;
                            progress?: number | null;
                            result?: {
                                crawlMethod: string;
                                pages: {
                                    content: string;
                                    pageType: string;
                                    title: string;
                                    url: string;
                                }[];
                                totalPages: number;
                            };
                            status: ("queued" | "running" | "done" | "error" | "failed") | string;
                            url?: string;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/dashboard/competitor-rankings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    clientId?: components["parameters"]["ClientIdQuery"];
                    /** @description Comma-separated list of run ids */
                    runIds?: string;
                };
                header?: {
                    "x-client-id"?: components["parameters"]["XClientIdHeader"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Aggregated competitor scores ranked by overall score */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            competitorId: string | null;
                            id: string;
                            isClient: boolean;
                            name: string;
                            overallScore: number;
                            positionScore: number;
                            rank: number;
                            sentimentScore: number;
                            visibilityScore: number;
                        }[];
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/dashboard/historical-scores": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    clientId?: components["parameters"]["ClientIdQuery"];
                    limit?: number;
                    /** @description Comma-separated list of run ids */
                    runIds?: string;
                };
                header?: {
                    "x-client-id"?: components["parameters"]["XClientIdHeader"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Per-run historical score series */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            avgPositionScore: number;
                            avgSentimentScore: number;
                            avgVisibilityScore: number;
                            createdAt: string;
                            runId: string;
                            runName: string;
                            totalCitations: number;
                        }[];
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/dashboard/recent-runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    clientId?: components["parameters"]["ClientIdQuery"];
                };
                header?: {
                    "x-client-id"?: components["parameters"]["XClientIdHeader"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Five most recent prompt runs */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            createdAt: string;
                            id: string;
                            models: number;
                            name: string;
                            prompts: number;
                            status: string;
                        }[];
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/dashboard/stats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    clientId?: components["parameters"]["ClientIdQuery"];
                };
                header?: {
                    "x-client-id"?: components["parameters"]["XClientIdHeader"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Aggregated dashboard counters and average scores */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            activeModels: number;
                            avgPositionScore: number;
                            avgSentimentScore: number;
                            avgVisibilityScore: number;
                            completedRuns: number;
                            totalCitations: number;
                            totalPrompts: number;
                            totalRuns: number;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/dashboard/top-topics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    clientId?: components["parameters"]["ClientIdQuery"];
                };
                header?: {
                    "x-client-id"?: components["parameters"]["XClientIdHeader"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Top accepted topics by score */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            category: string | null;
                            id: string;
                            keywords: string[];
                            label: string;
                            score: number;
                        }[];
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    clientId?: components["parameters"]["ClientIdQuery"];
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Jobs (optionally filtered by tenancy) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error?: string | null;
                            heartbeatGraceMs?: number | null;
                            id: string;
                            lastHeartbeat?: string | null;
                            payload: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            /** @enum {string} */
                            priority?: "low" | "normal" | "high";
                            progress?: number | null;
                            resumeCount?: number | null;
                            startedByUserId?: string | null;
                            /** @enum {string} */
                            status?: "queued" | "running" | "scoring" | "queued_for_benchmarking" | "benchmarking" | "done" | "completed_with_errors" | "error" | "cancelled" | "paused";
                            type: string;
                            workerId?: string | null;
                        }[];
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The job */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error?: string | null;
                            heartbeatGraceMs?: number | null;
                            id: string;
                            lastHeartbeat?: string | null;
                            payload: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            /** @enum {string} */
                            priority?: "low" | "normal" | "high";
                            progress?: number | null;
                            resumeCount?: number | null;
                            startedByUserId?: string | null;
                            /** @enum {string} */
                            status?: "queued" | "running" | "scoring" | "queued_for_benchmarking" | "benchmarking" | "done" | "completed_with_errors" | "error" | "cancelled" | "paused";
                            type: string;
                            workerId?: string | null;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/onboarding/enrich-competitors": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        brandAliases?: string[];
                        focusAreas?: string[];
                        geography?: string;
                        industry?: string;
                        name: string;
                        urls?: string[];
                    };
                };
            };
            responses: {
                /** @description Competitor suggestions */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            competitors?: {
                                description?: string;
                                name: string;
                                url?: string;
                            }[];
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/onboarding/enrich-profile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        focusAreas?: string[];
                        name: string;
                        urls?: string[];
                    };
                };
            };
            responses: {
                /** @description Profile suggestions */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            brandAliases?: string[];
                            description?: string;
                            focusAreas?: string[];
                            geography?: string;
                            industry?: string;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/onboarding/enrich-urls": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        name: string;
                    };
                };
            };
            responses: {
                /** @description URL suggestions */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            urls?: string[];
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/opportunities/citations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    clientId?: components["parameters"]["ClientIdQuery"];
                    promptRunId?: string;
                };
                header?: {
                    "x-client-id"?: components["parameters"]["XClientIdHeader"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Citation analysis grouped by domain */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": Record<string, never>[];
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/opportunities/citations/domain/{domain}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    clientId?: components["parameters"]["ClientIdQuery"];
                };
                header?: {
                    "x-client-id"?: components["parameters"]["XClientIdHeader"];
                };
                path: {
                    domain: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Citations for a specific domain (untyped raw rows) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": Record<string, never>[];
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/opportunities/content": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    clientId?: components["parameters"]["ClientIdQuery"];
                    promptRunId?: string;
                };
                header?: {
                    "x-client-id"?: components["parameters"]["XClientIdHeader"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Generated content suggestions */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            clientId: string;
                            content: string;
                            id: string;
                            promptRunId?: string | null;
                            sourceDomain?: string | null;
                            sourceUrl?: string | null;
                            targetKeywords?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            title: string;
                        }[];
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/opportunities/content/generate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        clientId: string;
                    };
                };
            };
            responses: {
                /** @description Content generated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            count: number;
                            message: string;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/opportunities/recommendations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    clientId?: components["parameters"]["ClientIdQuery"];
                    /** @description Optional id filter */
                    id?: string;
                    promptRunId?: string;
                };
                header?: {
                    "x-client-id"?: components["parameters"]["XClientIdHeader"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Recommendations for the client (optionally filtered by promptRunId or id) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            recommendations: {
                                actionItems?: string | number | boolean | unknown | {
                                    [key: string]: unknown;
                                } | unknown[] | unknown;
                                category: string;
                                clientId: string;
                                description: string;
                                examples?: string | number | boolean | unknown | {
                                    [key: string]: unknown;
                                } | unknown[] | unknown;
                                id: string;
                                promptRunId?: string | null;
                                severity: string;
                                /** @enum {string} */
                                source?: "crawl" | "prompt_response" | "citation" | "ai_analysis" | "manual";
                                title: string;
                            }[];
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        actionItems?: string | number | boolean | unknown | {
                            [key: string]: unknown;
                        } | unknown[] | unknown;
                        category: string;
                        clientId: string;
                        description: string;
                        examples?: string | number | boolean | unknown | {
                            [key: string]: unknown;
                        } | unknown[] | unknown;
                        promptRunId?: string | null;
                        severity: string;
                        /** @enum {string} */
                        source?: "crawl" | "prompt_response" | "citation" | "ai_analysis" | "manual";
                        title: string;
                    };
                };
            };
            responses: {
                /** @description Created recommendation */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            actionItems?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            category: string;
                            clientId: string;
                            description: string;
                            examples?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            id: string;
                            promptRunId?: string | null;
                            severity: string;
                            /** @enum {string} */
                            source?: "crawl" | "prompt_response" | "citation" | "ai_analysis" | "manual";
                            title: string;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/opportunities/recommendations/generate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        clientId: string;
                    };
                };
            };
            responses: {
                /** @description Recommendations generated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            count: number;
                            message: string;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/opportunities/recommendations/stats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    clientId?: components["parameters"]["ClientIdQuery"];
                    promptRunId?: string;
                };
                header?: {
                    "x-client-id"?: components["parameters"]["XClientIdHeader"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Category stats for recommendations */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": Record<string, never>[];
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/opportunities/recommendations/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    category?: string;
                    clientId?: components["parameters"]["ClientIdQuery"];
                    highLevelCategory?: string;
                    page?: number;
                    pageSize?: number;
                    promptRunId?: string;
                    search?: string;
                    severity?: string;
                    sortBy?: string;
                    sortDir?: string;
                    source?: string;
                };
                header?: {
                    "x-client-id"?: components["parameters"]["XClientIdHeader"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Paginated, filtered recommendations summary */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": Record<string, never>;
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/organizations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The organization */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            name: string;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/prompt-categories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Prompt categories */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            createdAt: string;
                            description: string | null;
                            id: string;
                            name: string;
                            slug: string;
                        }[];
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/prompt-runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    clientId?: components["parameters"]["ClientIdQuery"];
                };
                header?: {
                    "x-client-id"?: components["parameters"]["XClientIdHeader"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Prompt runs (with score aggregates) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            avgPositionScore: number;
                            avgSentimentScore: number;
                            avgVisibilityScore: number;
                            clientId: string;
                            createdBy: string;
                            deliverablesCompletedAt?: string | null;
                            deliverablesErrorSummary?: string | null;
                            deliverablesStatus?: string;
                            errorSummary?: string | null;
                            heartbeatAt?: string | null;
                            id: string;
                            modelCount: number;
                            name: string;
                            searchConfig?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            /** @enum {string} */
                            status?: "queued" | "running" | "scoring" | "queued_for_benchmarking" | "benchmarking" | "done" | "completed_with_errors" | "error" | "cancelled" | "paused";
                            totalPrompts: number;
                        }[];
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        clientId: string;
                        createdBy?: string;
                        iterationOf?: string;
                        modelIds: string[];
                        name?: string;
                        promptIds: string[];
                        /** @default false */
                        webSearchEnabled?: boolean;
                    };
                };
            };
            responses: {
                /** @description Created prompt run (returns the new run plus the per-(prompt,model) items that were enqueued) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                error: string | null;
                                finishedAt: string | null;
                                id: string;
                                modelId: string;
                                promptId: string;
                                promptRunId: string;
                                startedAt: string | null;
                                status: string;
                            }[];
                            run: {
                                clientId: string;
                                createdBy: string;
                                deliverablesCompletedAt?: string | null;
                                deliverablesErrorSummary?: string | null;
                                deliverablesStatus?: string;
                                errorSummary?: string | null;
                                heartbeatAt?: string | null;
                                id: string;
                                name: string;
                                searchConfig?: string | number | boolean | unknown | {
                                    [key: string]: unknown;
                                } | unknown[] | unknown;
                                /** @enum {string} */
                                status?: "queued" | "running" | "scoring" | "queued_for_benchmarking" | "benchmarking" | "done" | "completed_with_errors" | "error" | "cancelled" | "paused";
                                totalPrompts: number;
                            };
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/prompt-runs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The prompt run */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            clientId: string;
                            createdBy: string;
                            deliverablesCompletedAt?: string | null;
                            deliverablesErrorSummary?: string | null;
                            deliverablesStatus?: string;
                            errorSummary?: string | null;
                            heartbeatAt?: string | null;
                            id: string;
                            name: string;
                            searchConfig?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            /** @enum {string} */
                            status?: "queued" | "running" | "scoring" | "queued_for_benchmarking" | "benchmarking" | "done" | "completed_with_errors" | "error" | "cancelled" | "paused";
                            totalPrompts: number;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Prompt run deleted */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        name: string;
                    };
                };
            };
            responses: {
                /** @description Updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            clientId: string;
                            createdBy: string;
                            deliverablesCompletedAt?: string | null;
                            deliverablesErrorSummary?: string | null;
                            deliverablesStatus?: string;
                            errorSummary?: string | null;
                            heartbeatAt?: string | null;
                            id: string;
                            name: string;
                            searchConfig?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            /** @enum {string} */
                            status?: "queued" | "running" | "scoring" | "queued_for_benchmarking" | "benchmarking" | "done" | "completed_with_errors" | "error" | "cancelled" | "paused";
                            totalPrompts: number;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/api/v1/prompt-runs/{id}/errors": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Per-item error details */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            errorCount: number;
                            errors: Record<string, never>[];
                            errorSummary: Record<string, never>[];
                            promptRunId: string;
                            status: string;
                            totalItems: number;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/prompt-runs/{id}/logs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    cursor?: string;
                    limit?: number;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Structured logs (cursor-paginated) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            logs: Record<string, never>[];
                            nextCursor?: string | null;
                            promptRunId: string;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/prompt-runs/{id}/recalculate-position": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Recalculation summary */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            message: string;
                            total: number;
                            updated: number;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/prompt-runs/{id}/results": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Detailed results (run + per-item answer/citations/mentions/rankings + competitor scores) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            competitorScores: Record<string, never>[];
                            results: {
                                answer: Record<string, never> | null;
                                citations: Record<string, never>[];
                                item: Record<string, never>;
                                mentions: Record<string, never>[];
                                model: Record<string, never> | null;
                                prompt: Record<string, never> | null;
                                rankings: Record<string, never>[];
                            }[];
                            run: {
                                clientId: string;
                                createdBy: string;
                                deliverablesCompletedAt?: string | null;
                                deliverablesErrorSummary?: string | null;
                                deliverablesStatus?: string;
                                errorSummary?: string | null;
                                heartbeatAt?: string | null;
                                id: string;
                                name: string;
                                searchConfig?: string | number | boolean | unknown | {
                                    [key: string]: unknown;
                                } | unknown[] | unknown;
                                /** @enum {string} */
                                status?: "queued" | "running" | "scoring" | "queued_for_benchmarking" | "benchmarking" | "done" | "completed_with_errors" | "error" | "cancelled" | "paused";
                                totalPrompts: number;
                            };
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/prompt-runs/{id}/score-explanation/{category}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    promptId?: string;
                };
                header?: never;
                path: {
                    category: "Visibility" | "Sentiment" | "Position";
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Score explanation (factor breakdown + interpretation) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            category: string;
                            color?: string;
                            factors?: Record<string, never>[];
                            interpretation?: string;
                            score: number;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/prompt-runs/{id}/search-evidence/{itemId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    itemId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Authorized bounded native-search item evidence, including failures without an answer */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            answerText?: string | null;
                            evidence: {
                                actualModel: string | null;
                                /** @enum {string} */
                                actualModelEvidence: "provider_reported" | "not_reported";
                                attemptCount: number;
                                citations: {
                                    /** @enum {string} */
                                    association: "span" | "block";
                                    providerLocator: {
                                        blockIndex: number;
                                        end?: number;
                                        start?: number;
                                        /** @enum {string} */
                                        unit: "utf16" | "codepoint" | "unambiguous" | "block";
                                    };
                                    sourceIds: string[];
                                    textEnd: number;
                                    textStart: number;
                                }[];
                                continuationCount: number;
                                error?: {
                                    code: string;
                                    message: string;
                                    retryable: boolean;
                                };
                                generationDurationMs: number;
                                hasGoogleSearchSuggestions?: boolean;
                                /** @enum {string} */
                                invocationStatus: "not_invoked" | "invoked" | "failed" | "unknown";
                                /** @default 0 */
                                omittedConsultedSources: number;
                                /** @enum {string} */
                                provider: "openai" | "anthropic" | "google";
                                providerRequestId?: string;
                                providerResponseId?: string;
                                requestedModel: string;
                                searchCount?: number;
                                /** @enum {boolean} */
                                searchRequested: true;
                                sources: {
                                    id: string;
                                    /** @enum {string} */
                                    kind: "cited" | "consulted";
                                    title?: string;
                                    url: string;
                                }[];
                                toolCallCount?: number;
                                /** @enum {string} */
                                toolType: "web_search" | "web_search_20250305" | "google_search";
                                usage: {
                                    inputTokens?: number;
                                    outputTokens?: number;
                                    totalTokens?: number;
                                    webSearchRequests?: number;
                                };
                                /** @enum {number} */
                                version: 1;
                            } | null;
                            itemId?: string;
                            phase: string;
                            runStatus?: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/prompt-runs/{id}/selections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Current rerun selections and inherited search mode */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            modelIds: string[];
                            promptIds: string[];
                            runId: string;
                            webSearchEnabled: boolean;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/prompt-runs/{id}/stop": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Stop request accepted */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            message: string;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/prompt-runs/{runId}/benchmarks-bulk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    clientId?: components["parameters"]["ClientIdQuery"];
                };
                header?: {
                    "x-client-id"?: components["parameters"]["XClientIdHeader"];
                };
                path: {
                    runId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Bulk benchmarks for all prompts in a run */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            benchmarks: Record<string, never>[];
                            clientId: string;
                            metricDescriptions: {
                                position: string;
                                sentiment: string;
                                visibility: string;
                            };
                            runId: string;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/prompt-runs/{runId}/prompts/{promptId}/benchmarks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    clientId?: components["parameters"]["ClientIdQuery"];
                };
                header?: {
                    "x-client-id"?: components["parameters"]["XClientIdHeader"];
                };
                path: {
                    promptId: string;
                    runId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Prompt-level benchmarks (summary + per-entity rows for the brand and competitors) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            clientId: string;
                            entities: Record<string, never>[];
                            promptId: string;
                            runId: string;
                            summary: Record<string, never>;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/prompt-runs/{runId}/prompts/{promptId}/metric-details": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    clientId?: components["parameters"]["ClientIdQuery"];
                };
                header?: {
                    "x-client-id"?: components["parameters"]["XClientIdHeader"];
                };
                path: {
                    promptId: string;
                    runId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Combined interpretations + benchmarks for a single (run, prompt) pair */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            benchmarks: {
                                entities: Record<string, never>[];
                                summary: Record<string, never>;
                            } | null;
                            clientId: string;
                            interpretations: {
                                position: Record<string, never> | null;
                                sentiment: Record<string, never> | null;
                                visibility: Record<string, never> | null;
                            };
                            promptId: string;
                            runId: string;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/prompt-runs/metadata": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    clientId?: components["parameters"]["ClientIdQuery"];
                };
                header?: {
                    "x-client-id"?: components["parameters"]["XClientIdHeader"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Lightweight prompt run metadata */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            createdAt: string;
                            id: string;
                            modelCount: number;
                            name: string;
                            status: string;
                            totalPrompts: number | null;
                        }[];
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/prompts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    clientId?: components["parameters"]["ClientIdQuery"];
                };
                header?: {
                    "x-client-id"?: components["parameters"]["XClientIdHeader"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Prompts for the client */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            accepted?: boolean;
                            categoryId?: string | null;
                            clientId: string;
                            diagnosticFocus?: string | null;
                            id: string;
                            /** @enum {string|null} */
                            intentTier?: "branded" | "semi_branded" | "unbranded" | null;
                            /** @enum {string} */
                            source: "crawl" | "manual" | "csv" | "ai";
                            text: string;
                        }[];
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        accepted?: boolean;
                        categoryId?: string | null;
                        clientId: string;
                        diagnosticFocus?: string | null;
                        /** @enum {string|null} */
                        intentTier?: "branded" | "semi_branded" | "unbranded" | null;
                        /** @enum {string} */
                        source: "crawl" | "manual" | "csv" | "ai";
                        text: string;
                    };
                };
            };
            responses: {
                /** @description Created prompt */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            accepted?: boolean;
                            categoryId?: string | null;
                            clientId: string;
                            diagnosticFocus?: string | null;
                            id: string;
                            /** @enum {string|null} */
                            intentTier?: "branded" | "semi_branded" | "unbranded" | null;
                            /** @enum {string} */
                            source: "crawl" | "manual" | "csv" | "ai";
                            text: string;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/prompts/{clientId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    clientId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Prompts for the client */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            accepted?: boolean;
                            categoryId?: string | null;
                            clientId: string;
                            diagnosticFocus?: string | null;
                            id: string;
                            /** @enum {string|null} */
                            intentTier?: "branded" | "semi_branded" | "unbranded" | null;
                            /** @enum {string} */
                            source: "crawl" | "manual" | "csv" | "ai";
                            text: string;
                        }[];
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/prompts/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        accepted?: boolean;
                        categoryId?: string | null;
                        clientId?: string;
                        diagnosticFocus?: string | null;
                        /** @enum {string|null} */
                        intentTier?: "branded" | "semi_branded" | "unbranded" | null;
                        /** @enum {string} */
                        source?: "crawl" | "manual" | "csv" | "ai";
                        text?: string;
                    };
                };
            };
            responses: {
                /** @description Updated prompt */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            accepted?: boolean;
                            categoryId?: string | null;
                            clientId: string;
                            diagnosticFocus?: string | null;
                            id: string;
                            /** @enum {string|null} */
                            intentTier?: "branded" | "semi_branded" | "unbranded" | null;
                            /** @enum {string} */
                            source: "crawl" | "manual" | "csv" | "ai";
                            text: string;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Prompt deleted */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/reports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    clientId?: components["parameters"]["ClientIdQuery"];
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Reports for the client */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            appendixContent?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            clientId: string;
                            generatedBy: string;
                            id: string;
                            narrativeGenerated?: boolean;
                            narratives?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            projectId: string;
                            runIds: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            snapshotData: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            /** @enum {string} */
                            status?: "generating" | "ready" | "failed";
                        }[];
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/reports/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    clientId?: components["parameters"]["ClientIdQuery"];
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Report details */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            report: {
                                appendixContent?: string | number | boolean | unknown | {
                                    [key: string]: unknown;
                                } | unknown[] | unknown;
                                clientId: string;
                                generatedBy: string;
                                id: string;
                                narrativeGenerated?: boolean;
                                narratives?: string | number | boolean | unknown | {
                                    [key: string]: unknown;
                                } | unknown[] | unknown;
                                projectId: string;
                                runIds: string | number | boolean | unknown | {
                                    [key: string]: unknown;
                                } | unknown[] | unknown;
                                snapshotData: string | number | boolean | unknown | {
                                    [key: string]: unknown;
                                } | unknown[] | unknown;
                                /** @enum {string} */
                                status?: "generating" | "ready" | "failed";
                            };
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: {
                    clientId?: components["parameters"]["ClientIdQuery"];
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Report deleted */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            message: string;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/reports/{id}/download/appendix": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    clientId?: components["parameters"]["ClientIdQuery"];
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Technical Appendix PDF */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/pdf": string;
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/reports/{id}/download/pdf": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    clientId?: components["parameters"]["ClientIdQuery"];
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Insights PDF */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/pdf": string;
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/reports/{id}/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    clientId?: components["parameters"]["ClientIdQuery"];
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Streamed ZIP export of the report bundle */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/zip": string;
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/reports/{id}/files": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    clientId?: components["parameters"]["ClientIdQuery"];
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Report files */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            files: Record<string, never>[];
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/reports/{id}/job": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    clientId?: components["parameters"]["ClientIdQuery"];
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Report job status */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error?: string | null;
                            jobId?: string;
                            progress?: number | null;
                            status?: ("queued" | "running" | "done" | "error" | "failed") | string;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/reports/{id}/sections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    clientId?: components["parameters"]["ClientIdQuery"];
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Report sections (ordered by sectionOrder) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            sections: Record<string, never>[];
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/reports/generate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        clientId: string;
                        runId: string;
                    };
                };
            };
            responses: {
                /** @description Report generation started; runs asynchronously in the background. Poll GET /api/v1/reports for status. */
                202: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            message: string;
                            note?: string;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Client not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/score-colors": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query: {
                    category: "Visibility" | "Sentiment" | "Position";
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Score color bands */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            bandName: string;
                            category: string;
                            colorHex: string;
                            id: string;
                            scoreMax: string | number;
                            scoreMin: string | number;
                        }[];
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/topics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    clientId?: components["parameters"]["ClientIdQuery"];
                };
                header?: {
                    "x-client-id"?: components["parameters"]["XClientIdHeader"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Topics for the client */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            accepted?: boolean;
                            category?: string | null;
                            clientId: string;
                            id: string;
                            keywords?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            label: string;
                            /** @enum {string} */
                            source: "crawl" | "manual" | "csv" | "ai";
                        }[];
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        accepted?: boolean;
                        category?: string | null;
                        clientId: string;
                        keywords?: string | number | boolean | unknown | {
                            [key: string]: unknown;
                        } | unknown[] | unknown;
                        label: string;
                        /** @enum {string} */
                        source: "crawl" | "manual" | "csv" | "ai";
                    };
                };
            };
            responses: {
                /** @description Created topic */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            accepted?: boolean;
                            category?: string | null;
                            clientId: string;
                            id: string;
                            keywords?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            label: string;
                            /** @enum {string} */
                            source: "crawl" | "manual" | "csv" | "ai";
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/topics/{clientId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    clientId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Topics for the client */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            accepted?: boolean;
                            category?: string | null;
                            clientId: string;
                            id: string;
                            keywords?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            label: string;
                            /** @enum {string} */
                            source: "crawl" | "manual" | "csv" | "ai";
                        }[];
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/topics/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        accepted?: boolean;
                        category?: string | null;
                        clientId?: string;
                        keywords?: string | number | boolean | unknown | {
                            [key: string]: unknown;
                        } | unknown[] | unknown;
                        label?: string;
                        /** @enum {string} */
                        source?: "crawl" | "manual" | "csv" | "ai";
                    };
                };
            };
            responses: {
                /** @description Updated topic */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            accepted?: boolean;
                            category?: string | null;
                            clientId: string;
                            id: string;
                            keywords?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            label: string;
                            /** @enum {string} */
                            source: "crawl" | "manual" | "csv" | "ai";
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Topic deleted */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/xray/actions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query: {
                    effort?: string;
                    owner?: string;
                    siteId: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Filtered actions across all pages of the site */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            actions: {
                                effort?: string;
                                owner?: string;
                                pageTitle: string | null;
                                pageUrl: string;
                                text?: string;
                            }[];
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/xray/analyze/batch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        siteId: string;
                    };
                };
            };
            responses: {
                /** @description Batch analysis queued */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            jobId: string;
                            status: ("queued" | "running" | "done" | "error" | "failed") | string;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/xray/pages/{pageId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    pageId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Page details */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            lastModified?: string | null;
                            pageType?: string | null;
                            rawHtml?: string | null;
                            rawText?: string | null;
                            siteId: string;
                            statusCode?: number | null;
                            title?: string | null;
                            url: string;
                            wordCount?: number | null;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/xray/pages/{pageId}/analysis": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    pageId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description AI-generated analysis (assessment, gaps, recommendations, actions, SEO issues, scores) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            actions?: unknown;
                            assessment?: unknown;
                            gaps?: unknown;
                            recommendations?: unknown;
                            scores?: unknown;
                            seoIssues?: unknown;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/xray/sites": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    clientId?: components["parameters"]["ClientIdQuery"];
                };
                header?: {
                    "x-client-id"?: components["parameters"]["XClientIdHeader"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description X-Ray sites for a client */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            aiTxtContent?: string | null;
                            aiTxtPresent?: boolean;
                            clientId: string;
                            /** @enum {string} */
                            crawlAccessStatus?: "ok" | "blocked" | "rate_limited" | "captcha";
                            crawlEvidence?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            domain: string;
                            /** @enum {string|null} */
                            healthProbeStatus?: "pending" | "completed" | "failed" | null;
                            id: string;
                            lastProbedAt?: string | null;
                            robotsRules?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            robotsTxtPresent?: boolean;
                            /** @enum {string} */
                            siteType: "internal" | "third_party";
                        }[];
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/xray/sites/{siteId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    siteId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Site details */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            aiTxtContent?: string | null;
                            aiTxtPresent?: boolean;
                            clientId: string;
                            /** @enum {string} */
                            crawlAccessStatus?: "ok" | "blocked" | "rate_limited" | "captcha";
                            crawlEvidence?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            domain: string;
                            /** @enum {string|null} */
                            healthProbeStatus?: "pending" | "completed" | "failed" | null;
                            id: string;
                            lastProbedAt?: string | null;
                            robotsRules?: string | number | boolean | unknown | {
                                [key: string]: unknown;
                            } | unknown[] | unknown;
                            robotsTxtPresent?: boolean;
                            /** @enum {string} */
                            siteType: "internal" | "third_party";
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/xray/sites/{siteId}/pages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    siteId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Pages summary */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            lastModified?: string | null;
                            pageType?: string | null;
                            rawHtml?: string | null;
                            rawText?: string | null;
                            siteId: string;
                            statusCode?: number | null;
                            title?: string | null;
                            url: string;
                            wordCount?: number | null;
                        }[];
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/xray/sites/{siteId}/refresh-health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: {
                    clientId?: components["parameters"]["ClientIdQuery"];
                };
                header?: {
                    "x-client-id"?: components["parameters"]["XClientIdHeader"];
                };
                path: {
                    siteId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Health check refreshed */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            message: string;
                            site: {
                                aiTxtContent?: string | null;
                                aiTxtPresent?: boolean;
                                clientId: string;
                                /** @enum {string} */
                                crawlAccessStatus?: "ok" | "blocked" | "rate_limited" | "captcha";
                                crawlEvidence?: string | number | boolean | unknown | {
                                    [key: string]: unknown;
                                } | unknown[] | unknown;
                                domain: string;
                                /** @enum {string|null} */
                                healthProbeStatus?: "pending" | "completed" | "failed" | null;
                                id: string;
                                lastProbedAt?: string | null;
                                robotsRules?: string | number | boolean | unknown | {
                                    [key: string]: unknown;
                                } | unknown[] | unknown;
                                robotsTxtPresent?: boolean;
                                /** @enum {string} */
                                siteType: "internal" | "third_party";
                            };
                            success: boolean;
                        };
                    };
                };
                /** @description Bad request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
                /** @description Server error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ErrorResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Service healthy */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            config: {
                                defaultTimeoutMs: number;
                                heartbeatIntervalMs: number;
                                maxConcurrentJobs: number;
                                maxResumeAttempts: number;
                                staleThresholdMs: number;
                            };
                            dbOk: boolean;
                            queue: {
                                active: number;
                                queued: number;
                                stale: number;
                            };
                            shuttingDown: boolean;
                            /** @enum {string} */
                            status: "ok" | "unhealthy";
                        };
                    };
                };
                /** @description Service unhealthy (database ping failed or graceful shutdown in progress) */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            config: {
                                defaultTimeoutMs: number;
                                heartbeatIntervalMs: number;
                                maxConcurrentJobs: number;
                                maxResumeAttempts: number;
                                staleThresholdMs: number;
                            };
                            dbOk: boolean;
                            queue: {
                                active: number;
                                queued: number;
                                stale: number;
                            };
                            shuttingDown: boolean;
                            /** @enum {string} */
                            status: "ok" | "unhealthy";
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        AiModel: {
            /** @enum {string} */
            category?: "core" | "additional";
            costPer1kInput?: string | null;
            costPer1kOutput?: string | null;
            disabledAt?: string | null;
            disabledByUserId?: string | null;
            disabledReason?: string | null;
            displayName: string;
            enabled?: boolean;
            internalOnly?: boolean;
            maxRpm?: number | null;
            maxTpm?: number | null;
            model: string;
            vendor: string;
        };
        AiModelWithStatus: {
            /** @enum {string} */
            category?: "core" | "additional";
            costPer1kInput?: string | null;
            costPer1kOutput?: string | null;
            disabledAt?: string | null;
            disabledByUserId?: string | null;
            disabledReason?: string | null;
            displayName: string;
            enabled?: boolean;
            id: string;
            internalOnly?: boolean;
            isKeyAvailable: boolean;
            maxRpm?: number | null;
            maxTpm?: number | null;
            model: string;
            vendor: string;
            webSearch: {
                eligible: boolean;
                message: string;
                policyVersion: string;
                reason: string;
            };
        };
        Client: {
            aliases?: string | number | boolean | unknown | {
                [key: string]: unknown;
            } | unknown[] | unknown;
            brandAliases?: string | number | boolean | unknown | {
                [key: string]: unknown;
            } | unknown[] | unknown;
            customGeography?: string | null;
            customIndustry?: string | null;
            disabledModelNotifications?: string | number | boolean | unknown | {
                [key: string]: unknown;
            } | unknown[] | unknown;
            focusAreas?: string | number | boolean | unknown | {
                [key: string]: unknown;
            } | unknown[] | unknown;
            geography?: string | null;
            industry?: string | null;
            isActive?: boolean;
            name: string;
            /** @enum {string|null} */
            onboardingStatus?: "draft" | "inprogress" | "completed" | null;
            orgId: string;
            ownerUserId?: string | null;
            primaryLanguage?: string | null;
            primaryTestLocation?: string | null;
            projectName: string;
            selectedAiModelIds?: string | number | boolean | unknown | {
                [key: string]: unknown;
            } | unknown[] | unknown;
            targetCustomerPersona?: string | null;
            targetMarketCountry?: string | null;
            urls?: string | number | boolean | unknown | {
                [key: string]: unknown;
            } | unknown[] | unknown;
            website?: string | null;
        };
        /** @description Tenancy identifier (alternative to x-client-id header). Legacy snake_case `client_id` is also accepted. */
        ClientIdQuery: string;
        Competitor: {
            aliases?: string | number | boolean | unknown | {
                [key: string]: unknown;
            } | unknown[] | unknown;
            clientId: string;
            name: string;
            website?: string | null;
        };
        CreateClient: {
            aliases?: string | number | boolean | unknown | {
                [key: string]: unknown;
            } | unknown[] | unknown;
            brandAliases?: string | number | boolean | unknown | {
                [key: string]: unknown;
            } | unknown[] | unknown;
            competitors?: {
                aliases?: string | number | boolean | unknown | {
                    [key: string]: unknown;
                } | unknown[] | unknown;
                name: string;
                website?: string | null;
            }[];
            customGeography?: string | null;
            customIndustry?: string | null;
            disabledModelNotifications?: string | number | boolean | unknown | {
                [key: string]: unknown;
            } | unknown[] | unknown;
            focusAreas?: string | number | boolean | unknown | {
                [key: string]: unknown;
            } | unknown[] | unknown;
            geography?: string | null;
            industry?: string | null;
            isActive?: boolean;
            modelIds?: string[];
            name: string;
            /** @enum {string|null} */
            onboardingStatus?: "draft" | "inprogress" | "completed" | null;
            orgId: string;
            ownerUserId?: string | null;
            primaryLanguage?: string | null;
            primaryTestLocation?: string | null;
            projectName: string;
            selectedAiModelIds?: string | number | boolean | unknown | {
                [key: string]: unknown;
            } | unknown[] | unknown;
            targetCustomerPersona?: string | null;
            targetMarketCountry?: string | null;
            urls?: string | number | boolean | unknown | {
                [key: string]: unknown;
            } | unknown[] | unknown;
            website?: string | null;
        };
        ErrorResponse: {
            error?: string;
            errors?: unknown[];
            message?: string;
        };
        GeneratedContent: {
            clientId: string;
            content: string;
            promptRunId?: string | null;
            sourceDomain?: string | null;
            sourceUrl?: string | null;
            targetKeywords?: string | number | boolean | unknown | {
                [key: string]: unknown;
            } | unknown[] | unknown;
            title: string;
        };
        Job: {
            error?: string | null;
            heartbeatGraceMs?: number | null;
            lastHeartbeat?: string | null;
            payload: string | number | boolean | unknown | {
                [key: string]: unknown;
            } | unknown[] | unknown;
            /** @enum {string} */
            priority?: "low" | "normal" | "high";
            progress?: number | null;
            resumeCount?: number | null;
            startedByUserId?: string | null;
            /** @enum {string} */
            status?: "queued" | "running" | "scoring" | "queued_for_benchmarking" | "benchmarking" | "done" | "completed_with_errors" | "error" | "cancelled" | "paused";
            type: string;
            workerId?: string | null;
        };
        Organization: {
            name: string;
        };
        Prompt: {
            accepted?: boolean;
            categoryId?: string | null;
            clientId: string;
            diagnosticFocus?: string | null;
            /** @enum {string|null} */
            intentTier?: "branded" | "semi_branded" | "unbranded" | null;
            /** @enum {string} */
            source: "crawl" | "manual" | "csv" | "ai";
            text: string;
        };
        PromptRun: {
            clientId: string;
            createdBy: string;
            deliverablesCompletedAt?: string | null;
            deliverablesErrorSummary?: string | null;
            deliverablesStatus?: string;
            errorSummary?: string | null;
            heartbeatAt?: string | null;
            id?: string;
            name: string;
            searchConfig?: string | number | boolean | unknown | {
                [key: string]: unknown;
            } | unknown[] | unknown;
            /** @enum {string} */
            status?: "queued" | "running" | "scoring" | "queued_for_benchmarking" | "benchmarking" | "done" | "completed_with_errors" | "error" | "cancelled" | "paused";
            totalPrompts: number;
        };
        QueueConfigWithSessions: {
            activeUserSessions?: number;
            defaultTimeoutMs: number;
            heartbeatIntervalMs: number;
            maxConcurrentJobs: number;
            maxResumeAttempts: number;
            staleThresholdMs: number;
        };
        Recommendation: {
            actionItems?: string | number | boolean | unknown | {
                [key: string]: unknown;
            } | unknown[] | unknown;
            category: string;
            clientId: string;
            description: string;
            examples?: string | number | boolean | unknown | {
                [key: string]: unknown;
            } | unknown[] | unknown;
            promptRunId?: string | null;
            severity: string;
            /** @enum {string} */
            source?: "crawl" | "prompt_response" | "citation" | "ai_analysis" | "manual";
            title: string;
        };
        ReportSnapshot: {
            appendixContent?: string | number | boolean | unknown | {
                [key: string]: unknown;
            } | unknown[] | unknown;
            clientId: string;
            generatedBy: string;
            narrativeGenerated?: boolean;
            narratives?: string | number | boolean | unknown | {
                [key: string]: unknown;
            } | unknown[] | unknown;
            projectId: string;
            runIds: string | number | boolean | unknown | {
                [key: string]: unknown;
            } | unknown[] | unknown;
            snapshotData: string | number | boolean | unknown | {
                [key: string]: unknown;
            } | unknown[] | unknown;
            /** @enum {string} */
            status?: "generating" | "ready" | "failed";
        };
        Topic: {
            accepted?: boolean;
            category?: string | null;
            clientId: string;
            keywords?: string | number | boolean | unknown | {
                [key: string]: unknown;
            } | unknown[] | unknown;
            label: string;
            /** @enum {string} */
            source: "crawl" | "manual" | "csv" | "ai";
        };
        /** @description Tenancy identifier. Preferred over query parameters. May also be supplied via ?clientId= or legacy ?client_id=. */
        XClientIdHeader: string;
    };
    responses: never;
    parameters: {
        ClientIdQuery: components["schemas"]["ClientIdQuery"];
        XClientIdHeader: components["schemas"]["XClientIdHeader"];
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;

