# Requirements – Faction Renown Tracking

## Decisions from clarification
- Storage: Journal Entry Page sub-type backed by a DataModel.
- Renown: numeric points with per-level thresholds; 8 levels from Infamous to Paragon.
- Leader: single Actor now; data stored as a `leadership` list of `{ actorUuid, rank }` so more ranks can be added later.
- Tracked actors: any Actor.
- Permissions: GM edits everything; players can view factions where one of their owned actors is tracked.
- UI: Journal sidebar button + faction page sheet, and a standalone Faction Manager (ApplicationV2).
- Renown change history and chat notification on level change are included.
- Test framework: Vitest.

## Assumptions (please confirm or change)
- Points range -100 to 100, clamped, initial 0.
- Thresholds (minimum points): Infamous -100, Hated -75, Disliked -40, Neutral -10, Liked 10, Respected 40, Revered 75, Paragon 90.
- Default logo: `icons/svg/mystery-man.svg`.

## Requirements
| ID | Requirement | Acceptance criteria |
|----|-------------|---------------------|
| REQ-001 | A faction has a name, logo, description, leadership and goals. | `createFaction` returns all fields; description defaults to "". |
| REQ-002 | Faction name is required. | Empty/whitespace name throws; name is trimmed. |
| REQ-003 | Logo falls back to a default icon. | Missing/blank logo yields the default path. |
| REQ-004 | An Actor can be assigned as leader (single, extensible by rank). | `setLeader` stores `{actorUuid, rank:"leader"}`; replaces previous leader; `null` clears; other ranks preserved. |
| REQ-005 | Goals have title, description, completed flag. | `addGoal` creates goal with unique id, `completed:false`; blank title throws. |
| REQ-006 | Goals can be completed/uncompleted and removed. | `toggleGoal` flips state; `removeGoal` removes it; unknown id throws. |
| REQ-007 | Actors can be added to a faction to track renown (dropping an Actor). | `addMember` adds with 0 points; duplicates ignored; `removeMember` removes. |
| REQ-008 | Renown levels map from points via thresholds. | `getRenownLevel` returns correct key at every boundary. |
| REQ-009 | Renown is clamped to -100..100. | `clampRenown`/`setRenown` never exceed bounds; non-finite rejected. |
| REQ-010 | Renown changes are logged. | `setRenown` appends `{actorUuid, from, to, reason, user, timestamp}`. |
| REQ-011 | Level changes are reported for chat notification. | `setRenown` result has `levelChange {from,to}` only when level key changes, else `null`. |
| REQ-012 | Only tracked actors can have renown changed. | `setRenown` on non-member throws. |
| REQ-013 | GM edits; players view only factions tracking an actor they own. | `canEdit` true only for GM; `canView` per rule. |
| REQ-014 | Logic functions are pure (inputs not mutated). | Original faction object deep-equals snapshot after calls. |

## Traceability
| Requirement | Test file |
|---|---|
| REQ-001–007, 010–012, 014 | tests/faction.test.mjs |
| REQ-008–009 | tests/renown.test.mjs |
| REQ-013 | tests/permissions.test.mjs |

Not unit-testable (manual/in-Foundry): drag-drop UI, file picker, sidebar button, chat message rendering, DataModel registration. Gap noted; only their pure logic is covered.

## Intended modules (for FoundryModuleDeveloper)
- `scripts/renown.mjs`: `RENOWN_LEVELS`, `RENOWN_MIN`, `RENOWN_MAX`, `clampRenown`, `getRenownLevel`
- `scripts/faction.mjs`: `DEFAULT_FACTION_IMG`, `createFaction`, `setLeader`, `addGoal`, `toggleGoal`, `removeGoal`, `addMember`, `removeMember`, `setRenown(faction, actorUuid, points, {reason, user, timestamp}) -> { faction, levelChange }`
- `scripts/permissions.mjs`: `canEdit({isGM})`, `canView({isGM, ownedActorUuids}, faction)`

## Quest tracking and faction organization

The requirements below supersede the single-leader UI in REQ-004. Existing
renown tracking, including its data, history, permissions, and behavior, remains
independent of organizational membership. Existing leader assignments need not
be migrated to roles or members. The current `members` data in the faction
model refers to renown tracking, not the new organizational membership.

