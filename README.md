# Polaris R5

Sanitized latest-code snapshot of Polaris. The native web-search audit is in
`docs/audits/WebSearch/2026-10-20/`; this export does not implement that feature.

## Export scope

This repository starts with a new Git history, exported from source commit
`ef9d89f538fcd716bf503e7192b104e10430b3b1`. The original project, Git history,
existing remotes, running deployment, and database were not replaced or migrated.

Included: application source, migrations, project documentation, dependency
lockfiles, and the assets imported by the application.

Excluded: database backups, private data CSVs, uploaded documents/screenshots,
agent context, environment secrets, generated build output, historical browser
binaries, and previous Git history.

The upload copy removes hardcoded bootstrap passwords, password-bearing logs,
and the old password examples in documentation. It does not reset existing users.

## Bootstrap passwords in Replit

Use **Tools → Secrets** in the Replit project to store:

| Secret | Purpose |
| --- | --- |
| `DEFAULT_ADMIN_PASSWORD` | Required when creating a missing bootstrap admin account. |
| `SAMPLE_USER_PASSWORD` | Optional password for creating missing sample accounts. Without it, new sample accounts are skipped. |
| `SESSION_SECRET` | Required by the application in production. |

To retrieve a saved value, select the eye icon next to its key in **Tools →
Secrets**. Values are encrypted in Replit and are not included in GitHub. Set
them separately if importing this code into another project.

`DEFAULT_ADMIN_EMAIL` optionally selects the bootstrap admin's email; the default
is `admin@polaris.local`. Sample emails are `adminuser@polaris.local`,
`member@polaris.local`, and `viewer@polaris.local`. Do not configure sample
account creation in environments that do not need it.

These are bootstrap values, not password recovery. Changing a secret does not
update an existing account's password. After a password is changed, use the
application's password-reset or administrator recovery flow.

Reference: https://docs.replit.com/core-concepts/project-editor/app-setup/secrets

## Running the application

Configure the existing database and provider settings separately, following
`prd/11-environment-and-deployment.md` and `replit.md`.

```sh
npm ci
npm run dev
```

```sh
npm run build
npm run check
```

The optional browser E2E test requires `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PW` for
an existing test admin; there is no fallback password.

Legacy import scripts need separately supplied private backups and CSVs,
including the original client-ID migration manifest. These are deliberately
excluded from this repository. Preserve the original manifest privately; do not
regenerate its existing ID mappings.

Removing old password values from this export does not revoke them on existing
accounts or erase them from older repositories. Rotate any still-active default
passwords through the application's existing account-management flows.
