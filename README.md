# EAHS Agriculture Department

A separate Agriculture edition of the Everett Alvarez department website. This repository contains the GitHub Pages entry site and the complete Google Apps Script application. It is prepared for installation; it has not been published, connected to a live Sheet, or installed in the Science project.

The starting inventory, checkouts, staff directory, meetings, reservations and prices are empty. The materials catalog contains suggestions for staff to verify, not an assertion of owned stock or required purchases.

## What is included

- Department hub, announcements, faculty directory, shared links, meeting agendas and minutes.
- Inventory by location, department totals, deliveries, physical count corrections and CSV import/export.
- Barcode product lookup through the existing seven public databases, followed by product clarification and final confirmation before saving.
- Reusable equipment checkout, partial returns, consumable use and activity history.
- Distinct At limit and Below limit flags, shopping-list export, repair and replacement requests.
- Staff-entered supplier quotes, per-counted-unit price averages, and a PriceJobs queue for a separate Ag research task.
- Ag space reservations stored in the new Ag Sheet, including overlap checks and duplicate-request protection.
- 50 Ag material categories plus Other, 187 starter catalog suggestions, and editable pathway/program labels.

### Locations

214 · 215 · Prep Area · Shop · Floristry · Shed · Farm

### Material coverage

Shop tools, welding equipment and consumables, metal and lumber, hardware, electrical and plumbing, machinery, farm tools, fencing, seeds, plants, growing media, fertilizers, greenhouse supplies, floral tools and materials, animal handling and housing, feed and bedding, veterinary teaching supplies, laboratory equipment, soil/water testing, forestry, food science, PPE, cleaning, storage, technology, curriculum, FFA and SAE materials.

Material **category** remains separate from **type**: Reusable means a checkout can be returned; Consumable means use deducts stock. Choose Other to add a category, verify it, then save. The new category appears in later forms and the Add & import category list.

## Install the separate Ag system

1. Create a **new blank Google Sheet** named `Everett Alvarez Agriculture Department Inventory`. Open **Extensions → Apps Script** from that Sheet. This must be a new bound project, rather than the Science script project or a copied populated Science Sheet.
2. Add every file in `apps-script` to that project. `.gs` files are script files. HTML files are named **Index, InventoryClient, HubIndex, HubClient, Reservations, ReservationClient**, without the `.html` suffix in the editor. The three `*Client` files intentionally contain raw JavaScript; paste them exactly, without extra script tags. Replace the default Code file with this package's Code.gs. Show the manifest in Project Settings and use the included `appsscript.json`.
3. Run **initializeAgDepartment** once in the editor and authorize it. It creates inventory, hub and reservation tabs with their headers, the seven locations and the starter catalog. It creates no stock or prices. The execution log shows the new Sheet link and counts. Running it again preserves saved records. Setup refuses a project connected elsewhere or a Sheet with existing department data.
4. Review `DepartmentConfig.gs`: confirm the email domain, reservation period times, minimum-day dates, closed dates, course/program labels and units. The reservation times are inherited school defaults, not a newly verified school calendar. Add holidays/closed dates before staff book spaces. Set the project timezone to America/Los_Angeles.
5. Choose **Deploy → New deployment → Web app**. Use the department owner as execution identity and restrict access to the school domain, subject to your school's available access options. Authorize the deployment and copy its **/exec URL**. Open `/exec` for inventory, `/exec?page=hub` for the hub, and `/exec?page=reservations` for spaces.
6. Create a new GitHub repository, suggested name **EAHS-Ag**. Upload the *contents* of this repository folder so README.md, docs and apps-script are at the repository root. In `docs/site-config.js`, paste only the new Ag /exec URL into `inventoryAppUrl`, then commit it.
7. In the new repository, choose **Settings → Pages → Deploy from a branch → main → /docs → Save**. GitHub Pages hosts the entry pages; shared records and mutations run in Apps Script. The entry pages remain unconnected until their new URL is configured.
8. Open the Ag site using a school account. Check all seven locations, add one real item, scan a real package and verify its identity/conversion, record a checkout and return, and test a reservation in one location. Verify the resulting rows in the new Ag Sheet. Enter actual staff and teaching assignments in Faculty.