| ID | Requirement and rationale | Acceptance criteria |
|---|---|---|
| REQ-015 | Provide a dedicated quest manager so GMs can track quests separately from factions. | A Quests button appears beside Factions in the Journal sidebar. A GM can create, edit, and delete quests in the manager. The manager is GM-only. |
| REQ-016 | Capture quest details. | A quest requires a nonblank title and description and at least one giver: an Actor, a faction, or both. Its icon is optional and uses a default when omitted. |
| REQ-017 | Represent progress without imposing a workflow. | States are Offered, Rejected, Accepted, In Progress, Completed, and Failed. New quests start Offered. A GM may change between any states; a non-GM cannot change state. |
| REQ-018 | Describe optional rewards and consequences. | A reward may combine XP, item entries with quantities, and system currencies, or be empty. A failure consequence is optional and is not automated. |
| REQ-019 | Record interested parties separately from givers. | A quest may have any number of Actor and faction observers; each is a link to its sheet. A giver is not an observer. Observers are optional. |
| REQ-020 | Relate quests without controlling their progression. | In both quest forms, a GM can add and remove links using a text search with autocomplete and a list of selected quests instead of a list of all quests with checkboxes. Search matches anywhere in a title, ignoring case; an empty search shows no suggestions. Already selected quests are not suggested, and duplicate titles are distinguished by UUID. Links are bidirectional, cannot point to the same quest, and have no prerequisite or automatic state effects. |
| REQ-021 | Avoid dangling relationships. | Deleting a quest removes its relationships from other quests without changing their states or deleting them. |
| REQ-022 | Show faction involvement. | A faction's Quests section lists quests for which it is a giver or observer. Players who can view the faction can see quest names and links and open quest details read-only; they cannot edit quests. |
| REQ-023 | Create quests in faction context. | A faction window offers a GM-only Create Quest button. The GM chooses whether and how to associate the originating faction as giver or observer; normal giver validation still applies. |
| REQ-024 | Confirm reward distribution on completion. | On changing a quest to Completed, show an assignment window. Cancel leaves quest and rewards unchanged. A quest without rewards may complete without assignments; otherwise the GM assigns recipients. |
| REQ-025 | Award XP to selected actors. | The GM selects recipient actors. Each selected actor receives the full specified XP amount, not a split share. |
| REQ-026 | Award items flexibly. | Each item entry has a quantity. The GM may distribute copies among different actors; items are copied, not transferred. It is not necessary to assign every copy. |
| REQ-027 | Divide system currency fairly. | The GM selects recipient actors. Divide each currency amount evenly, rounding down per recipient; convert any remainder successively to available lower denominations and divide again. Record any final indivisible remainder in the quest for adjudication. |
| REQ-028 | Support the selected game systems. | Reward automation supports Dungeons & Dragons 5e, Shadowdark, Pathfinder 2e, and Cosmere RPG using their system-specific actor and currency data. The GM chooses recipients. An unsupported system or actor unable to receive a reward is handled as an award failure. |
| REQ-029 | Preserve a clear reward audit and avoid duplicate payouts. | Record all reward assignments and failures on the quest. If an award fails, notify the GM, record the error for manual adjudication, and leave the quest Completed; successful awards remain recorded. Rewards are awarded only once, even if the state later leaves and re-enters Completed. Reward definitions cannot be edited after first completion. |
| REQ-030 | Let GMs define faction structure. | A GM can add, rename, delete, and drag roles to reorder them. The list order is the only hierarchy; roles have no parent relationships. |
| REQ-031 | Assign organizational membership. | A GM can add and remove Actors as members and assign each member exactly one role in a given faction. Reassigning replaces the old role. The same Actor can hold different roles in different factions. |
| REQ-032 | Reorder roles and reassign members intuitively. | Dragging a role moves it together with its displayed member list. Dragging a member to a different role reassigns it; dragging within its current role has no effect. |
| REQ-033 | Prevent orphaned organizational members. | Before deleting a populated role, the GM chooses one other role for all affected members. If no other role exists, deletion is prohibited. |
| REQ-034 | Keep organization separate from reputation. | Organizational membership has its own section, apart from renown. Adding, removing, or reassigning members does not alter renown tracking or history, and renown operations do not alter organizational membership. |
| REQ-035 | Restrict organizational changes. | Only a GM can manage roles and organizational members. Existing faction-view permissions continue to depend on renown tracking, not organizational membership. |

