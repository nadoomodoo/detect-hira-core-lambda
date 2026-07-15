# Nadoo Cloud Console Design Direction

This document defines the target UI/UX direction for Nadoo Cloud, Nadoo Cloud
Insight, and adjacent admin console surfaces. It is the internal acceptance
standard for the current Next.js, Tailwind, Radix, and lucide stack in
`apps/console`.

## Design Target

The console should feel like an enterprise cloud operations product, not a
procedural document rendered as UI. Pages must optimize for scanning,
comparison, repeated operations, and auditability. Explanatory narrative belongs
in help panels, empty states, documentation, or inline field descriptions, not
as stacked instruction cards at the top of every page.

The target is a mature cloud operations console: accessible, responsive,
resource-oriented, and stable under large-scale admin workloads. The product
should present dense operational data without feeling like a checklist or
manual pasted into the interface.

## Design Research Audit

Last reviewed: 2026-07-03.

The redesign standard below consolidates the product rules for enterprise
cloud operations patterns, visual foundations, data density, table behavior,
overlays, layout, typography, and data visualization. It is not a mood board;
it is the implementation bar for Nadoo Cloud Console.

### Pattern Inventory Adopted

Reusable patterns solve common user problems and keep experiences consistent.
Nadoo should map every admin surface to a known pattern before adding custom
UI:

- **Actions**: Split page-level global actions from row/resource in-context
  actions. Use bulk actions only after explicit selection.
- **Filtering patterns**: Collections use a property filter or structured
  filters with shareable URL state where useful. Free-text search alone is not
  enough for operational resources.
- **Filter persistence in collection views**: Persist status, owner, time
  window, node, project/team, confidence, and severity filters in the URL for
  shareable operational views.
- **Table view**: Default for large comparable resource sets with textual and
  numeric data.
- **Card view**: Use for mobile collection representation and small sets that
  need scanning rather than dense comparison.
- **Split view**: Use a table/card collection plus split panel for quick
  browsing of reports, nodes, allocations, alerts, and audit entries.
- **Details page / details page with tabs / details hub**: Use when one
  resource has configuration, evidence, activity, and related resources. Tabs
  group information; they are not a substitute for short content.
- **Create resource**: Use single page create for simple/medium forms, wizard
  for long interdependent setup, and sub-resource create only when the parent
  context is visible and stable.
- **Defaults**: Prefer transparent useful defaults over raw implementation
  fields, especially in allocation assignment and report generation.
- **Inline edit / attribute editing**: Use for high-frequency property updates
  in collections, including assignment metadata and cost assumptions.
- **Delete patterns**: Match confirmation friction to risk. Low-risk delete can
  be simple; destructive resource or evidence deletion needs explicit
  confirmation.
- **Errors / validation / error messages**: Field errors stay near fields;
  page-level failures use flashbar or alert; recovery action is visible.
- **Empty states / zero-result states**: Empty means no resources exist; zero
  results means filters exclude existing resources. These states must have
  different copy and recovery actions.
- **Loading and refreshing**: Resource collections expose refresh and loading
  states without replacing the page with a blank screen.
- **Feedback mechanisms**: Mutations show success/failure feedback in a stable
  flashbar region, not transient untraceable UI.
- **Help system / secondary panels**: Long explanations, metric definitions,
  and caveats belong in a help panel or secondary panel, not as a preamble
  above the working surface.
- **Service navigation / top navigation / side navigation**: Keep product-level
  controls separate from service structure. Insight pages stay resource
  oriented.
- **Service dashboard / dashboard items**: Dashboards summarize service state
  and route users into collections; they do not become full workflow pages.
- **Data visualization / chart metric drill down**: Charts summarize and guide
  drill-down into collection/detail views. They should not hide tabular
  evidence.
- **Density settings**: Comfortable is the default; compact is a user setting
  for data-heavy admin work.
- **Timestamps**: Show absolute time for audit/evidence contexts; relative time
  can be supplemental, never the only value.
- **Disabled and read-only states**: Distinguish unavailable, unauthorized, and
  immutable states with text, tooltip/help, and consistent styling.
- **Communicating unsaved changes**: Any editable grid, inline assignment form,
  or cost-rate editor must protect users from losing unsaved changes.

