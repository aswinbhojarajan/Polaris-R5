# Project Name Feature - Phase-by-Phase Implementation

## Overview
This feature will be implemented in **4 sequential phases** to ensure safety and zero impact on existing functionality. Each phase is tested before moving to the next.

---

## Phase 1: Database Migration
**Duration**: 2-3 hours  
**Risk**: Low (additive changes only)  
**Can Rollback**: Yes

### Changes in Phase 1

#### 1.1 Update Database Schema
**File**: `shared/schema.ts`

**BEFORE**:
```typescript
export const clients = pgTable("clients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").references(() => organizations.id).notNull(),
  name: text("name").notNull(),  // CLIENT NAME
  website: text("website"),
  urls: jsonb("urls"),
  // ... rest of fields
});
```

**AFTER**:
```typescript
export const clients = pgTable("clients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").references(() => organizations.id).notNull(),
  
  // NEW FIELD - Add project name
  projectName: text("project_name").notNull(),
  
  name: text("name").notNull(),  // CLIENT NAME (unchanged)
  website: text("website"),
  urls: jsonb("urls"),
  // ... rest of fields
}, (table) => ({
  // NEW CONSTRAINT - Ensure project names are unique per org
  uniqueProjectName: unique().on(table.orgId, table.projectName),
}));
```

#### 1.2 Run Database Migration

**Step 1**: Add column as nullable first
```bash
npm run db:push --force
```

This generates SQL similar to:
```sql
ALTER TABLE clients ADD COLUMN project_name TEXT;
```

**Step 2**: Backfill existing data
```typescript
// Create migration script: scripts/backfill-project-names.ts
import { db } from '../server/db';
import * as schema from '../shared/schema';

async function backfillProjectNames() {
  const clients = await db.select().from(schema.clients);
  
  for (const client of clients) {
    await db
      .update(schema.clients)
      .set({ 
        projectName: `${client.name} - Main Project` 
      })
      .where(eq(schema.clients.id, client.id));
  }
  
  console.log(`Backfilled ${clients.length} project names`);
}

backfillProjectNames();
```

Run:
```bash
npx tsx scripts/backfill-project-names.ts
```

**Step 3**: Make column NOT NULL and add constraint
Update schema to include `.notNull()` and unique constraint, then:
```bash
npm run db:push --force
```

This generates SQL similar to:
```sql
ALTER TABLE clients ALTER COLUMN project_name SET NOT NULL;
ALTER TABLE clients ADD CONSTRAINT unique_project_name_per_org UNIQUE (org_id, project_name);
CREATE INDEX idx_clients_project_name ON clients(org_id, project_name);
```

#### 1.3 Verify Migration
```typescript
// scripts/verify-migration.ts
const clients = await db.select().from(schema.clients);
console.log(`Total clients: ${clients.length}`);
console.log(`Clients with project names: ${clients.filter(c => c.projectName).length}`);
console.log('Sample:', clients[0]);
```

### Testing Phase 1
- ✅ All existing clients have `project_name` populated
- ✅ No NULL values in `project_name` column
- ✅ Unique constraint works (try inserting duplicate)
- ✅ Application still starts without errors
- ✅ Existing API endpoints still work

### Deliverables Phase 1
- ✅ Database schema updated
- ✅ All existing records have project names
- ✅ Unique constraint enforced
- ✅ No existing functionality broken

---

## Phase 2: Backend API Implementation
**Duration**: 4-6 hours  
**Risk**: Low (new endpoint + validation)  
**Depends on**: Phase 1 complete

### Changes in Phase 2

#### 2.1 Update Zod Schemas
**File**: `shared/schema.ts`