### Quest form revisions

These requirements apply to both the Quest Manager and the quest page sheet.
The existing giver, observer, reward, permission, and reward-lock requirements
remain in effect. REQ-038 specifies the behavior when a drop would otherwise
violate REQ-019.

| ID | Requirement and rationale | Acceptance criteria |
|---|---|---|
| REQ-036 | Make the giver controls consistent with the document types. | The giver labels are "Actor" and "Faction". A GM assigns the single Actor giver by dropping a resolvable Actor instead of selecting from an Actor dropdown. Dropping another Actor replaces the prior Actor; a control clears the selection. The faction giver remains selectable, and at least one giver remains required. |
| REQ-037 | Separate observers by document type. | Actor and faction observers have separate sections. A GM drops Actors into the Actor section and selects factions from a dropdown of world factions. Dropping the same Actor observer twice leaves one entry. Each observer can be removed, and the saved values remain links to their respective documents. |
| REQ-038 | Resolve Actor giver/observer conflicts during a drop. | Dropping an Actor observer into the giver section removes that Actor from the observer section and assigns it as giver. Dropping the Actor giver into the observer section clears the Actor giver and adds it as an observer. The existing required-giver validation still applies when saving. |
| REQ-039 | Add reward items by dropping documents. | A GM can drop resolvable world Items, compendium Items, and Actor-embedded Items into the Items section without entering a UUID. A new item starts at quantity 1; dropping the same item again increases its existing quantity by 1. Quantities remain editable, and items can be removed. The saved item reference must remain usable by the existing reward-copy workflow. |
| REQ-040 | Reject invalid or unavailable drops explicitly. | A drop of the wrong document type or an unresolvable document leaves the form unchanged and notifies the GM. Rewards cannot be changed by dropping items after first completion. |
| REQ-041 | Make the rewards form compact. | The XP input is at most 8rem wide. Items and Currency labels use the form's normal label size rather than oversized headings. |
| REQ-042 | Provide a D&D currency layout without losing other systems' data. | In a D&D 5e world, display platinum, gold, electrum, silver, and copper as separate icon-and-input controls, similar to the character sheet. Each control edits its own `pp`, `gp`, `ep`, `sp`, or `cp` value. Existing other denominations in that world remain visible and editable separately. In other systems, existing currencies remain visible and editable. Saving or reopening a quest preserves all denominations, and currency edits remain disabled after first completion. |

### Journal organization and related quest navigation

| ID | Requirement and rationale | Acceptance criteria |
|---|---|---|
| REQ-043 | Make selected related quests navigable. | In the Quest Manager and quest sheet, a selected quest's title opens that quest's sheet separately, including before the selection is saved. The current form and unsaved edits remain intact. Removal remains a separate control; existing document permissions and player read-only behavior apply. An unavailable or inaccessible target is not opened and the user is notified. |
| REQ-044 | Organize newly created journals. | The module creates and reuses its own root Journal folders named `Factions` and `Quests`, distinct from any pre-existing same-name folders. New faction and quest journals are created in their corresponding folders without changing quest access permissions. Failure to create or locate a folder is reported to the GM rather than silently placing the journal elsewhere. |
| REQ-045 | Organize existing journals. | On world load, one active GM automatically moves existing faction-only and quest-only journals to the corresponding module-owned folders. Repeated starts or multiple GM clients do not create duplicate module folders or repeat completed moves. Journal and page UUIDs, content, and permissions remain unchanged when moving a whole journal. Non-GM clients do not perform migration. |
| REQ-046 | Split mixed journals without losing module data. | When a journal contains both faction and quest pages, migration moves those pages to separate journals in the matching folders, retaining ordinary pages in the original journal. Delete the original only after a successful split leaves it empty. Preserve page data and journal access, remap module-managed references including quest giver factions, faction observers, and related quests, and prevent deletion hooks from discarding those references during migration. Warn the GM that external links or macros may still refer to the old page UUIDs. If a split or reference update fails, report the error and retain the original pages; retrying must not duplicate documents or lose links. |
| REQ-047 | Open saved journals readably. | Opening a faction or quest journal from the Journal sidebar opens its corresponding module page sheet with saved details visible, rather than a blank or failing journal reader. A journal with ordinary or mixed pages remains accessible without hiding its other pages. The existing document access and GM/player editing restrictions remain in effect. |

