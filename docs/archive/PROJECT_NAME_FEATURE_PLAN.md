# Project Name Feature - Implementation Plan & Strategy

## Executive Summary
Add a **Project Name** field as the primary organizational dimension for clients, enabling multiple projects per client while maintaining client names for all existing calculations and analysis. Project names serve purely as organizational identifiers with mandatory uniqueness validation.

---

## Requirements Analysis

### Core Requirements
1. **Project Name as Primary Dimension**: First field in client onboarding and configuration
2. **No Calculation Impact**: Project name NEVER used in scoring, algorithms, or analysis
3. **Duplicate Prevention**: Project names must be unique across the entire organization
4. **Multiple Projects per Client**: Same client name can exist under different projects
5. **Client Name Preservation**: Client name remains the entity used for all analysis
6. **Editability**: Project names can be modified after creation (with uniqueness check)

### Key Constraint
**ZERO impact on existing functionality** - All current features, calculations, and workflows must continue working exactly as they do now.

---

## Architecture Strategy

### 1. Database Schema Changes

#### 1.1 Add `projectName` Column to `clients` Table

**Location**: `shared/schema.ts`

```typescript
export const clients = pgTable("clients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").references(() => organizations.id).notNull(),
  
  // NEW FIELD - Add as first logical field
  projectName: text("project_name").notNull(),  
  
  name: text("name").notNull(),  // This is CLIENT NAME (unchanged)
  website: text("website"),
  urls: jsonb("urls"),
  focusAreas: jsonb("focus_areas"),
  industry: text("industry"),
  geography: text("geography"),
  aliases: jsonb("aliases"),
  brandAliases: jsonb("brand_aliases"),
  selectedAiModelIds: jsonb("selected_ai_model_ids"),
  onboardingStatus: onboardingStatusEnum("onboarding_status").default('draft'),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

**Migration Strategy**:
- Add column as nullable initially for backward compatibility
- Backfill existing records with default project names (e.g., `${clientName} - Main Project`)
- Then alter column to NOT NULL
- Add database-level unique constraint on `(org_id, project_name)`

**Alternative (Simpler) Migration**:
- Add column as NOT NULL with a default value like `'Main Project'`
- Users can then rename as needed

#### 1.2 Add Unique Constraint

**Purpose**: Enforce project name uniqueness at database level

```typescript
// In schema.ts - add unique constraint
export const clients = pgTable("clients", {
  // ... fields
}, (table) => ({
  uniqueProjectName: unique().on(table.orgId, table.projectName),
}));
```

**Rationale**: Database-level constraint prevents race conditions and ensures data integrity

---

### 2. Backend API Changes

#### 2.1 Update Zod Schemas

**Location**: `shared/schema.ts` (after table definition)

```typescript
// Update insert schema
export const insertClientSchema = createInsertSchema(clients).omit({
  id: true,
  createdAt: true,
}).extend({
  projectName: z.string()
    .min(1, "Project name is required")
    .max(100, "Project name must be less than 100 characters")
    .trim(),
  name: z.string()
    .min(1, "Client name is required")
    .max(100, "Client name must be less than 100 characters")
    .trim(),
  // ... other fields
});
```

#### 2.2 Add Duplicate Validation Endpoint

**Location**: `server/routes.ts`

**New Endpoint**:
```typescript
// GET /api/v1/clients/validate-project-name?projectName=xxx&orgId=xxx&excludeId=xxx
app.get('/api/v1/clients/validate-project-name', async (req, res) => {
  const { projectName, orgId, excludeId } = req.query;
  
  // Query database for existing project with same name
  const existing = await storage.findClientByProjectName(
    orgId as string, 
    projectName as string,
    excludeId as string | undefined
  );
  
  res.json({ 
    available: !existing,
    conflictingProjectId: existing?.id 
  });
});
```

**Purpose**: Real-time validation during user input (debounced)

#### 2.3 Update Create/Update Client Endpoints

**Location**: `server/routes.ts`

**Changes to POST `/api/v1/clients`**:
```typescript
app.post('/api/v1/clients', async (req, res) => {
  try {
    const data = createClientSchema.parse(req.body);
    
    // NEW: Validate project name uniqueness before creation
    const existing = await storage.findClientByProjectName(
      data.orgId,
      data.projectName
    );
    
    if (existing) {
      return res.status(409).json({ 
        message: "Project name already exists",
        field: "projectName",
        conflictingProjectId: existing.id
      });
    }
    
    // Existing creation logic...
    const client = await storage.createClient(data);
    // ...
  } catch (error) {
    // Handle errors
  }
});
```

**Changes to PUT `/api/v1/clients/:id`**:
```typescript
app.put('/api/v1/clients/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = updateClientSchema.parse(req.body);
    
    // NEW: If project name is being changed, validate uniqueness
    if (data.projectName) {
      const existing = await storage.findClientByProjectName(
        data.orgId,
        data.projectName,
        id  // Exclude current client from check
      );
      
      if (existing) {
        return res.status(409).json({ 
          message: "Project name already exists",
          field: "projectName"
        });
      }
    }
    
    // Existing update logic...
    const updated = await storage.updateClient(id, data);
    // ...
  } catch (error) {
    // Handle errors
  }
});
```

#### 2.4 Add Storage Method

**Location**: `server/storage.ts`

```typescript
interface IStorage {
  // ... existing methods
  