**ADD** after table definitions:
```typescript
// Update insert schema to include project name validation
export const insertClientSchema = createInsertSchema(clients).omit({
  id: true,
  createdAt: true,
}).extend({
  projectName: z.string()
    .min(1, "Project name is required")
    .max(100, "Project name must be less than 100 characters")
    .trim()
    .transform(val => val.replace(/\s+/g, ' '))  // Normalize whitespace
    .refine(
      val => /^[a-zA-Z0-9\s\-_.,'&()]+$/.test(val),
      "Project name can only contain letters, numbers, spaces, and basic punctuation"
    ),
  name: z.string()
    .min(1, "Client name is required")
    .max(100, "Client name must be less than 100 characters")
    .trim(),
});

export const updateClientSchema = insertClientSchema.partial();
```

#### 2.2 Add Storage Method
**File**: `server/storage.ts`

**ADD** to `IStorage` interface:
```typescript
interface IStorage {
  // ... existing methods
  
  // NEW METHOD for project name validation
  findClientByProjectName(
    orgId: string,
    projectName: string,
    excludeId?: string
  ): Promise<Client | null>;
}
```

**ADD** to `DbStorage` class:
```typescript
async findClientByProjectName(
  orgId: string,
  projectName: string,
  excludeId?: string
): Promise<Client | null> {
  const conditions = [
    eq(schema.clients.orgId, orgId),
    sql`LOWER(${schema.clients.projectName}) = LOWER(${projectName})`
  ];
  
  if (excludeId) {
    conditions.push(ne(schema.clients.id, excludeId));
  }
  
  const results = await this.db
    .select()
    .from(schema.clients)
    .where(and(...conditions))
    .limit(1);
    
  return results[0] || null;
}
```

#### 2.3 Add Validation Endpoint
**File**: `server/routes.ts`

**ADD** new endpoint (before existing client endpoints):
```typescript
// NEW ENDPOINT: Validate project name uniqueness
app.get('/api/v1/clients/validate-project-name', async (req, res) => {
  try {
    const { projectName, orgId, excludeId } = req.query;
    
    if (!projectName || !orgId) {
      return res.status(400).json({ 
        message: "projectName and orgId are required" 
      });
    }
    
    const existing = await storage.findClientByProjectName(
      orgId as string,
      projectName as string,
      excludeId as string | undefined
    );
    
    res.json({
      available: !existing,
      conflictingProjectId: existing?.id || null
    });
  } catch (error) {
    console.error('Project name validation error:', error);
    res.status(500).json({ message: "Validation failed" });
  }
});
```

#### 2.4 Update Create Client Endpoint
**File**: `server/routes.ts`

**MODIFY** existing `POST /api/v1/clients`:
```typescript
app.post('/api/v1/clients', async (req, res) => {
  try {
    const data = createClientSchema.parse(req.body);
    const { competitors, modelIds, ...clientData } = data;
    
    // NEW: Validate project name uniqueness before creation
    const existing = await storage.findClientByProjectName(
      clientData.orgId,
      clientData.projectName
    );
    
    if (existing) {
      return res.status(409).json({ 
        message: "A project with this name already exists. Please choose another name.",
        field: "projectName",
        conflictingProjectId: existing.id
      });
    }
    
    // Existing creation logic (unchanged)
    const client = await storage.createClient(clientData);
    
    if (competitors && competitors.length > 0) {
      await Promise.all(
        competitors.map(comp => 
          storage.createCompetitor({
            clientId: client.id,
            name: comp.name,
            website: comp.website || null,
            aliases: comp.aliases || []
          })
        )
      );
    }
    
    if (modelIds && modelIds.length > 0) {
      await storage.updateClientModels(client.id, modelIds);
    }
    
    res.status(201).json(client);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        message: "Invalid client data", 
        errors: error.errors 
      });
    }
    console.error('Failed to create client:', error);
    res.status(500).json({ message: "Failed to create client" });
  }
});
```

#### 2.5 Update Update Client Endpoint
**File**: `server/routes.ts`