#### Test cases and traceability

The existing Vitest setup has no DOM implementation or browser runner. The
Foundry interaction cases below remain manual integration coverage gaps until
they are exercised in Foundry; no automatic migration should be run against a
shared world without confirming the affected documents and protecting data.

| Requirement | Automated test cases | Foundry integration cases |
|---|---|---|
| REQ-043 | `tests/quest-integration.test.mjs`: linked quest resolution and permissions | Select an unsaved link in each form, open it, and verify the original form is unchanged. Remove a link separately. Test unavailable and inaccessible targets and player views. |
| REQ-044 | `tests/quest-integration.test.mjs`: new faction and quest folder assignment; `tests/journal-organization.test.mjs`: same-name folder separation | Create one faction and one quest with and without unrelated same-name folders; verify module-owned folders, parent IDs, permissions, and explicit failure reporting. |
| REQ-045 | `tests/journal-organization.test.mjs`: existing journal moves, repeat runs, and inactive GM | Move pre-existing single-type journals, restart twice, and test two active GMs. Verify UUIDs, permissions, contents, and no duplicates. |
| REQ-046 | `tests/journal-organization.test.mjs`: mixed-journal split, reference remapping, and retry after failure | Split a mixed journal containing both kinds and an ordinary page; verify all quest links and permissions, external-link warning, ordinary-page retention, and empty-original deletion. Inject a failure and retry; confirm originals and references are not lost or duplicated. |
| REQ-047 | Gap: sidebar-opening dispatch and permissions | Open each journal from the sidebar as GM and authorized player; verify saved content and edit restrictions. Check mixed and ordinary journals remain usable and no reader error occurs. |

### Quest participants

These requirements apply to both the Quest Manager and the quest page sheet.
The list is separate from quest givers and observers and does not change the
quest state automatically. The proposed unit-test contract uses
`acceptedActorUuids` for the stored list and `accepted` for the Actor drop kind;
these names may be adapted together with the tests during implementation.

| ID | Requirement and rationale | Acceptance criteria |
|---|---|---|
| REQ-048 | Record who accepted a quest. | The "Quest accepted by" section lists any number of distinct Actors as horizontally wrapping entries. Each editable entry presents the Actor and remove actions as a joined control with a dividing line. A GM adds a resolvable Actor by dropping it, may remove each listed Actor, and duplicate drops leave one entry. A new or existing quest without participant data starts with an empty list. Saving and reopening preserves the list. An unavailable saved Actor remains listed by UUID until explicitly removed. |
| REQ-049 | Restrict participant changes by saved quest state. | Only a GM can change the list. Players who can view the quest see it read-only. When the saved state is Completed, additions and removals are rejected, including attempts through stale forms or direct save calls. Selecting another state in an unsaved form does not unlock it; after a non-Completed state is saved, the list becomes editable again. A quest may have an empty list in any state. |
| REQ-050 | Keep Actor assignments mutually exclusive. | An Actor cannot simultaneously be a giver or Actor observer and an accepted Actor. Dropping an Actor into one of these sections moves it from the other section, preserving existing required-giver validation. If the saved state is Completed, a move that would change the locked participant list is rejected and the GM is notified without changing either section. Invalid or unavailable drops do not change the form and notify the GM. |
| REQ-051 | Include participants when completing a quest. | List changes made while the saved state is not Completed may be saved together with the transition to Completed. If the completion assignment dialog is cancelled, save nothing and discard all unsaved quest-form edits. Existing completion and reward auditing requirements remain in effect. |
| REQ-052 | Suggest participants for rewards without constraining the GM. | The completion assignment dialog preselects accepted Actors who are available in the Actor choices for both XP and currency when those rewards apply. The GM may change recipients freely, including selecting other Actors. Item quantities remain zero until assigned manually; an empty accepted list selects nobody by default. |

#### Participant test cases and traceability