For later changes, update the Ag source only and deploy a **new version of its existing deployment**. Keep that deployment URL so GitHub entry links remain valid.

## Daily setup decisions

- `docs/inventory_template.csv` is a blank import template. Fill actual counts and stock targets; imports preview before saving. `inventory_examples_DO_NOT_IMPORT.csv` explains naming and units and must not be imported unchanged.
- The initial Catalog tab is generated from Catalog.gs. Edit the live Catalog tab for your local materials/courses; changing the source seed later does not overwrite an already populated Catalog. `docs/catalog_reference.csv` is the same starting list for review.
- Location dropdowns read the live Locations tab after initialization. Keep numeric rooms as 214 and 215 and retain the named spaces. Config defaults seed a new Sheet; they do not rename existing records.
- Every quantity is a **whole number of counted inventory units**. A 50 lb feed bag can be counted as one bag, not 50 items. Do not enter fractional pounds, gallons or lengths in this edition. Use whole packages or an explicitly defined smaller counting unit, with the package size/specification in the item name.
- Separate species, feed formulas, plant varieties, chemical grades, glove sizes, voltages, capacities and machine models in item names. A barcode or a generic catalog suggestion does not establish compatibility.
- New material suggestions carry no prices. Enter verified quotes through Costs & prices; one listing for a complete counted bag/box/set uses packQuantity 1. Existing staff prices win over planning defaults.
- The new minutes template and records folder are created when the first meeting requests a document. Share the new meeting folder/documents with department staff using your normal school policy so they can open the links. No Science template/folder is reused or automatically shared.

## Reservations and pricing

The supplied Science source did not contain its separate reservation server. This edition includes an Ag reservation module in the **same new Apps Script project**, using the Reservations tab. It does not call the Science calendar, send email, or create Google Calendar events. All Ag courses share the configured advance window; Science AP-priority rules are not inherited. To cancel a booking in this edition, a department records editor changes its Reservations status from Confirmed to Cancelled in the Sheet, then staff refresh the page.

The existing Science ChatGPT pricing task is not connected to Ag. Manual prices and queued requests are available immediately. `pricing-research-request.txt` supplies instructions for separate Ag research after inserting the new Ag Sheet link. Setting `pricingTaskConfigured` to true only updates the website label; it does not create, activate or verify an external task. No paid API, key or subscription is required by this code.

The copied inventory/hub permissions model uses school-domain deployment access and typed staff names as audit labels. It does not implement separate staff/admin roles. Decide who should have direct Sheet/project editing access during setup.

## Repository map

| Path | Purpose |
| --- | --- |
| docs/ | GitHub Pages entry pages, configuration, styles and CSV references |
| apps-script/ | Complete Ag backend, HTML shells and client scripts |
| DepartmentConfig.gs (inside apps-script) | Active department defaults, materials, programs and schedule |
| department-defaults.json | Readable reference copy of the starting configuration |
| MATERIALS.md | Category coverage and California pathway context |
| pricing-research-request.txt | Separate Ag supplier-research instructions |
| verify*.cjs | Source and behavior checks; no live account calls |
| source-manifest.json | Baseline filenames and file hashes for this edition |

No Science deployment, record, inventory, staff, price or calendar identifiers appear in the shipped application configuration. The new repository should have its own history rather than carrying old Science commits or credentials. No `.clasp.json`, token or credential file is included.

## Validation

Run from this repository folder using Node.js:

```sh
node verify.cjs
node verify-categories.cjs
node verify-barcodes.cjs
node verify-ag.cjs
```

57 checks pass: 14 core checks, 12 category checks, 21 barcode checks, and 10 Ag setup/isolation/reservation checks. They use in-memory Sheet, browser and provider substitutes. Actual Google authorization, deployed calls, barcode camera behavior, live provider connectivity and full browser rendering still require the installation checks above.

Setup references checked October 8, 2026:

- [GitHub Pages publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [Apps Script web apps](https://developers.google.com/apps-script/guides/web)
- [Apps Script HTML templates](https://developers.google.com/apps-script/reference/html/html-template)