**MODIFY** existing `PUT /api/v1/clients/:id`:
```typescript
app.put('/api/v1/clients/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = updateClientSchema.parse(req.body);
    
    // NEW: If project name is being changed, validate uniqueness
    if (data.projectName) {
      const orgId = data.orgId || req.body.orgId || 'default-org';
      const existing = await storage.findClientByProjectName(
        orgId,
        data.projectName,
        id  // Exclude current client from check
      );
      
      if (existing) {
        return res.status(409).json({ 
          message: "A project with this name already exists. Please choose another name.",
          field: "projectName",
          conflictingProjectId: existing.id
        });
      }
    }
    
    // Existing update logic (unchanged)
    const updated = await storage.updateClient(id, data);
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        message: "Invalid client data", 
        errors: error.errors 
      });
    }
    console.error('Failed to update client:', error);
    res.status(500).json({ message: "Failed to update client" });
  }
});
```

### Testing Phase 2
**Test with curl/Postman**:

```bash
# Test 1: Validate available name
curl "http://localhost:5000/api/v1/clients/validate-project-name?projectName=New%20Project&orgId=default-org"
# Expected: { "available": true, "conflictingProjectId": null }

# Test 2: Validate duplicate name
curl "http://localhost:5000/api/v1/clients/validate-project-name?projectName=Tesla%20-%20Main%20Project&orgId=default-org"
# Expected: { "available": false, "conflictingProjectId": "uuid-xxx" }

# Test 3: Create client with duplicate project name (should fail)
curl -X POST http://localhost:5000/api/v1/clients \
  -H "Content-Type: application/json" \
  -d '{"projectName":"Tesla - Main Project","name":"Nike","orgId":"default-org"}'
# Expected: 409 Conflict

# Test 4: Create client with unique project name (should succeed)
curl -X POST http://localhost:5000/api/v1/clients \
  -H "Content-Type: application/json" \
  -d '{"projectName":"Nike Q1 2025","name":"Nike","orgId":"default-org"}'
# Expected: 201 Created
```

### Deliverables Phase 2
- ✅ Validation endpoint working
- ✅ Create endpoint prevents duplicates
- ✅ Update endpoint prevents duplicates
- ✅ Proper error responses (409 Conflict)
- ✅ All existing API tests pass

---

## Phase 3: Frontend UI Implementation
**Duration**: 8-10 hours  
**Risk**: Medium (UI changes visible to users)  
**Depends on**: Phase 2 complete

### Changes in Phase 3

#### 3.1 Client Onboarding Wizard (Step 1)
**File**: `client/src/components/create-client-wizard.tsx`

**ADD** state variables at component top:
```typescript
// NEW STATE for project name
const [projectName, setProjectName] = useState("");
const [projectNameError, setProjectNameError] = useState("");
const [isValidatingProjectName, setIsValidatingProjectName] = useState(false);
```

**ADD** validation function:
```typescript
// NEW FUNCTION: Debounced project name validation
const validateProjectName = useDebouncedCallback(async (value: string) => {
  if (!value.trim()) {
    setProjectNameError("");
    return;
  }
  
  setIsValidatingProjectName(true);
  try {
    const response = await fetch(
      `/api/v1/clients/validate-project-name?` +
      `projectName=${encodeURIComponent(value)}&` +
      `orgId=default-org`
    );
    
    if (!response.ok) {
      throw new Error('Validation failed');
    }
    
    const result = await response.json();
    
    if (!result.available) {
      setProjectNameError("This project name is already in use. Please choose another.");
    } else {
      setProjectNameError("");
    }
  } catch (error) {
    console.error("Failed to validate project name:", error);
    // Don't show error to user - server-side validation will catch it
  } finally {
    setIsValidatingProjectName(false);
  }
}, 500);  // 500ms debounce - validates after user stops typing
```