  // NEW METHOD
  findClientByProjectName(
    orgId: string, 
    projectName: string, 
    excludeId?: string
  ): Promise<Client | null>;
}
```

**Implementation** (in DbStorage class):
```typescript
async findClientByProjectName(
  orgId: string,
  projectName: string,
  excludeId?: string
): Promise<Client | null> {
  const query = db
    .select()
    .from(schema.clients)
    .where(
      and(
        eq(schema.clients.orgId, orgId),
        eq(schema.clients.projectName, projectName),
        excludeId ? ne(schema.clients.id, excludeId) : undefined
      )
    )
    .limit(1);
    
  const results = await query;
  return results[0] || null;
}
```

---

### 3. Frontend UI Changes

#### 3.1 Client Onboarding Wizard

**Location**: `client/src/components/create-client-wizard.tsx`

**Changes to Step 1**:

**Current Step 1**: Only asks for Client Name

**New Step 1**: Ask for BOTH Project Name and Client Name

```typescript
// State additions
const [projectName, setProjectName] = useState("");
const [projectNameError, setProjectNameError] = useState("");
const [isValidatingProjectName, setIsValidatingProjectName] = useState(false);

// Debounced project name validation
const validateProjectName = useDebouncedCallback(async (value: string) => {
  if (!value.trim()) {
    setProjectNameError("");
    return;
  }
  
  setIsValidatingProjectName(true);
  try {
    const response = await fetch(
      `/api/v1/clients/validate-project-name?projectName=${encodeURIComponent(value)}&orgId=default-org`
    );
    const result = await response.json();
    
    if (!result.available) {
      setProjectNameError("This project name is already in use. Please choose another.");
    } else {
      setProjectNameError("");
    }
  } catch (error) {
    console.error("Failed to validate project name:", error);
  } finally {
    setIsValidatingProjectName(false);
  }
}, 500);  // 500ms debounce
```

**UI Layout**:
```tsx
{/* Step 1: Project & Client Names */}
<div className="space-y-4">
  <div>
    <label className="block text-sm font-medium mb-2">
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
      placeholder="e.g., Q1 2025 Brand Campaign"
      data-testid="input-project-name"
    />
    {isValidatingProjectName && (
      <p className="text-xs text-muted-foreground mt-1">
        Checking availability...
      </p>
    )}
    {projectNameError && (
      <p className="text-xs text-destructive mt-1">
        {projectNameError}
      </p>
    )}
  </div>
  
  <div>
    <label className="block text-sm font-medium mb-2">
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
</div>
```

**Validation on Submit**:
```typescript
const handleStep1Submit = async () => {
  if (!projectName.trim()) {
    toast({ title: "Project name is required", variant: "destructive" });
    return;
  }
  
  if (!clientName.trim()) {
    toast({ title: "Client name is required", variant: "destructive" });
    return;
  }
  
  if (projectNameError) {
    toast({ title: "Please fix project name error", variant: "destructive" });
    return;
  }
  
  // Wait for validation to complete
  if (isValidatingProjectName) {
    toast({ title: "Please wait for validation to complete", variant: "default" });
    return;
  }
  
  // Create client with both fields
  const response = await apiRequest('POST', '/api/v1/clients', {
    projectName: projectName.trim(),
    name: clientName.trim(),
    orgId: 'default-org',
    onboardingStatus: 'draft'
  });
  
  // Handle response...
};
```

#### 3.2 Client Configuration Page

**Location**: `client/src/pages/client-configuration.tsx`

**Add Project Name Field** (at the top of the form):

```tsx
<Form {...form}>
  <form onSubmit={form.handleSubmit(onSubmit)}>
    {/* NEW: Project Name Field - First */}
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Project Identification</CardTitle>
      </CardHeader>
      <CardContent>
        <FormField
          control={form.control}
          name="projectName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Project Name *</FormLabel>
              <FormDescription>
                Unique identifier for this project. Cannot match other projects.
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
                />
              </FormControl>
              {isValidatingProjectName && (
                <p className="text-xs text-muted-foreground">
                  Checking availability...
                </p>
              )}
              {projectNameError && (
                <p className="text-xs text-destructive">
                  {projectNameError}
                </p>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
      </CardContent>
    </Card>
    
    {/* Existing: Basic Information Card */}
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Basic Information</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <FormField
          control={form.control}
          name="name"  {/* This is CLIENT NAME */}
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
        {/* ... rest of form */}
      </CardContent>
    </Card>
  </form>
</Form>
```

**Add Validation State**:
```typescript
const [projectNameError, setProjectNameError] = useState("");
const [isValidatingProjectName, setIsValidatingProjectName] = useState(false);

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
      `excludeId=${selectedClientId}`
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

**Update Schema**:
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

#### 3.3 Client Catalog Page

**Location**: `client/src/pages/client-catalog.tsx`

**Display Changes**:

**Current**: Shows only Client Name in card

**New**: Show BOTH Project Name (primary) and Client Name (secondary)

```tsx
<Card>
  <CardContent className="p-4 min-w-0">
    {/* Project Name - Primary Display */}
    <h3 className="font-semibold text-foreground text-base mb-1 truncate">
      {client.projectName}
    </h3>
    
    {/* Client Name - Secondary Display */}
    <p className="text-sm text-muted-foreground mb-3 truncate">
      Client: {client.name}
    </p>
    
    {/* Industry, Date, etc. */}
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      {client.industry && (
        <span className="truncate">{client.industry}</span>
      )}
      <span>{formatDate(client.createdAt)}</span>
    </div>
  </CardContent>
</Card>
```

**Search Enhancement**:
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

**Location**: `client/src/components/client-selector.tsx`

**Display Change**:

**Current**: Shows only client name

**New**: Show project name (primary) with client name (tooltip or secondary)

```tsx
<div className="flex items-center space-x-2">
  <Building className="h-4 w-4 text-muted-foreground" />
  <div className="flex flex-col">
    <span className="font-medium text-foreground text-sm">
      {selectedClient?.projectName || "No Project Selected"}
    </span>
    {selectedClient?.name && (
      <span className="text-xs text-muted-foreground">
        {selectedClient.name}
      </span>
    )}
  </div>
</div>
```

**Update Type**:
```typescript
// In client-storage.ts or wherever StoredClient is defined
export interface StoredClient {
  id: string;
  projectName: string;  // NEW
  name: string;         // CLIENT NAME
}
```

#### 3.5 Sidebar Component

**Location**: `client/src/components/layout/sidebar.tsx`

Similar display changes as Client Selector - show project name as primary identifier.

---

### 4. Type Definitions

**Location**: `shared/schema.ts`

**Update Types**:
```typescript
export type Client = typeof clients.$inferSelect;
export type InsertClient = z.infer<typeof insertClientSchema>;

// Ensure these include projectName field
```

**Frontend Type Updates**:

All components importing `Client` type will automatically get the new `projectName` field via type inference.

---

### 5. Data Migration Strategy

#### Option A: Safe Migration (Recommended)

**Step 1**: Add column as nullable
```sql
ALTER TABLE clients ADD COLUMN project_name TEXT;
```

**Step 2**: Backfill with default values
```sql
UPDATE clients 
SET project_name = CONCAT(name, ' - Main Project')
WHERE project_name IS NULL;
```

**Step 3**: Make it NOT NULL
```sql
ALTER TABLE clients ALTER COLUMN project_name SET NOT NULL;
```

**Step 4**: Add unique constraint
```sql
ALTER TABLE clients 
ADD CONSTRAINT unique_project_name_per_org 
UNIQUE (org_id, project_name);
```

#### Option B: Simple Migration

Add column with default value directly:
```sql
ALTER TABLE clients 
ADD COLUMN project_name TEXT NOT NULL DEFAULT 'Main Project';
```

Then add unique constraint and remove default.

---

### 6. Testing Strategy

#### 6.1 Unit Tests (Backend)

**Test Coverage**:
1. Project name validation endpoint returns correct availability status
2. Duplicate project names are rejected on create
3. Duplicate project names are rejected on update
4. Same client name can exist under different project names
5. Storage method correctly finds/doesn't find existing project names

#### 6.2 Integration Tests (API)

**Test Scenarios**:
1. Create client with unique project name → Success
2. Create client with duplicate project name → 409 Conflict
3. Update client's project name to duplicate → 409 Conflict
4. Update client's project name to unique → Success
5. Update client without changing project name → Success

#### 6.3 Frontend Tests

**Test Coverage**:
1. Wizard Step 1 validates project name in real-time
2. Error message appears for duplicate project name
3. Cannot proceed with duplicate project name
4. Configuration page prevents saving duplicate project names
5. Catalog displays both project and client names correctly
6. Search works for both project and client names

#### 6.4 End-to-End Tests

**Critical Paths**:
1. Complete onboarding with unique project name → Success
2. Attempt to create second project with same name → Blocked
3. Create second project with different name, same client → Success
4. Edit existing project name to conflict → Blocked
5. Edit existing project name to unique → Success

---

### 7. Rollout Plan

#### Phase 1: Database Migration
1. Run database migration to add `project_name` column
2. Backfill existing records
3. Add unique constraint
4. Verify data integrity

#### Phase 2: Backend Deployment
1. Deploy backend changes (API endpoints, validation)
2. Test API endpoints in isolation
3. Verify existing functionality unaffected

#### Phase 3: Frontend Deployment
1. Deploy frontend changes (wizard, config, catalog)
2. Test new UI flows
3. Verify existing flows still work

#### Phase 4: Monitoring
1. Monitor for duplicate name attempts
2. Track user adoption of project names
3. Gather feedback on UX

---

### 8. Backward Compatibility Guarantees

#### 8.1 Existing Calculations
- ✅ All scoring algorithms continue using `client.name` (not `projectName`)
- ✅ Competitor matching uses client names
- ✅ Brand alias matching uses client names
- ✅ Mention detection uses client names
- ✅ Citation analysis uses client names
- ✅ Ranking detection uses client names

#### 8.2 Existing APIs
- ✅ All existing API responses include `projectName` as additional field
- ✅ No breaking changes to response structure
- ✅ Existing query parameters continue working

#### 8.3 Existing Data
- ✅ All existing clients get auto-generated project names
- ✅ No data loss
- ✅ All relationships preserved

---

### 9. Edge Cases & Considerations

#### 9.1 Case Sensitivity
**Decision**: Project names are case-insensitive for uniqueness

**Implementation**:
```typescript
// Validation query
const existing = await db
  .select()
  .from(schema.clients)
  .where(
    and(
      eq(schema.clients.orgId, orgId),
      sql`LOWER(${schema.clients.projectName}) = LOWER(${projectName})`
    )
  );
```

#### 9.2 Whitespace Handling
**Decision**: Trim and normalize whitespace

**Implementation**:
```typescript
projectName: z.string()
  .trim()
  .transform(val => val.replace(/\s+/g, ' '))  // Collapse multiple spaces
```

#### 9.3 Special Characters
**Decision**: Allow alphanumerics, spaces, hyphens, and basic punctuation

**Implementation**:
```typescript
projectName: z.string()
  .regex(/^[a-zA-Z0-9\s\-_.,'&()]+$/, 
    "Project name can only contain letters, numbers, spaces, and basic punctuation"
  )
```

#### 9.4 Maximum Length
**Decision**: 100 characters max (reasonable for display)

#### 9.5 Deleted Projects
**Decision**: Soft delete maintains uniqueness constraint

**Consideration**: If implementing soft delete later, may need to exclude `is_active = false` from uniqueness check

---

### 10. User Experience Considerations

#### 10.1 Guidance & Help Text
- Clear explanation that project name is organizational only
- Examples of good project names ("Q1 2025 Campaign", "Brand Refresh 2024")
- Inline help text explaining client vs. project name distinction

#### 10.2 Error Messages
- **Duplicate**: "This project name is already in use. Please choose another."
- **Invalid chars**: "Project name can only contain letters, numbers, and basic punctuation."
- **Too long**: "Project name must be less than 100 characters."

#### 10.3 Visual Hierarchy
- Project name should be visually prominent (larger font, bold)
- Client name should be secondary but still visible
- Maintain clear distinction in all UI contexts

---

### 11. Performance Considerations

#### 11.1 Database Indexing
**Add Index**:
```sql
CREATE INDEX idx_clients_project_name ON clients(org_id, project_name);
```

**Purpose**: Fast lookup for duplicate checks

#### 11.2 Validation Debouncing
- 500ms debounce on project name input
- Prevents excessive API calls during typing
- Provides good UX balance

#### 11.3 Query Optimization
- Use database-level uniqueness check (not application-level)
- Leverage index for fast validation
- Cache validation results on frontend for same input

---

### 12. Documentation Updates

#### 12.1 User Documentation
- Update onboarding guide
- Explain project vs. client concept
- Provide naming best practices

#### 12.2 Developer Documentation
- Update API documentation
- Document new validation endpoint
- Update schema documentation

#### 12.3 Migration Guide
- Document database migration steps
- Provide rollback procedure if needed

---

## Success Criteria

### Must Have
- ✅ Project name field appears first in wizard and config
- ✅ Duplicate project names are completely prevented
- ✅ Multiple projects can have same client name
- ✅ Client name continues to be used for all analysis
- ✅ All existing functionality works identically
- ✅ No data loss during migration

### Should Have
- ✅ Real-time duplicate validation with good UX
- ✅ Clear visual distinction between project and client names
- ✅ Searchable by both project and client names
- ✅ Good error messages and help text

### Nice to Have
- Project name editing history/audit trail
- Bulk rename capability
- Project templates

---

## Risk Mitigation

### Risk 1: Migration Breaks Existing Data
**Mitigation**: 
- Test migration on copy of production DB first
- Use safe, incremental migration steps
- Have rollback plan ready

### Risk 2: Users Confuse Project vs. Client Name
**Mitigation**:
- Clear labels and help text
- Visual hierarchy (project name larger/bolder)
- Examples in placeholders

### Risk 3: Validation Race Conditions
**Mitigation**:
- Database-level unique constraint (primary defense)
- API-level validation (secondary defense)
- Proper error handling for conflicts

### Risk 4: Performance Impact on Large Orgs
**Mitigation**:
- Proper database indexing
- Debounced validation
- Cached results where appropriate

---

## Implementation Checklist

### Database
- [ ] Add `project_name` column to clients table
- [ ] Backfill existing records with default values
- [ ] Add unique constraint on (org_id, project_name)
- [ ] Add database index for performance
- [ ] Test migration on production data copy

### Backend
- [ ] Update Drizzle schema definition
- [ ] Update Zod validation schemas
- [ ] Add `findClientByProjectName` storage method
- [ ] Add validation endpoint
- [ ] Update create client endpoint
- [ ] Update update client endpoint
- [ ] Add unit tests for validation logic
- [ ] Add integration tests for API endpoints

### Frontend - Wizard
- [ ] Add project name input field
- [ ] Add real-time validation
- [ ] Add error state handling
- [ ] Update form submission logic
- [ ] Add loading states
- [ ] Add tests

### Frontend - Configuration
- [ ] Add project name card/section
- [ ] Add real-time validation
- [ ] Update form schema
- [ ] Update save logic
- [ ] Add tests

### Frontend - Catalog
- [ ] Update card display (project + client names)
- [ ] Update search logic
- [ ] Update sorting options
- [ ] Add tests

### Frontend - Components
- [ ] Update ClientSelector display
- [ ] Update Sidebar display
- [ ] Update StoredClient type
- [ ] Update localStorage handling

### Testing
- [ ] Run all existing tests (ensure no regression)
- [ ] Add new unit tests
- [ ] Add new integration tests
- [ ] Add E2E tests for critical paths
- [ ] Manual testing of all flows

### Documentation
- [ ] Update API documentation
- [ ] Update user guide
- [ ] Update developer documentation
- [ ] Create migration guide
- [ ] Update README if needed

### Deployment
- [ ] Deploy database migration
- [ ] Deploy backend changes
- [ ] Deploy frontend changes
- [ ] Monitor for errors
- [ ] Gather user feedback

---

## Timeline Estimate

**Total**: 2-3 development days

- Database migration: 2-3 hours
- Backend implementation: 4-6 hours
- Frontend implementation: 8-10 hours
- Testing: 4-6 hours
- Documentation: 2-3 hours
- Deployment & monitoring: 2-3 hours

---

## Conclusion

This plan ensures the Project Name feature is added safely without impacting any existing functionality. The key strategies are:

1. **Additive approach**: Adding new field alongside existing client name
2. **Database-level enforcement**: Unique constraint prevents duplicates
3. **Clear separation**: Project name for organization, client name for analysis
4. **Comprehensive validation**: Multiple layers of duplicate prevention
5. **Backward compatibility**: All existing features continue working
6. **Safe migration**: Incremental steps with rollback capability

The implementation prioritizes data integrity, user experience, and zero disruption to existing workflows.