| Requirement | Automated test cases | Foundry integration or manual cases |
|---|---|---|
| REQ-048 | `tests/quest-integration.test.mjs`: participant serialization, legacy empty default | In both forms, drop several Actors, drop a duplicate, remove one, save and reopen; verify unavailable saved Actors remain visible by UUID. |
| REQ-049 | `tests/quest-integration.test.mjs`: saved-state lock and reopening | Verify players see a read-only list. Test completed quests, stale forms, selecting another state without saving, and saving a non-completed state before editing. |
| REQ-050 | `tests/quest-form-controls.test.mjs`: moves between participant, giver and observer sections, locked move rejection and invalid drops | Move an Actor between each pair of giver, Actor observers and accepted Actors; verify giver validation. Repeat with a saved Completed quest and verify locked moves and invalid drops notify without changes. |
| REQ-051 | `tests/quest-integration.test.mjs`: confirmed completion persistence and cancellation in both forms | Modify participants and complete; verify confirmed changes persist. Repeat and cancel; verify nothing is saved and all unsaved form edits are discarded in both forms. |
| REQ-052 | `tests/quest-integration.test.mjs`: completion recipient defaults | Verify XP and currency preselection, manual changes, zero item quantities and empty lists in the Foundry completion dialog. |

### Quest form test cases and traceability

The following in-Foundry integration cases are required for both the manager and
the quest page sheet. They are currently manual coverage gaps; the existing
Vitest setup has neither a DOM implementation nor a browser runner.
`tests/quest-form-controls.test.mjs` exercises Actor and Item drop behavior,
including invalid documents and locked rewards. `tests/quest-integration.test.mjs`
checks observer context, form serialization, all five D&D denominations, and
preservation of additional and non-D&D entries.

| Requirement | Test cases |
|---|---|
| REQ-036 | **REQ-036-INT-01:** Verify both labels and the absence of an Actor dropdown. Drop an Actor, replace it with a different Actor, clear it, and save with a faction giver. Verify saving without either giver is rejected. |
| REQ-037 | **REQ-037-INT-01:** Drop two Actors and a duplicate; verify one entry per Actor. Select and remove faction observers and an Actor observer. Save and reopen; verify all remaining links resolve. |
| REQ-038 | **REQ-038-INT-01:** Move an Actor observer to giver by dropping it, then move it back by dropping it into observers. Verify each transition removes the conflicting assignment, and saving with no giver fails. |
| REQ-039 | **REQ-039-INT-01:** Drop a world, compendium, and Actor-embedded Item; verify quantity 1, duplicate increment, manual quantity edits, removal, and save/reopen. Complete a quest and verify the existing reward-copy workflow resolves the saved item references. |
| REQ-040 | **REQ-040-INT-01:** Drop an Item into either Actor zone, an Actor into the item zone, and an unresolvable document into each zone. Verify a notification and no changes. Verify item drops cannot change completed rewards. |
| REQ-041 | **REQ-041-INT-01:** Measure the XP control at no more than 8rem and compare the Items and Currency label sizes to normal form labels at the default window size and after resizing. |
| REQ-042 | **REQ-042-INT-01:** In D&D 5e, enter distinct amounts in all five icon-labelled controls; save, reopen, and verify values and completion distribution. Edit an additional existing denomination and verify it survives. Repeat in a non-D&D world with its existing currencies. Verify completed rewards cannot be edited. |

### Test design and traceability

Test names reference requirement IDs. The new tests define proposed pure-logic
contracts, rather than asserting a particular Foundry UI implementation:

- `scripts/quest.mjs`: `createQuest`, `setQuestState`, `addObserver`,
  `addQuestRelation`, `removeQuestRelation`, `deleteQuest`, and
  `questsForFaction`. Relationship functions operate on arrays of quest objects.
- `scripts/quest-rewards.mjs`: `splitCurrency`, `completeQuest`, and `updateRewards`.
  `completeQuest` accepts injected reward-application callbacks so error and
  duplicate-award behavior can be tested without Foundry documents.
- `scripts/faction-organization.mjs`: `addRole`, `renameRole`, `moveRole`,
  `deleteRole`, `assignMember`, `removeMember`, and `moveMember`.

The Foundry interaction cases below remain integration/manual coverage gaps;
passing pure-logic tests alone does not establish those behaviors.