**MODIFY** Step 1 UI:
```tsx
{currentStep === 1 && (
  <div className="space-y-4">
    {/* NEW: Project Name Field */}
    <div>
      <label className="block text-sm font-medium text-foreground mb-2">
        Project Name <span className="text-destructive">*</span>
      </label>
      <p className="text-sm text-muted-foreground mb-2">
        A unique identifier for this project in your catalog
      </p>
      <Input
        value={projectName}
        onChange={(e) => {
          setProjectName(e.target.value);
          validateProjectName(e.target.value);
        }}
        onBlur={() => {
          // Validate immediately when user leaves field
          if (projectName.trim()) {
            validateProjectName.flush();
          }
        }}
        placeholder="e.g., Q1 2025 Brand Campaign"
        className={projectNameError ? "border-destructive" : ""}
        data-testid="input-project-name"
      />
      {isValidatingProjectName && (
        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
          <span className="animate-spin">⏳</span> Checking availability...
        </p>
      )}
      {projectNameError && (
        <p className="text-xs text-destructive mt-1">
          ⚠️ {projectNameError}
        </p>
      )}
      {!projectNameError && projectName.trim() && !isValidatingProjectName && (
        <p className="text-xs text-green-600 mt-1">
          ✓ Project name is available
        </p>
      )}
    </div>
    
    {/* EXISTING: Client Name Field (unchanged) */}
    <div>
      <label className="block text-sm font-medium text-foreground mb-2">
        Client Name <span className="text-destructive">*</span>
      </label>
      <p className="text-sm text-muted-foreground mb-2">
        The brand or company name used in analysis
      </p>
      <Input
        value={clientName}
        onChange={(e) => setClientName(e.target.value)}
        placeholder="e.g., Tesla, Microsoft, Airbnb"
        data-testid="input-client-name"
      />
    </div>
    
    {/* Rest of Step 1 UI... */}
  </div>
)}
```

**MODIFY** Step 1 submit handler:
```typescript
const handleStep1Submit = async () => {
  // NEW: Validate project name
  if (!projectName.trim()) {
    toast({ 
      title: "Project name is required", 
      variant: "destructive" 
    });
    return;
  }
  
  if (projectNameError) {
    toast({ 
      title: "Please fix the project name error", 
      variant: "destructive" 
    });
    return;
  }
  
  if (isValidatingProjectName) {
    toast({ 
      title: "Please wait for validation to complete", 
      variant: "default" 
    });
    return;
  }
  
  // EXISTING: Validate client name
  if (!clientName.trim()) {
    toast({ 
      title: "Client name is required", 
      variant: "destructive" 
    });
    return;
  }
  
  // Create client with BOTH fields
  try {
    const response = await apiRequest('POST', '/api/v1/clients', {
      projectName: projectName.trim(),  // NEW
      name: clientName.trim(),
      orgId: 'default-org',
      onboardingStatus: 'draft'
    });
    
    const client = await response.json();
    setClientId(client.id);
    
    // Trigger AI enrichment...
    await enrichUrlsAndFocusAreas();
    setCurrentStep(2);
  } catch (error) {
    if (error.message.includes('409')) {
      toast({
        title: "Duplicate project name",
        description: "This project name is already in use. Please choose another.",
        variant: "destructive"
      });
    } else {
      toast({
        title: "Failed to create client",
        description: error.message,
        variant: "destructive"
      });
    }
  }
};
```

#### 3.2 Client Configuration Page
**File**: `client/src/pages/client-configuration.tsx`

**ADD** to form schema:
```typescript
const configSchema = z.object({
  projectName: z.string()
    .min(1, "Project name is required")
    .max(100, "Project name too long"),
  name: z.string()
    .min(1, "Client name is required"),
  industry: z.string().optional(),
});
```

**ADD** state for validation:
```typescript
const [projectNameError, setProjectNameError] = useState("");
const [isValidatingProjectName, setIsValidatingProjectName] = useState(false);
```