Patterns not adopted as default for admin operations:

- **Hero header**: Not used for Cloud Insight operational pages. It may be used
  only for product landing or onboarding, never as the first viewport of a
  collection page.
- **Announcing new/beta features**: Use only for release communication, not to
  decorate stable admin pages.
- **Image magnifier / drag-and-drop**: Use only when the workflow specifically
  needs visual inspection or reordering; not a general layout tool.

### Visual Foundation Audit

The visual foundation below defines the implementation guardrails for the
console. Nadoo maps these rules into Tailwind/Radix/lucide until a broader
component-library migration is evaluated.

#### Colors

Color is a consistency and accessibility tool. Most UI should be white/gray
structure with color reserved for primary actions, links, interactive accents,
and status. Nadoo rules:

- Prefer semantic aliases over one-off hex values:
  - `surface`: white
  - `surface-muted`: gray-50
  - `surface-subtle`: gray-100
  - `border`: gray-200
  - `border-strong`: gray-300
  - `text-primary`: gray-900
  - `text-secondary`: gray-600
  - `text-muted`: gray-500
  - `link/action`: indigo/blue
  - `success`: emerald/green
  - `warning`: amber/orange
  - `error`: red
  - `info`: sky/blue
- Do not use color casually. Every non-neutral color must encode action,
  link/focus, status/severity, chart series, or brand identity.
- Blue/indigo is for primary action, link, focus, and selected states.
- Red/green are primarily for status or resource health, not decoration.
- Color is never the only signal. Pair status color with text and, where useful,
  an icon.
- Keep backgrounds neutral. Avoid full-page tinted themes, gradient sections,
  decorative blobs, and one-note palettes.

#### Data Visualization Colors

Charts use separate rules from UI status badges:

- Use severity/status palette only when the data encodes ordered risk or health
  states.
- Use categorical palette for unrelated qualitative series.
- Limit simultaneous series: target <= 8 series for line/bar charts and <= 5
  points for pie/donut charts.
- Use thresholds as contextual accent lines, not as extra competing series.
- Use darker values for higher importance or larger values when creating custom
  sequential palettes.
- Charts must include labels, legends, tooltips, and accessible text fallback.
- Chart colors must not conflict with status semantics in the same viewport.
  Example: red in a utilization chart should imply risk/critical only if the
  series actually represents risk.

#### Design Tokens

Design tokens abstract visual properties and preserve intent. Nadoo should use
local semantic tokens/classes instead of hard-coded values in new shared
primitives:

- Name by intent, not value: `surface`, `container`, `panel`, `input`,
  `dropdown`, `focus`, `selected`, `disabled`, `success`, `warning`, `error`.
- Do not copy a token value into an unrelated purpose because it "looks right".
- New shared components should centralize class contracts for:
  - surface/background
  - text hierarchy
  - borders and dividers
  - focus rings
  - status badges
  - density spacing
  - overlay z-index
  - chart palette
- Direct Tailwind colors are acceptable in leaf components only until the
  shared primitive exists; once a primitive exists, use that primitive.

#### Content Density

The console supports comfortable and compact density. Comfortable is the
default; compact exists for data-intensive views. Nadoo rules:

- Default density: comfortable.
- Admin operators may switch to compact once `AdminDensityProvider` or an
  equivalent setting exists.
- Compact mode reduces spacing in data-heavy containers, tables, cards, and
  collection toolbars, but not everywhere blindly.
- Do not over-compress help text, validation messages, flashbars, dropdowns,
  date pickers, or chart interaction targets.
- Use the 4px spacing rhythm. New page sections should not introduce arbitrary
  spacing values.
- High-density does not mean clutter. Preserve grouping, visual hierarchy, and
  scan paths.

#### Layout

The layout system separates application, page, section, and content layouts.
Nadoo rules:

- Use one app layout contract across the product.
- Preserve these regions:
  - side navigation
  - breadcrumbs/page context
  - flashbar/notification region
  - main content
  - right-side tools/help/split panel
- The main content has one dominant working surface per page.
- Detail and help content should use split panel/drawer/secondary panel rather
  than stacking more cards above the collection.
- For productivity surfaces, prefer toolbar-style density and stable app
  regions over expressive page composition.
