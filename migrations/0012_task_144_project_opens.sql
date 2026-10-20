-- Task #144: per-user "last opened" tracking for the Project Catalog sort.
--
-- One row per (client, user), upserted every time the user opens a project
-- from the catalog. Cascades away with either the project or the user.

CREATE TABLE IF NOT EXISTS "project_opens" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_id" varchar NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "last_opened_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "project_opens_client_user_uniq"
  ON "project_opens" ("client_id", "user_id");