**ADD** validation function:
```typescript
const validateProjectNameDebounced = useDebouncedCallback(async (value: string) => {
  if (!value.trim() || !selectedClientId) {
    setProjectNameError("");
    return;
  }
  
  setIsValidatingProjectName(true);
  try {
    const response = await fetch(
      `/api/v1/clients/validate-project-name?` +
      `projectName=${encodeURIComponent(value)}&` +
      `orgId=default-org&` +
      `excludeId=${selectedClientId}`  // Exclude current client
    );
    const result = await response.json();
    
    if (!result.available) {
      setProjectNameError("This project name is already in use");
    } else {
      setProjectNameError("");
    }
  } catch (error) {
    console.error("Validation failed:", error);
  } finally {
    setIsValidatingProjectName(false);
  }
}, 500);
```

**ADD** Project Name Card (insert BEFORE Basic Information card):
```tsx
<Form {...form}>
  <form onSubmit={form.handleSubmit(onSubmit)}>
    {/* NEW: Project Name Section */}
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Project Identification</CardTitle>
        <p className="text-sm text-muted-foreground">
          Organizational identifier for this project
        </p>
      </CardHeader>
      <CardContent>
        <FormField
          control={form.control}
          name="projectName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Project Name *</FormLabel>
              <FormDescription>
                Must be unique across your organization. Not used in analysis or scoring.
              </FormDescription>
              <FormControl>
                <Input 
                  {...field} 
                  placeholder="Q1 2025 Brand Campaign"
                  data-testid="input-project-name"
                  onChange={(e) => {
                    field.onChange(e);
                    validateProjectNameDebounced(e.target.value);
                  }}
                  onBlur={() => {
                    field.onBlur();
                    validateProjectNameDebounced.flush();
                  }}
                  className={projectNameError ? "border-destructive" : ""}
                />
              </FormControl>
              {isValidatingProjectName && (
                <p className="text-xs text-muted-foreground">
                  Checking availability...
                </p>
              )}
              {projectNameError && (
                <p className="text-xs text-destructive">
                  ⚠️ {projectNameError}
                </p>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
      </CardContent>
    </Card>
    
    {/* EXISTING: Basic Information Card */}
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Basic Information</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Client/Company Name *</FormLabel>
              <FormDescription>
                The brand name used in analysis and scoring
              </FormDescription>
              <FormControl>
                <Input {...field} placeholder="Tesla" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {/* ... rest of form fields ... */}
      </CardContent>
    </Card>
  </form>
</Form>
```

#### 3.3 Client Catalog Page
**File**: `client/src/pages/client-catalog.tsx`

**MODIFY** Client Card display:
```tsx
<Card 
  key={client.id} 
  className="hover:shadow-lg transition-shadow cursor-pointer group min-w-0"
  onClick={() => handleSelectClient(client)}
  data-testid={`client-card-${client.id}`}
>
  <CardContent className="p-4 min-w-0">
    <div className="flex items-start justify-between mb-3">
      <div className="w-9 h-9 bg-primary/10 rounded-lg flex items-center justify-center group-hover:bg-primary/20 transition-colors flex-shrink-0">
        <Building className="h-4 w-4 text-primary" />
      </div>
      <div className="flex items-center gap-1">
        <Badge variant="secondary" className="text-[10px] px-2 py-0.5">
          Active
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:bg-destructive/10"
          onClick={(e) => {
            e.stopPropagation();
            setClientToDelete(client);
          }}
          data-testid={`button-delete-${client.id}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
    
    {/* NEW: Project Name - Primary Display */}
    <h3 className="font-semibold text-foreground text-base mb-1 truncate">
      {client.projectName}
    </h3>
    
    {/* NEW: Client Name - Secondary Display */}
    <p className="text-sm text-muted-foreground mb-3 truncate flex items-center gap-1">
      <Building className="h-3 w-3" />
      <span>Client: {client.name}</span>
    </p>
    
    {/* EXISTING: Industry, Date, etc. */}
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      {client.industry && (
        <span className="truncate">{client.industry}</span>
      )}
      <span>{formatDate(client.createdAt)}</span>
    </div>
  </CardContent>
