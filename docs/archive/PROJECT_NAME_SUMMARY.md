# Project Name Feature - Executive Summary

## What We're Adding
A **Project Name** field that serves as the primary organizational identifier for clients, allowing multiple projects to track the same brand/company.

## Example Use Case
```
Project 1: "Q1 2025 Tesla Campaign"
  └─ Client: Tesla (used in all analysis)

Project 2: "Q4 2024 Tesla Analysis"
  └─ Client: Tesla (same brand, different project) ✓ ALLOWED

Project 3: "Q1 2025 Tesla Campaign"
  └─ ✗ BLOCKED - Duplicate project name
```

## Key Rules

### ✅ What Project Name IS Used For
- **Organization only**: Display in catalog, identify projects
- **Uniqueness enforcement**: No two projects can have same name
- **UI display**: Primary identifier in client list and selector

### ❌ What Project Name is NEVER Used For
- Scoring algorithms
- Brand matching
- Competitor analysis
- Citation detection
- Mention extraction
- Ranking detection
- Any calculations or analysis

**Client Name** remains the authoritative field for ALL analysis.

## Changes Required

### 1. Database (1 new column + 1 constraint)
```sql
ALTER TABLE clients ADD COLUMN project_name TEXT NOT NULL;
ALTER TABLE clients ADD CONSTRAINT unique_project_name_per_org UNIQUE (org_id, project_name);
```

### 2. Backend (1 new endpoint + 2 updated endpoints)
- **NEW**: `GET /api/v1/clients/validate-project-name` - Real-time duplicate check
- **UPDATE**: `POST /api/v1/clients` - Add uniqueness validation
- **UPDATE**: `PUT /api/v1/clients/:id` - Add uniqueness validation

### 3. Frontend (4 component updates)
- **Client Onboarding Wizard**: Add project name as first field in Step 1
- **Client Configuration**: Add project name card at top
- **Client Catalog**: Show project name (primary) + client name (secondary)
- **Client Selector**: Display both project and client names

## Zero Impact Guarantee

### Existing Functionality Preserved
✅ All scoring algorithms work identically  
✅ All API endpoints return same data (+ project name)  
✅ All database relationships unchanged  
✅ All existing features function exactly as before  
✅ No data loss during migration  

### Validation Layers (Defense in Depth)
1. **Frontend**: Real-time validation (500ms debounce) for UX
2. **API**: Server-side validation before DB operations
3. **Database**: UNIQUE constraint prevents duplicates at source

## Migration Strategy

### Safe 5-Step Migration
```
1. Add column (nullable)
2. Backfill: project_name = "{client.name} - Main Project"
3. Make NOT NULL
4. Add UNIQUE constraint
5. Add index for performance
```

**Result**: All existing clients automatically get unique project names based on their client name.

## Timeline
**Estimated**: 2-3 development days
- Database migration: 2-3 hours
- Backend implementation: 4-6 hours
- Frontend implementation: 8-10 hours
- Testing: 4-6 hours
- Documentation: 2-3 hours

## Documentation Deliverables
1. ✅ **PROJECT_NAME_FEATURE_PLAN.md** - 12-section detailed plan with implementation checklist
2. ✅ **PROJECT_NAME_ARCHITECTURE.md** - Visual diagrams, data flows, and sequence diagrams
3. ✅ **PROJECT_NAME_SUMMARY.md** - This executive summary (1-page overview)

## Success Criteria

### Must Have
- ✅ Project name field appears first in wizard and config
- ✅ Duplicate project names are 100% prevented
- ✅ Multiple projects can use same client name
- ✅ Client name still drives ALL analysis
- ✅ Zero impact on existing functionality

### User Experience
- ✅ Real-time validation with clear error messages
- ✅ Visual hierarchy (project name primary, client name secondary)
- ✅ Search works for both project and client names
- ✅ Helpful inline guidance and examples

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Migration breaks data | Low | High | Test on DB copy first, safe incremental steps |
| Users confuse project/client | Medium | Low | Clear labels, help text, visual hierarchy |
| Validation race conditions | Low | Medium | DB constraint + API validation + proper indexing |
| Performance issues | Low | Low | Database indexing, debounced validation |

**Overall Risk**: **LOW** - Well-planned with multiple safeguards

## Approval Checklist
Before implementation begins:
- [ ] Stakeholder review of field naming ("Project Name" vs alternatives)
- [ ] UX team review of wizard/config mockups
- [ ] DevOps approval of migration strategy
- [ ] QA review of test plan
- [ ] Security review (if applicable)

## Next Steps
1. **Review** this plan and architecture diagrams
2. **Approve** or request modifications
3. **Schedule** implementation sprint
4. **Execute** following the detailed plan
5. **Monitor** rollout and gather feedback

---

## Quick Reference

### Field Comparison
| Aspect | Project Name | Client Name |
|--------|-------------|-------------|
| **Purpose** | Organization | Analysis |
| **Uniqueness** | Required | Not enforced |
| **Display** | Primary | Secondary |
| **Scoring** | Never | Always |
| **Editable** | Yes | Yes |

### Example Project Names
✅ Good: "Q1 2025 Brand Campaign", "Tesla Autopilot Study", "Nike Brand Refresh"  
❌ Bad: "Project 1", "Test", "asdf" (too generic, not descriptive)

### Example Client Names
✅ Good: "Tesla", "Nike", "Microsoft" (brand names for analysis)  
❌ Bad: "Q1 2025 Campaign" (this should be project name)

---

**Questions?** Review the detailed plan in `PROJECT_NAME_FEATURE_PLAN.md` or architecture diagrams in `PROJECT_NAME_ARCHITECTURE.md`.