- Layouts should create predictable mental models across Cloud, Fabric, Insight,
  and admin surfaces.

#### Typography

Typography organizes information with hierarchy and readable line height.
Nadoo rules:

- Page title maps to `h1`, 24px/30px equivalent, bold.
- Container title maps to `h2`, 20px/24px equivalent, bold.
- Section/card/key-value group title maps to `h3`, 18px/22px equivalent, bold.
- Paragraph/subsection title maps to `h4`, 16px/20px equivalent, bold.
- Body text defaults to 14px/20px.
- Description, constraint, helper, and validation text defaults to 12px/16px.
- Use monospace/tabular treatment for:
  - code and command output
  - numeric datasets
  - dynamic date/time values
  - IP/MAC addresses
  - ID strings
- Do not use viewport-scaled text. Type scale is semantic, not responsive
  decoration.
- Keep letter spacing at normal/default except existing uppercase metadata
  labels where the local pattern already uses light tracking.

## Current UI Problems To Correct

- Pages over-explain the workflow before showing the working surface.
- Many screens use cards as page sections, creating a narrative/procedural feel.
- Search, filters, table actions, pagination, and preferences are inconsistent
  across admin pages.
- Responsive behavior often degrades because desktop tables are squeezed into
  mobile layouts instead of switching to a mobile collection representation.
- Primary actions are sometimes buried inside page content instead of being
  placed in the page or collection header.
- Forms expose too many implementation fields directly, instead of providing
  defaults, suggestions, import workflows, or advanced expandable sections.
- Similar pages use different heading, summary, empty, loading, and error
  structures.
- Status colors and badges are used without a consistent severity vocabulary.

## Console Principles Adopted

### 1. System Before Decoration

A strong console experience is more than individual components. The foundation
includes colors, density, tokens, iconography, layout, motion, spacing,
typography, visual modes, and accessibility principles. Nadoo should therefore
standardize page shells, content density, actions, tables, status markers, and
forms before adding new visual treatments.

### 2. Resource-First Page Patterns

Admin console pages should be classified into one of these resource-management
patterns:

- **Collection view**: list, compare, filter, sort, bulk act, and open details.
- **Details page**: inspect one resource and related resources.
- **Create/edit form**: configure one resource or import a resource set.
- **Wizard**: complete a long, interrelated setup flow.
- **Dashboard**: summarize state and lead users into operational surfaces.
- **Report/evidence view**: inspect generated outputs, export packets, and hand
  off evidence.

Do not invent a unique page structure per feature unless the workflow truly
does not fit these patterns.

### 3. App Shell And Page Header

Every admin page should have the same shell contract:

- Top navigation: product identity, tenant/profile, global account actions.
- Side navigation: service structure. It is open by default on collection/detail
  pages and may collapse on form flows.
- Page header: title, one-line purpose, global actions, and optional breadcrumbs.
- Help surface: contextual help belongs in a tools/help panel or drawer, not in
  a long preamble inside the main content.
- Flashbar/notification region: action results and page-level errors.
- Main content: one dominant working surface per page.

### 4. Collections Are The Default For Operations

For resources such as users, workspaces, nodes, reports, allocations, cost
rates, audit events, alerts, and releases, the default surface is a collection:

- Header with count, refresh, create/import/export, and one primary action.
- Property filter or structured filter bar for server-side queryable fields.
- Table on desktop with sortable, comparable columns ordered by importance.
- Pagination, even when the current result set fits on one page.
- Collection preferences for row count, visible columns, column order, and
  sticky columns where useful.
- Selection with explicit bulk actions. Bulk actions affect selected visible
  rows only.
- Mobile card/list representation instead of a compressed desktop table.
- Empty state with a direct recovery action, not a paragraph of process
  explanation.

The table view rule is direct: use tables for structured, comparable, sortable
data; order columns by user importance; and use preferences for rows,
visibility, order, view pattern, and sticky columns.

### 4.1 Table And Grid Standard

A table is two-dimensional data arranged in columns and rows. The collection
table is the resource-management pattern for quickly identifying categories and
comparing values across large text and numerical data sets. Nadoo table/grid
work should therefore follow these rules before a page is considered
redesigned:

- A table row must remain a row. Do not place a bordered action card, narrative
  panel, chart, or multi-line workflow block inside a table cell.
- Columns are ordered by operator priority from left to right: identity, owner
  or scope, status, primary metric, time, actions.
- Actions in a row are in-context actions. Show one primary row action inline
  and group secondary exports or utilities behind a compact menu or button
  dropdown.
- Header actions are global collection actions. Create, refresh, import,
  export, preferences, and selected-row bulk actions belong in the collection
  header or toolbar.
- Desktop tables must use stable column widths for time, status, metric, and
  action columns. Avoid unconstrained action cells that push data columns out of
  view.
- Use `tabular-nums` for comparable numbers, dates, currency, percentages,
  counts, utilization, confidence, and GPU hours.
- Status cells include text and consistent severity styling; color alone is
  never the signal.
- Tables need explicit empty, zero-result, loading, and error states. Empty and
  zero-result states should include a direct recovery action when one exists.
- Pagination should be present in the final collection primitive even when the
  current result set fits on one page, so the layout does not change when data
  grows.
- Preferences should support row density, visible columns, column order, and
  table/card view where useful.
- Use horizontal scroll only for expert comparison tables with many required
  columns. The normal Insight collection path must switch to mobile cards
  before action cells wrap into a broken grid.

#### Insight Table Breakpoints

Insight pages must not show desktop tables until the content has enough width
for all mandatory columns and row actions:

- Reports: mobile/card view below `lg`; desktop table at `lg` and above, with
  exports grouped.
- Nodes: mobile/card view below `lg`; desktop table at `lg` and above because
  device mix, readiness, telemetry, and actions need comparison width.
- Allocations: inline assignment grid may use intentional horizontal scroll on
  desktop; below `lg`, use instance assignment cards with the same editable
  fields and a compact action footer.
- Efficiency: group comparison table at `lg` and above; below `lg`, use metric
  cards that show idle cost, total cost, average utilization, and idle share.
- Cost rates: card/list below `md` is acceptable because the table is short, but
  row actions still must not become a nested action card.

### 5. Forms Stay Short

Create/edit pages and import panels should expose only the fields required for
the user to succeed:

- Required fields without reliable defaults.
- Fields at least 80% of users expect to control.
- Advanced or low-frequency options in expandable sections.
- Field help via info links/help panel.
- Validation messages near the field and page-level errors in the flashbar.
- Primary action remains available; validation explains what must be fixed.

This is especially important for Insight allocation workflows. Operators should
start from registered GPU VM/instance inventory, edit assignments in-grid or in
Excel, and upload the workbook. They should not manually type raw IDs unless
they open an advanced fallback.

### 6. Actions Have Placement Rules

- **Global actions** belong in the page or collection header when they apply to
  the page or selected rows.
- **In-context actions** belong on a row, detail panel, or container when they
  apply to one resource.
- Use one visually primary action per scope.
- Secondary actions may be grouped in a dropdown.
- Destructive actions require confirmation sized to risk.

### 6.1 Overlay And Portal Standard

Menus, popovers, tooltips, dialogs, combobox lists, date pickers, and export
dropdowns must render through a portal layer rather than as absolutely
positioned children inside table rows, cards, or scroll containers.

Required behavior:

- Use a portal-backed primitive such as Radix `DropdownMenu.Portal` for menus
  and export/action dropdowns.
- Do not use native `details` plus absolute positioning for row actions or
  filters. It is clipped by `overflow-hidden`, scroll panels, sticky headers,
  and table containers.
- Overlay content uses a shared high z-index layer, collision padding, keyboard
  navigation, outside-click dismissal, and Escape dismissal.
- Overlay width is constrained and content wraps inside the overlay, not by
  expanding the table cell or card that opened it.
- The trigger remains inside the row or toolbar; the overlay is visually
  anchored to the trigger but structurally outside clipping containers.
- Mobile overlays should either use the same portal menu or become an inline
  action sheet only when the container has enough vertical space and no clipping
  risk.

### 7. Density Is A Product Setting

Cloud operations users need high information density. Use dense but readable
tables, compact headers, restrained card use, and predictable spacing. Avoid
oversized hero sections, marketing-style feature cards, decorative gradients,
and page introductions that displace the resource surface.