</Card>
```

**UPDATE** Search logic to include project name:
```typescript
const filteredClients = useMemo(() => {
  return clients
    .filter(client =>
      client.projectName.toLowerCase().includes(searchQuery.toLowerCase()) ||  // NEW
      client.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      client.industry?.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      // Sort by project name alphabetically
      return a.projectName.localeCompare(b.projectName);
    });
}, [clients, searchQuery]);
```

#### 3.4 Client Selector Component
**File**: `client/src/components/client-selector.tsx`

**MODIFY** display to show both names:
```tsx
<div className="flex items-center space-x-2">
  <Building className="h-4 w-4 text-muted-foreground" />
  <div className="flex flex-col">
    <span className="font-medium text-foreground text-sm">
      {selectedClient?.projectName || "No Project Selected"}
    </span>
    {selectedClient?.name && (
      <span className="text-xs text-muted-foreground">
        Client: {selectedClient.name}
      </span>
    )}
  </div>
</div>
```

**UPDATE** `StoredClient` type:
**File**: `client/src/lib/client-storage.ts`

```typescript
export interface StoredClient {
  id: string;
  projectName: string;  // NEW
  name: string;
}
```

**UPDATE** storage functions:
```typescript
export function setSelectedClient(client: { id: string; projectName: string; name: string }): void {
  localStorage.setItem('current-client-id', client.id);
  localStorage.setItem('current-client-name', client.name);
  localStorage.setItem('current-project-name', client.projectName);  // NEW
}