| Requirement | Automated test cases | Additional Foundry integration or manual cases |
|---|---|---|
| REQ-015 | — | Verify sidebar button position, manager access, and quest CRUD as GM and player. |
| REQ-016 | `tests/quest.test.mjs`: required fields, giver combinations, default icon | Create and edit through quest forms; verify Actor/faction links and icon picker. |
| REQ-017 | `tests/quest.test.mjs`: default, allowed transitions, permission | Check all states and player controls in both manager and sheet. |
| REQ-018 | `tests/quest.test.mjs`: combined/empty rewards and optional consequence | Verify controls and no consequence automation on failure. |
| REQ-019 | `tests/quest.test.mjs`: observer links and giver exclusion | Open Actor and faction observer links. |
| REQ-020 | `tests/quest.test.mjs`: bidirectional add/remove and self-link rejection; `tests/quest-form-controls.test.mjs`: autocomplete matching; `tests/quest-integration.test.mjs`: form serialization and duplicate titles | In both quest forms, search with an empty query, mixed case, a substring, no match and duplicate titles; select and remove links, save and reopen, and verify reciprocal links and no automatic progression. Verify player links remain read-only. |
| REQ-021 | `tests/quest.test.mjs`: delete relationship cleanup | Delete a linked quest in Foundry and verify surviving quests. |
| REQ-022 | `tests/quest.test.mjs`: giver/observer faction selection | Verify faction listing and player read-only links, including document permissions. |
| REQ-023 | — | Create from a faction with each association choice; validate missing giver and hide button for players. |
| REQ-024 | `tests/quest-rewards.test.mjs`: cancel and empty rewards | Verify popup, required recipient assignment, cancel, and actual document persistence. |
| REQ-025 | `tests/quest-rewards.test.mjs`: full XP per selected actor | Verify XP updates against each supported system's actor schema. |
| REQ-026 | `tests/quest-rewards.test.mjs`: split copies and leave copies unassigned | Verify copied embedded items and quantities in each supported system. |
| REQ-027 | `tests/quest-rewards.test.mjs`: conversion, final remainder | Verify system denomination definitions and persistent actor balances in all four systems. |
| REQ-028 | — | Exercise XP, items, and every supported currency on each of the four systems; test unsupported systems and incompatible actors as failures. |
| REQ-029 | `tests/quest-rewards.test.mjs`: failures, audit, repeat completion, reward lock | Verify notification, durable notes and updates, including failure after a partial award. |
| REQ-030 | `tests/faction-organization.test.mjs`: role create/rename/reorder | Verify GM controls and role drag-and-drop. |
| REQ-031 | `tests/faction-organization.test.mjs`: assign/reassign/remove and independent factions | Verify Actor drop, selection, and persistence. |
| REQ-032 | `tests/faction-organization.test.mjs`: role move and member reassignment/no-op | Verify drag behavior and member list placement. |
| REQ-033 | `tests/faction-organization.test.mjs`: reassignment and last-role deletion | Verify reassignment prompt and blocked deletion. |
| REQ-034 | `tests/faction-organization.test.mjs`: renown and membership independence | Verify separate sections and preservation of existing data/history. |
| REQ-035 | `tests/faction-organization.test.mjs`: GM-only management and renown-based visibility | Verify permissions on faction sheets and manager for GM and player. |

Integration gaps: REQ-015, REQ-023, and REQ-028 currently have no automated
test. All other requirements also have the Foundry-specific gaps listed above.
Do not treat the proposed unit contracts as a substitute for system integration.

### Integration test cases

- **REQ-015-INT-01:** As GM, open Quests from the Journal sidebar beside Factions;
  create, edit, and delete a quest. Verify a player cannot access the manager.
- **REQ-023-INT-01:** From a faction window, create quests with the faction as
  giver and as observer. Verify a quest without a giver cannot be saved and a
  player does not see a Create Quest button.
- **REQ-028-INT-01:** In each of D&D 5e, Shadowdark, Pathfinder 2e, and Cosmere
  RPG, complete a quest with XP, copied items, and each available currency;
  verify the selected Actors' actual document values and currency conversions.
- **REQ-028-INT-02:** In an unsupported system, or with an Actor unable to
  receive a reward, confirm completion, GM error notification, and a persistent
  failure entry identifying the reward and recipient.
- **REQ-029-INT-01:** Interrupt the client during reward distribution after an
  Actor update. On reopening the quest, confirm that no reward is automatically
  granted a second time and that an unfinished assignment is visible for manual
  adjudication. Also test concurrent completion attempts from two GM clients.
