# Project Name Feature - Architecture Diagram

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FRONTEND COMPONENTS                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │ Client Wizard   │  │ Client Config    │  │ Client Catalog│ │
│  │ (Onboarding)    │  │ (Edit)           │  │ (List)        │ │
│  ├─────────────────┤  ├──────────────────┤  ├───────────────┤ │
│  │ Step 1:         │  │ Project Name *   │  │ Display:      │ │
│  │ ┌─────────────┐ │  │ ┌──────────────┐ │  │ • Project     │ │
│  │ │Project Name*│ │  │ │[Input Field] │ │  │   (Primary)   │ │
│  │ │  (New)      │ │  │ └──────────────┘ │  │ • Client      │ │
│  │ └─────────────┘ │  │                  │  │   (Secondary) │ │
│  │ ┌─────────────┐ │  │ Client Name *    │  │               │ │
│  │ │Client Name* │ │  │ ┌──────────────┐ │  │ Search:       │ │
│  │ │  (Existing) │ │  │ │[Input Field] │ │  │ Both fields   │ │
│  │ └─────────────┘ │  │ └──────────────┘ │  │               │ │
│  └─────────────────┘  └──────────────────┘  └───────────────┘ │
│                                                                 │
│  All components have:                                          │
│  • Real-time validation (debounced 500ms)                     │
│  • Error state display                                         │
│  • Loading indicators                                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      VALIDATION LAYER                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ GET /api/v1/clients/validate-project-name              │   │
│  │ Query params: projectName, orgId, excludeId (optional) │   │
│  │ Returns: { available: boolean, conflictingId?: string }│   │
│  └────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Frontend calls this on every change (debounced)               │
│  Backend queries database for existing project name            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API ENDPOINTS                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  POST /api/v1/clients                                          │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ 1. Parse request body (Zod validation)               │     │
│  │ 2. Check project name uniqueness                     │     │
│  │ 3. If duplicate → 409 Conflict                       │     │
│  │ 4. If unique → Create client                         │     │
│  │ 5. Return created client                             │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                 │
│  PUT /api/v1/clients/:id                                       │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ 1. Parse request body (Zod validation)               │     │
│  │ 2. If projectName changed:                           │     │
│  │    a. Check uniqueness (exclude current client)      │     │
│  │    b. If duplicate → 409 Conflict                    │     │
│  │ 3. Update client                                     │     │
│  │ 4. Return updated client                             │     │
│  └──────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      STORAGE LAYER                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  interface IStorage {                                          │
│    findClientByProjectName(                                    │
│      orgId: string,                                            │
│      projectName: string,                                      │
│      excludeId?: string                                        │
│    ): Promise<Client | null>                                   │
│  }                                                             │
│                                                                 │
│  Implementation uses case-insensitive comparison:              │
│  WHERE org_id = ? AND LOWER(project_name) = LOWER(?)          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DATABASE SCHEMA                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Table: clients                                                │
│  ┌────────────────┬──────────────────┬──────────────────┐     │
│  │ Column         │ Type             │ Constraints      │     │
│  ├────────────────┼──────────────────┼──────────────────┤     │
│  │ id             │ VARCHAR          │ PRIMARY KEY      │     │
│  │ org_id         │ VARCHAR          │ NOT NULL, FK     │     │
│  │ project_name   │ TEXT             │ NOT NULL         │◄──┐ │
│  │ name           │ TEXT             │ NOT NULL         │   │ │
│  │ website        │ TEXT             │                  │   │ │
│  │ urls           │ JSONB            │                  │   │ │
│  │ ...            │ ...              │ ...              │   │ │
│  └────────────────┴──────────────────┴──────────────────┘   │ │
│                                                               │ │
│  UNIQUE INDEX: unique_project_name_per_org ──────────────────┘ │
│  ON (org_id, project_name)                                    │
│                                                                 │
│  INDEX: idx_clients_project_name                               │
│  ON (org_id, project_name) -- for fast lookups                │
└─────────────────────────────────────────────────────────────────┘
```

## Field Usage Matrix

```
┌───────────────────┬──────────────┬─────────────┬─────────────────┐
│ Use Case          │ Project Name │ Client Name │ Notes           │
├───────────────────┼──────────────┼─────────────┼─────────────────┤
│ UI Display        │ PRIMARY ✓    │ Secondary   │ Catalog, header │
│ Organization      │ ONLY ✓       │ Never       │ Project catalog │
│ Uniqueness Check  │ REQUIRED ✓   │ Not checked │ Per org         │
│ Scoring Algorithm │ NEVER        │ ONLY ✓      │ All analysis    │
│ Brand Matching    │ NEVER        │ ONLY ✓      │ Mentions, etc.  │
│ Search/Filter     │ YES ✓        │ YES ✓       │ Both searchable │
│ AI Enrichment     │ NEVER        │ ONLY ✓      │ Uses brand name │
│ Competitor Comp.  │ NEVER        │ ONLY ✓      │ Brand level     │
└───────────────────┴──────────────┴─────────────┴─────────────────┘
```

## Example Scenarios

### Scenario 1: Multiple Projects, Same Client
```
Project Name: "Q1 2025 Tesla Campaign"
Client Name: "Tesla"
  ├─ Topics: Electric Vehicles, Sustainability
  ├─ Prompts: "Who makes the best EVs?"
  └─ Analysis: Uses "Tesla" for brand matching