export function getSelectedClient(): StoredClient | null {
  const id = localStorage.getItem('current-client-id');
  const name = localStorage.getItem('current-client-name');
  const projectName = localStorage.getItem('current-project-name');  // NEW
  
  if (!id || !name || !projectName) {
    return null;
  }
  
  return { id, name, projectName };
}
```

### Testing Phase 3

**Manual Testing Checklist**:

1. **Onboarding Wizard**:
   - [ ] Type project name → See "Checking availability..." message
   - [ ] Type duplicate name → See error message
   - [ ] Move focus out → Validation triggers immediately
   - [ ] Type unique name → See "✓ Project name is available"
   - [ ] Try to proceed with duplicate → Blocked with error
   - [ ] Complete wizard with unique name → Success

2. **Client Configuration**:
   - [ ] Load existing client → Project name pre-filled
   - [ ] Edit project name to duplicate → See error
   - [ ] Edit project name to unique → See success
   - [ ] Save with duplicate name → API returns 409, error shown
   - [ ] Save with unique name → Success

3. **Client Catalog**:
   - [ ] See project name in large text
   - [ ] See client name below with "Client:" prefix
   - [ ] Search by project name → Works
   - [ ] Search by client name → Works
   - [ ] Cards sorted by project name → Correct order

4. **Client Selector**:
   - [ ] Shows project name (primary)
   - [ ] Shows client name (secondary)
   - [ ] Both lines visible and readable

### Deliverables Phase 3
- ✅ Wizard asks for project name first
- ✅ Real-time validation with debounce (500ms)
- ✅ Validation on blur (when moving out of field)
- ✅ Clear error/success messages
- ✅ Configuration page has project name section
- ✅ Catalog shows both project and client names
- ✅ Selector displays both names
- ✅ Search works for both fields

---

## Phase 4: Testing & Validation
**Duration**: 4-6 hours  
**Risk**: Low (verification only)  
**Depends on**: Phase 3 complete

### Changes in Phase 4

#### 4.1 End-to-End Test Scenarios

**Test 1: Create Multiple Projects for Same Client**
```
1. Create Project "Q1 2025 Tesla Campaign" with Client "Tesla" → ✓ Success
2. Create Project "Q4 2024 Tesla Analysis" with Client "Tesla" → ✓ Success
3. Verify both exist in catalog
4. Verify they have different project IDs
5. Verify both use "Tesla" for analysis
```

**Test 2: Duplicate Project Name Prevention**
```
1. Try to create Project "Q1 2025 Tesla Campaign" again → ✗ Blocked
2. See error: "This project name is already in use"
3. Change to "Q1 2025 Tesla Campaign v2" → ✓ Success
```

**Test 3: Edit Project Name**
```
1. Open existing project
2. Change project name to duplicate → See error immediately
3. Cannot save while error exists
4. Change to unique name → Save succeeds
```

**Test 4: Search Functionality**
```
1. Search for "Tesla" → Shows all Tesla projects
2. Search for "Q1 2025" → Shows only Q1 projects
3. Search works for both project and client names
```

**Test 5: Existing Functionality Unchanged**
```
1. Run prompt execution → Works identically
2. Check scoring → Uses client name (not project)
3. View citations → Uses client name
4. Check mentions → Uses client name
5. All analysis features work as before
```

#### 4.2 Migration Verification

**Verify all existing clients**:
```typescript
// Check all clients have project names
const clients = await db.select().from(schema.clients);
console.log(`Total clients: ${clients.length}`);
console.log(`With project names: ${clients.filter(c => c.projectName).length}`);
console.log('All have project names:', clients.every(c => c.projectName));
```

#### 4.3 Performance Testing

**Test validation speed**:
```
1. Type project name character by character
2. Verify debounce works (only 1 request after 500ms pause)
3. Check response time < 200ms
4. Verify no UI lag
```

### Deliverables Phase 4
- ✅ All test scenarios pass
- ✅ No regression in existing features
- ✅ Performance is acceptable
- ✅ All clients migrated successfully
- ✅ Documentation updated

---

## Summary: What Gets Implemented When

### Phase 1 (Database) ✅
- New column: `project_name`
- Unique constraint
- Backfill existing data
- **Visible to users**: NO

### Phase 2 (Backend) ✅
- Validation endpoint
- Create/update endpoints modified
- **Visible to users**: NO (API only)

### Phase 3 (Frontend) ✅
- Wizard: Project name field FIRST
- Configuration: Project name card at top
- Catalog: Show project (primary) + client (secondary)
- Selector: Display both names
- **Visible to users**: YES

### Phase 4 (Testing) ✅
- Comprehensive testing
- Verification
- Performance checks
- **Visible to users**: NO

---

## Key Features Confirmed ✅

### 1. Client Catalog Display
✅ **YES** - Project name shown in large text (primary)  
✅ **YES** - Client name shown below (secondary)  
✅ **YES** - Both searchable  

### 2. Real-time Validation
✅ **YES** - Validation happens as you type (500ms debounce)  
✅ **YES** - Validation happens when you move out of field (blur event)  
✅ **YES** - Shows "available" or "not available" immediately  
✅ **YES** - Prevents saving duplicate names  

---

## Rollback Plan (If Needed)

If issues arise in any phase:

### Rollback Phase 3 (Frontend)
```bash
git revert <commit-hash>
# Users see old UI, but database has project names (harmless)
```

### Rollback Phase 2 (Backend)
```bash
git revert <commit-hash>
# API reverts to not checking project names
```

### Rollback Phase 1 (Database) - Nuclear Option
```sql
ALTER TABLE clients DROP COLUMN project_name;
# Only if absolutely necessary
```

---

## Timeline

| Phase | Duration | Start After | End Before |
|-------|----------|-------------|------------|
| Phase 1 | 2-3 hours | Day 1 AM | Day 1 PM |
| Phase 2 | 4-6 hours | Day 1 PM | Day 2 AM |
| Phase 3 | 8-10 hours | Day 2 AM | Day 3 AM |
| Phase 4 | 4-6 hours | Day 3 AM | Day 3 PM |

**Total**: 18-25 hours across 3 days

---

## Ready to Start?

All phases are clearly defined with:
- ✅ Exact code changes
- ✅ File locations
- ✅ Testing criteria
- ✅ Rollback procedures
- ✅ Zero impact guarantee

Each phase can be reviewed and approved independently before proceeding to the next.
