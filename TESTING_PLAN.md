# Playwright Optimization Testing Plan

## Overview
This document outlines the comprehensive testing plan for validating that the Nix package optimization (21 → 12 packages) does not break PDF generation or website crawling functionality.

---

## 🎯 Optimization Summary

### **Packages Removed (9 total):**
- `xorg.libXfixes` - Cursor fixes (not needed in headless)
- `xorg.libXrandr` - Display rotation (not needed)
- `libxkbcommon` - Keyboard input (no user input in headless)
- `at-spi2-atk` - Assistive technology (unnecessary)
- `at-spi2-core` - Assistive technology core (unnecessary)
- `alsa-lib` - Audio library (PDFs don't need sound)
- `cups` - Printing library (not used)
- `mesa` - 3D graphics acceleration (overkill for PDF)

### **Packages Retained (12 total):**
- `xorg.libX11` - Core X11 display library
- `xorg.libxcb` - X protocol C binding
- `xorg.libXcomposite` - Window composition
- `xorg.libXdamage` - Damage tracking
- `xorg.libXext` - X11 extensions
- `nss` - Network Security Services (SSL/TLS)
- `nspr` - Netscape Portable Runtime (for NSS)
- `atk` - Accessibility toolkit
- `cairo` - 2D graphics rendering
- `pango` - Text rendering
- `glib` - Core library dependencies
- `dbus` - Inter-process communication

### **Expected Benefits:**
- 43% reduction in Nix packages
- Estimated 2-3 minute faster deployment
- Reduced Docker layer size

---

## 🧪 Test Suite 1: PDF Generation

### **Purpose:**
Verify that Playwright can still render HTML to PDF correctly with reduced dependencies.

### **Test Location:**
`server/services/pdf-renderer.ts`

### **Prerequisites:**
1. At least one report generated in the system
2. Application running (`npm run dev`)
3. Access to Reports page

---

### **Test Case 1.1: Basic PDF Download**

**Steps:**
1. Navigate to Reports page (`/reports`)
2. Locate any existing report in the list
3. Click "Download PDF" button
4. Wait for download to complete

**Expected Results:**
- ✅ No console errors during PDF generation
- ✅ PDF file downloads successfully
- ✅ File size is reasonable (>50 KB, <5 MB)
- ✅ PDF opens in viewer without errors

**Pass Criteria:**
- PDF downloads within 10 seconds
- No errors in browser console
- No errors in server logs

---

### **Test Case 1.2: PDF Content Validation**

**Steps:**
1. Download a report PDF (from Test Case 1.1)
2. Open PDF in Adobe Reader/Chrome PDF viewer
3. Inspect all pages of the PDF

**Expected Results:**
- ✅ All text is readable (no garbled characters)
- ✅ Fonts render correctly (headings, body text, code)
- ✅ Colors render correctly (charts, backgrounds)
- ✅ Layout is intact (no overlapping elements)
- ✅ Charts/graphs render correctly
- ✅ All sections present:
  - Executive Summary
  - Key Findings
  - Visibility Analysis
  - Root Cause Hypotheses
  - Recommendations

**Pass Criteria:**
- All content is legible and properly formatted
- No missing sections
- Charts and visual elements display correctly

---

### **Test Case 1.3: PDF Rendering Quality**

**Steps:**
1. Download PDF
2. Zoom to 200% in PDF viewer
3. Check text sharpness and clarity

**Expected Results:**
- ✅ Text remains sharp at high zoom levels
- ✅ No pixelation or blurriness
- ✅ Vector graphics scale cleanly

**Pass Criteria:**
- Text quality matches previous PDF exports
- No degradation in rendering quality

---

### **Test Case 1.4: Server Logs Validation**

**Steps:**
1. Trigger PDF generation
2. Monitor server console output
3. Check for errors or warnings

**Expected Results:**
- ✅ Log shows: "Launching browser for PDF generation..."
- ✅ Log shows: "PDF generated successfully"
- ✅ No errors related to missing libraries
- ✅ No warnings about missing dependencies

**Common Error Patterns to Watch:**
```
❌ "Error: Failed to launch browser!"
❌ "libX11.so: cannot open shared object file"
❌ "libnss3.so: cannot open shared object file"
❌ "Protocol error"
```

**Pass Criteria:**
- Clean logs with no errors
- Browser launches successfully
- PDF generation completes without warnings

---

### **Test Case 1.5: Multiple PDF Generations**

**Steps:**
1. Generate 3 PDFs in succession
2. Download each one
3. Verify all complete successfully

**Expected Results:**
- ✅ All 3 PDFs download successfully
- ✅ No memory leaks or crashes
- ✅ Consistent generation times (~5-10 seconds each)

**Pass Criteria:**
- No degradation in performance
- All PDFs open correctly
- Server remains stable

---

## 🧪 Test Suite 2: Website Crawling

### **Purpose:**
Verify that PlaywrightCrawler fallback still works for JavaScript-heavy websites.

### **Test Location:**
`server/services/website-crawler.ts`

### **Prerequisites:**
1. At least one client configured
2. Application running
3. Access to Client Configuration page

---

### **Test Case 2.1: Cheerio Crawler (Baseline)**

**Purpose:** Verify Cheerio crawler still works (doesn't use Playwright)

**Steps:**
1. Navigate to Client Configuration page
2. Select a client
3. Click "Generate Metadata" or "Crawl Website"
4. Use a static HTML site (e.g., `https://example.com`)

**Expected Results:**
- ✅ Crawl completes successfully
- ✅ Log shows: "Starting Cheerio crawl for: ..."
- ✅ Log shows: "Cheerio crawl successful: X pages extracted"
- ✅ No fallback to Playwright
- ✅ Content extracted correctly

**Pass Criteria:**
- Cheerio completes without errors
- At least 1 page extracted
- No Playwright invocation

---

### **Test Case 2.2: Playwright Fallback (Critical Test)**

**Purpose:** Verify Playwright fallback works with optimized packages

**Steps:**
1. Navigate to Client Configuration
2. Select a client
3. Use a JavaScript-heavy site that requires browser rendering:
   - Test with: `https://www.anthropic.com` (React-based)
   - Or: `https://vercel.com` (Next.js app)
4. Trigger metadata generation
5. Monitor server logs carefully

**Expected Results:**
- ✅ Cheerio attempts first: "Starting Cheerio crawl for: ..."
- ✅ Cheerio gets <3 pages or fails
- ✅ Log shows: "Trying Playwright for better coverage..."
- ✅ Playwright launches successfully
- ✅ Log shows: "Starting Playwright crawl for: ..."
- ✅ Log shows: "Playwright crawl successful: X pages extracted"
- ✅ Content extraction completes
- ✅ Pages contain meaningful content (not just loading spinners)

**Common Error Patterns to Watch:**
```
❌ "Error: Failed to launch browser!"
❌ "Playwright crawl error: Browser closed unexpectedly"
❌ "Protocol error: Target closed"
❌ "libX11.so: cannot open shared object file"
```

**Pass Criteria:**
- Playwright launches without errors
- At least 1 page extracted via Playwright
- Extracted content length >100 characters per page
- No library dependency errors

---

### **Test Case 2.3: Content Quality Validation**

**Steps:**
1. Complete a Playwright-based crawl (Test Case 2.2)
2. Check the extracted content in the database or logs
3. Verify content makes sense

**Expected Results:**
- ✅ Page titles are present
- ✅ Content is meaningful (not "Loading..." or spinner text)
- ✅ HTML is rendered (JavaScript executed)
- ✅ Multiple pages extracted (>1 page)

**Pass Criteria:**
- Content reflects actual page content
- Not just skeleton HTML
- JavaScript-rendered content is captured

---

### **Test Case 2.4: Server Logs Validation**

**Steps:**
1. Run a Playwright crawl
2. Monitor server console
3. Check for warnings/errors

**Expected Results:**
- ✅ "Launching browser for crawl..." appears
- ✅ "Crawling with browser: [URL]" appears
- ✅ "Extracted X chars from [pageType] page: [title]" appears
- ✅ "Playwright crawl completed. Extracted X pages." appears
- ✅ No library errors
- ✅ Storage cleanup successful

**Pass Criteria:**
- Complete crawl lifecycle logs present
- No errors or warnings
- Browser launches and closes cleanly

---

### **Test Case 2.5: Fallback Logic Validation**

**Purpose:** Verify the automatic fallback mechanism works

**Steps:**
1. Use a site that Cheerio can handle (static HTML)
2. Use a site that Cheerio cannot handle (heavy JavaScript)
3. Compare crawl methods used

**Test Sites:**
- Static: `https://example.com`
- Dynamic: `https://www.anthropic.com`

**Expected Results:**

**For Static Site:**
- ✅ Cheerio succeeds
- ✅ No Playwright fallback
- ✅ Method: "cheerio"

**For Dynamic Site:**
- ✅ Cheerio attempts but gets <3 pages
- ✅ Playwright fallback triggered
- ✅ Method: "playwright"
- ✅ More pages extracted than Cheerio

**Pass Criteria:**
- Fallback logic works as designed
- Playwright only used when necessary
- Better results with Playwright for JS sites

---

## 🧪 Test Suite 3: Integration Tests

### **Test Case 3.1: End-to-End Report Generation**

**Purpose:** Verify entire workflow from crawl → metadata → report → PDF

**Steps:**
1. Create a new client
2. Add client website URL (use JS-heavy site)
3. Trigger metadata generation (tests crawling)
4. Wait for completion
5. Create prompts and run them
6. Generate a report
7. Download report PDF (tests PDF generation)

**Expected Results:**
- ✅ Crawl completes (Playwright fallback works)
- ✅ Metadata extracted correctly
- ✅ Report generated successfully
- ✅ PDF downloads and renders correctly

**Pass Criteria:**
- Complete workflow succeeds end-to-end
- No errors at any stage
- PDF contains crawled data

---

### **Test Case 3.2: Concurrent Operations**

**Purpose:** Test multiple Playwright instances simultaneously

**Steps:**
1. Trigger 2 PDF downloads simultaneously
2. OR trigger PDF download + website crawl at same time
3. Monitor server resources and stability

**Expected Results:**
- ✅ Both operations complete successfully
- ✅ No race conditions or crashes
- ✅ Each operation isolated (separate browser instances)

**Pass Criteria:**
- Server remains stable
- Both operations succeed
- No conflicts or errors

---

## 🧪 Test Suite 4: Error Handling

### **Test Case 4.1: Invalid URL Crawling**

**Steps:**
1. Try to crawl an invalid/unreachable URL
2. Monitor error handling

**Expected Results:**
- ✅ Graceful error message
- ✅ No crash or hang
- ✅ Error logged appropriately

**Pass Criteria:**
- System handles errors gracefully
- No server crash

---

### **Test Case 4.2: Browser Timeout Handling**

**Steps:**
1. Crawl a very slow-loading site
2. Wait for timeout (30 seconds)
3. Verify timeout handling

**Expected Results:**
- ✅ Timeout triggers correctly
- ✅ Browser closes cleanly
- ✅ Error message logged
- ✅ No hanging processes

**Pass Criteria:**
- Clean timeout behavior
- Resources released properly

---

## 📋 Quick Testing Checklist

Use this for rapid validation:

### **PDF Generation** (5 minutes):
- [ ] Download 1 PDF
- [ ] PDF opens without errors
- [ ] Content is readable
- [ ] No server errors in logs

### **Website Crawling** (10 minutes):
- [ ] Crawl 1 static site (Cheerio)
- [ ] Crawl 1 JS-heavy site (Playwright fallback)
- [ ] Check logs for "Playwright crawl successful"
- [ ] Verify content extraction quality
- [ ] No library errors

### **Overall System Health**:
- [ ] Application starts without errors
- [ ] No console warnings about missing libraries
- [ ] Workflows restart successfully

---

## 🚨 Critical Failure Indicators

**Abort testing immediately if you see:**

1. **Browser Launch Failure:**
   ```
   Error: Failed to launch browser!
   Error: Browser closed unexpectedly
   ```

2. **Missing Library Errors:**
   ```
   libX11.so: cannot open shared object file
   libnss3.so: cannot open shared object file
   libcairo.so: cannot open shared object file
   ```

3. **PDF Generation Crashes:**
   ```
   Protocol error (Target.createTarget): Target closed
   Segmentation fault
   ```

4. **Playwright Crawl Hangs:**
   - Crawl doesn't complete after 2 minutes
   - No log output for >30 seconds
   - Server becomes unresponsive

**If any occur:**
- Stop testing immediately
- Reinstall removed packages
- Report findings

---

## 📊 Test Results Template

After testing, document results:

```markdown
## Test Results - Playwright Optimization

**Date:** [Date]
**Tester:** [Name]
**Environment:** Replit Development

### PDF Generation Tests:
- Test 1.1 - Basic PDF Download: [ PASS / FAIL ]
- Test 1.2 - PDF Content: [ PASS / FAIL ]
- Test 1.3 - Rendering Quality: [ PASS / FAIL ]
- Test 1.4 - Server Logs: [ PASS / FAIL ]
- Test 1.5 - Multiple PDFs: [ PASS / FAIL ]

### Website Crawling Tests:
- Test 2.1 - Cheerio Baseline: [ PASS / FAIL ]
- Test 2.2 - Playwright Fallback: [ PASS / FAIL ]
- Test 2.3 - Content Quality: [ PASS / FAIL ]
- Test 2.4 - Server Logs: [ PASS / FAIL ]
- Test 2.5 - Fallback Logic: [ PASS / FAIL ]

### Integration Tests:
- Test 3.1 - End-to-End: [ PASS / FAIL ]
- Test 3.2 - Concurrent Ops: [ PASS / FAIL ]

### Error Handling Tests:
- Test 4.1 - Invalid URL: [ PASS / FAIL ]
- Test 4.2 - Browser Timeout: [ PASS / FAIL ]

### Overall Result: [ PASS / FAIL ]

### Notes:
[Any observations, issues, or concerns]

### Recommendation:
[ ] Proceed with deployment
[ ] Rollback changes
[ ] Further investigation needed
```

---

## 🎯 Success Criteria

**All tests must pass to consider optimization successful:**

1. ✅ All PDF downloads work correctly
2. ✅ PDF content quality unchanged
3. ✅ Playwright fallback works for JS sites
4. ✅ Cheerio continues to work for static sites
5. ✅ No missing library errors in logs
6. ✅ Server remains stable under load
7. ✅ Error handling works correctly

**If any test fails:**
- Do not deploy
- Reinstall removed packages
- Investigate root cause

---

## 📞 Rollback Plan

**If optimization causes issues:**

```bash
# Reinstall removed packages
1. Use packager tool to reinstall all 9 packages
2. Restart application
3. Re-test PDF generation and crawling
4. Verify functionality restored
```

**Removed packages to reinstall if needed:**
```
xorg.libXfixes
xorg.libXrandr
libxkbcommon
at-spi2-atk
alsa-lib
cups
mesa
at-spi2-core
```

---

## 📝 Next Steps After Testing

**If All Tests Pass:**
1. Deploy to production
2. Monitor deployment time
3. Track timeout improvements
4. Update documentation

**If Tests Fail:**
1. Document failure mode
2. Rollback changes
3. Consider Phase 2 options:
   - Try `playwright-driver.browsers` package
   - Use external PDF service
   - Rewrite with lighter library

---

## 🔍 Deployment Testing Plan

**After successful local testing:**

1. Deploy to Replit
2. Monitor build logs for:
   - Reduced package download time
   - Successful deployment completion
   - No timeout errors
3. Test deployed app:
   - Generate 1 PDF
   - Crawl 1 website
4. Verify production stability

**Success metrics:**
- Deployment completes without timeout
- PDF generation works in production
- Website crawling works in production
- No performance degradation

---

**End of Testing Plan**