Project Name: "Q4 2024 Tesla Analysis"  
Client Name: "Tesla"  ← Same client, different project ✓
  ├─ Topics: Autonomous Driving, Safety
  ├─ Prompts: "Which cars have best autopilot?"
  └─ Analysis: Uses "Tesla" for brand matching

✓ ALLOWED: Same client name under different projects
✗ BLOCKED: Using "Q1 2025 Tesla Campaign" again (duplicate project)
```

### Scenario 2: Duplicate Project Name Prevention
```
User tries to create:
  Project Name: "Brand Refresh 2024"
  Client Name: "Nike"

System checks:
  1. Query: SELECT * FROM clients 
             WHERE org_id = 'org-123' 
             AND LOWER(project_name) = 'brand refresh 2024'
  
  2. Result: Found existing project
  
  3. Response: 409 Conflict
     {
       "message": "Project name already exists",
       "field": "projectName",
       "conflictingProjectId": "uuid-xxx"
     }

✗ BLOCKED: Duplicate project name
```

### Scenario 3: Safe Project Name Edit
```
Current:
  Project Name: "Q1 2025 Campaign"
  Client Name: "Adidas"

User edits to:
  Project Name: "Q1 2025 Adidas Campaign"  ← Changed
  Client Name: "Adidas"  ← Same

System checks:
  1. Query: SELECT * FROM clients 
             WHERE org_id = 'org-123' 
             AND LOWER(project_name) = 'q1 2025 adidas campaign'
             AND id != 'current-client-id'  ← Exclude self
  
  2. Result: Not found
  
  3. Update succeeds

✓ ALLOWED: Unique new project name
```

## Migration Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    MIGRATION PROCESS                            │
└─────────────────────────────────────────────────────────────────┘

STEP 1: Add Column (Nullable)
┌─────────────────────────────────────────┐
│ ALTER TABLE clients                     │
│ ADD COLUMN project_name TEXT;           │
└─────────────────────────────────────────┘
         │
         ▼
STEP 2: Backfill Data
┌─────────────────────────────────────────┐
│ UPDATE clients                          │
│ SET project_name =                      │
│   CONCAT(name, ' - Main Project')      │
│ WHERE project_name IS NULL;            │
└─────────────────────────────────────────┘
         │
         ▼
STEP 3: Add NOT NULL Constraint
┌─────────────────────────────────────────┐
│ ALTER TABLE clients                     │
│ ALTER COLUMN project_name               │
│ SET NOT NULL;                           │
└─────────────────────────────────────────┘
         │
         ▼
STEP 4: Add Unique Constraint
┌─────────────────────────────────────────┐
│ ALTER TABLE clients                     │
│ ADD CONSTRAINT                          │
│   unique_project_name_per_org           │
│ UNIQUE (org_id, project_name);         │
└─────────────────────────────────────────┘
         │
         ▼
STEP 5: Add Index for Performance
┌─────────────────────────────────────────┐
│ CREATE INDEX                            │
│   idx_clients_project_name              │
│ ON clients(org_id, project_name);      │
└─────────────────────────────────────────┘

Result:
┌─────────────────────────────────────────┐
│ All existing clients now have:          │
│ • project_name = "{name} - Main Project"│
│ • Unique constraint enforced            │
│ • Fast lookups via index                │
│ • No data loss                          │
└─────────────────────────────────────────┘
```

## Validation Sequence Diagram