### 8. Responsive Is A First-Class Requirement

Responsive behavior is not "desktop squeezed smaller." Each collection needs a
mobile representation:

- Table columns collapse into key-value cards or list rows on narrow screens.
- Primary identity, status, owner, time, and the most important action remain
  visible.
- Secondary fields move into expandable details.
- Action groups wrap or collapse into menus.
- Inputs and buttons keep stable dimensions and do not overflow containers.
- Horizontal scroll is allowed only for genuinely tabular expert data, and the
  scroll container must be intentional and labeled by layout.

### 9. Color And Status Semantics

Use color to support meaning, not as the only signal. Status must pair color
with text or iconography. Use a consistent vocabulary:

- `success`: healthy, completed, ready
- `info`: neutral, running, observed
- `warning`: stale, degraded, review needed
- `error`: failed, blocked, policy breach, unavailable
- `neutral`: unknown, disabled, not configured

Primary blue/indigo should be reserved for links, focus, and primary actions.
Red and green should primarily indicate resource status and action confidence.

### 10. Writing Style

Console copy should be operational and short:

- Use sentence case in English and concise natural Korean in Korean UI.
- Use present-tense active voice.
- Avoid exclamation marks, marketing claims, and long procedural paragraphs.
- Header text names the resource or task.
- Descriptions answer "what can I do here?" in one sentence.
- Help panels, docs, and empty states carry longer explanations.

## Page Templates

### Collection Page Template

Use for: Users, Workspaces, Nodes, Compute pools, Allocations, Reports, Cost
rates, Audit logs, Alerts, Releases, Rollouts, Updates.

Structure:

1. Page header: title, one-line purpose, global actions.
2. Optional summary strip: 3-5 metrics only if they change decisions.
3. Collection container:
   - Header with count and refresh.
   - Property filter/search and quick filters.
   - Desktop table.
   - Mobile card/list view.
   - Pagination and preferences.
4. Split panel or drawer for selected resource details when useful.
5. Flashbar for action outcomes.

Avoid:

- Intro cards before the collection.
- Cards inside cards.
- One-off filter layouts.
- Tables without mobile alternatives.

### Details Page Template

Use for: one user, one workspace, one GPU node, one report, one allocation set,
one alert incident.

Structure:

1. Breadcrumbs and resource title.
2. Status, key properties, and resource actions.
3. Tabs or grouped containers for configuration, related resources, activity,
   and evidence.
4. Related resource previews when the data set is large.

### Create/Edit Form Template

Use for: create workspace, configure quota, create alert rule, edit cost rate,
register/import allocation data.

Structure:

1. Page title starts with the action.
2. One primary configuration container.
3. Advanced settings expandable section.
4. Form action bar.
5. Help panel for supplemental explanation.

### Wizard Template

Use only for long or interdependent flows:

- GPU node registration across prerequisites, command generation, verification,
  and post-install checks.
- Initial Insight onboarding if it spans agent install, enrollment, inventory,
  and first report.
- Release/rollout workflows with staged review.

Wizard review pages summarize selections in the same order as the steps and
link back to edit the relevant step.

### Dashboard Template

Dashboard pages summarize current operating state and route users to collection
or details pages. Dashboard items must have one primary action at most. Avoid
using dashboards as full workflow pages.

## Cloud Insight-Specific Direction

Cloud Insight is a diagnosis and evidence-preparation product. It must not
look like a human adjudication or explanation-resolution system.

### Insight Navigation

Keep top-level pages resource-oriented:

- Overview: health, collection coverage, recent report status.
- Efficiency: utilization and idle patterns.
- Reports: generated report collection and exports.
- Nodes: observed node/GPU inventory.
- Allocations: assignment ledger built from registered GPU VM/instances.
- Cost rates: pricing assumptions for cost impact estimates.

Do not add a top-level "explanation queue" menu. Evidence request packets are a
report workflow surface, not a separate adjudication product.

### Allocations Page Target

The target page should be:

- A registered GPU VM/instance collection.
- Inline assignment grid where possible.
- Excel workbook download/upload for bulk assignment editing.
- Advanced fallback for exceptional manual repair only.
- Existing assignment ledger as a collection, not a procedural form.