```
Frontend          API Endpoint          Storage Layer       Database
   │                   │                      │                 │
   │  Type "Q1 2025"   │                      │                 │
   │  ─────────────────►                      │                 │
   │  (debounced 500ms)                       │                 │
   │                   │                      │                 │
   │  GET /validate    │                      │                 │
   │  ─────────────────►                      │                 │
   │                   │                      │                 │
   │                   │  findByProjectName() │                 │
   │                   │  ───────────────────►│                 │
   │                   │                      │                 │
   │                   │                      │  SELECT WHERE   │
   │                   │                      │  ───────────────►│
   │                   │                      │                 │
   │                   │                      │  Returns: NULL  │
   │                   │                      │  ◄───────────────│
   │                   │                      │                 │
   │                   │  Returns: null       │                 │
   │                   │  ◄───────────────────│                 │
   │                   │                      │                 │
   │  { available: true}                      │                 │
   │  ◄─────────────────│                      │                 │
   │                   │                      │                 │
   │  ✓ Show success   │                      │                 │
   │                   │                      │                 │
   │                   │                      │                 │
   │  Click "Save"     │                      │                 │
   │  ─────────────────►                      │                 │
   │                   │                      │                 │
   │  POST /clients    │                      │                 │
   │  ─────────────────►                      │                 │
   │                   │                      │                 │
   │                   │  Validate schema     │                 │
   │                   │  ────►               │                 │
   │                   │                      │                 │
   │                   │  findByProjectName() │                 │
   │                   │  ───────────────────►│                 │
   │                   │                      │                 │
   │                   │                      │  SELECT WHERE   │
   │                   │                      │  ───────────────►│
   │                   │                      │                 │
   │                   │                      │  Returns: NULL  │
   │                   │                      │  ◄───────────────│
   │                   │                      │                 │
   │                   │  createClient()      │                 │
   │                   │  ───────────────────►│                 │
   │                   │                      │                 │
   │                   │                      │  INSERT INTO    │
   │                   │                      │  ───────────────►│
   │                   │                      │                 │
   │                   │                      │  Returns: Client│
   │                   │                      │  ◄───────────────│
   │                   │                      │                 │
   │  201 Created      │                      │                 │
   │  ◄─────────────────│                      │                 │
   │                   │                      │                 │
```

## Error Handling Flow

```
┌─────────────────────────────────────────────────────────────┐
│                  ERROR SCENARIOS                            │
└─────────────────────────────────────────────────────────────┘

Scenario 1: Duplicate Project Name on Create
┌──────────────────────────────────┐
│ User submits duplicate name      │
└──────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│ API checks uniqueness            │
│ → Found existing project         │
└──────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│ Return 409 Conflict              │
│ {                                │
│   message: "Project name exists",│
│   field: "projectName",          │
│   conflictingId: "uuid"          │
│ }                                │
└──────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│ Frontend shows error             │
│ "This project name is already    │
│  in use. Please choose another." │
└──────────────────────────────────┘

Scenario 2: Validation Endpoint Failure
┌──────────────────────────────────┐
│ Network error during validation  │
└──────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│ Frontend catch block             │
│ → Log error silently             │
│ → Don't block user               │
│ → Let server-side validation     │
│   be final check                 │
└──────────────────────────────────┘

Scenario 3: Database Constraint Violation (Race Condition)
┌──────────────────────────────────┐
│ Two users submit same name       │
│ simultaneously                   │
└──────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│ Both pass API validation         │
│ (race condition)                 │
└──────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│ Second INSERT fails at DB level  │
│ → UNIQUE constraint violation    │
└──────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│ API catches DB error             │
│ → Returns 409 Conflict           │
└──────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│ Frontend shows error             │
│ User retries with different name │
└──────────────────────────────────┘
```

## Key Design Principles

### 1. Defense in Depth
- **Layer 1**: Frontend validation (UX feedback)
- **Layer 2**: API validation (business logic)
- **Layer 3**: Database constraint (data integrity)

### 2. Zero Impact on Existing Logic
- Project name is NEVER used in:
  - Scoring algorithms
  - Brand matching
  - Competitor analysis
  - Citation detection
  - Mention extraction
  - Ranking detection
  
- Client name remains authoritative for all analysis

### 3. Performance Optimization
- Debounced validation (500ms)
- Database index for fast lookups
- Case-insensitive comparison using LOWER()
- Exclude self when validating updates

### 4. User Experience
- Real-time feedback
- Clear error messages
- Visual hierarchy (project > client)
- Searchable by both names

### 5. Data Integrity
- NOT NULL constraint
- UNIQUE constraint (org_id, project_name)
- Safe migration with backfill
- No data loss