Primary actions:

- `Download Excel template`
- `Upload Excel`
- `Save grid changes` once inline grid editing exists

Advanced actions:

- Manual repair
- Delete assignment
- Recalculate report windows

### Reports Page Target

Reports should be a collection with:

- Report window, status, data confidence, generated time, and export actions.
- Property filters for status, time window, node, project/team, and confidence.
- Details drawer/page for recommendations and evidence.
- Export actions grouped by format.

### Evidence Request Target

Evidence request generation belongs under a report or candidate detail:

- Present observed metrics, confidence, sample coverage, and process/network
  signals.
- Let the operator export or send a request packet.
- Do not ask the respondent to complete "소명" inside Cloud Insight.
- Do not label system output as a final judgment.

## Implementation Rules For `apps/console`

### Shared Primitives To Build Or Normalize

Create or consolidate these primitives before continuing page-by-page redesign:

- `AdminAppShell`
- `AdminPageHeader`
- `AdminCollection`
- `AdminPropertyFilter`
- `AdminTable`
- `AdminMobileCollectionCards`
- `AdminCollectionPreferences`
- `AdminSplitPanel`
- `AdminStatusIndicator`
- `AdminFlashbar`
- `AdminFormSection`
- `AdminAdvancedSection`
- `AdminEmptyState`

These can be implemented with current Tailwind/Radix/lucide dependencies. A
future component-library dependency should be evaluated separately, but the UX
contract should not wait for that migration.

### Component Mapping

| Design concept | Nadoo implementation target |
| --- | --- |
| App layout | `AdminAppShell` with top nav, side nav, content, drawer/split panel |
| Header | `AdminPageHeader` and collection headers |
| Table view | `AdminCollection` + `AdminTable` + pagination/preferences |
| Property filter | Server-aware `AdminPropertyFilter` with typed tokens |
| Cards view | Mobile collection cards or mixed-content resource cards |
| Split panel / drawer | Detail preview and contextual help |
| Flashbar | Global operation result and page error messages |
| Form field | Standard label, description, validation, help affordance |
| Wizard | Multi-step registration/onboarding/release flows |
| Status indicator | Shared severity vocabulary and icon/text pairing |

## Migration Plan

### Phase 1: Design System Skeleton

- Add shared admin shell, page header, collection, status, empty, flashbar, and
  mobile card primitives.
- Add Storybook or lightweight component examples if the repo adopts it later;
  until then, use focused component tests and screenshot checks.
- Define responsive table-to-card behavior once and reuse it.

### Phase 2: High-Impact Admin Pages

Refactor pages with visible UX debt first:

1. Cloud Insight Allocations
2. Cloud Insight Reports
3. Cloud Insight Nodes
4. Admin Users
5. Admin Workspaces
6. Admin Nodes
7. Audit logs
8. Alerts

### Phase 3: Forms And Wizards

- Convert long procedural forms into single-page forms or wizards.
- Move explanatory text into help panels and field descriptions.
- Hide advanced fields behind expandable sections.

### Phase 4: Visual Consistency And QA

- Remove decorative/narrative cards from operational pages.
- Normalize status badges, button hierarchy, spacing, and typography.
- Run desktop and mobile screenshot tests for every admin route.
- Add overflow checks for grids, tables, action bars, and filters.

## Acceptance Checklist For Any Redesigned Page

- The main working surface is visible without scrolling on desktop.
- The page has one dominant purpose and one primary action per scope.
- Collection pages include filter, table/card, pagination, and preferences.
- Mobile layout uses cards/list rows, not compressed desktop grids.
- Empty/loading/error states are actionable and concise.
- Help text is contextual and does not block the working surface.
- Status is conveyed with text/icon, not color alone.
- Actions are placed globally or in-context according to their scope.
- Advanced or exceptional fields are not shown by default.
- Korean, English, and Japanese messages are updated together.
- Component tests cover the page pattern and mobile-critical rendering.
- Browser screenshot verification is captured for desktop and mobile.

## Internal Reference Scope

This document is the project-local design policy. Implementation discussions,
tests, and code comments should reference `design.md` rather than external
design-system sources.
