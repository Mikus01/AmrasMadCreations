# Amras Mad Inventions

A Foundry VTT v14 module.

## Faction Renown
- Click **Factions** in the Journal sidebar header to open the Faction Manager, or open a faction page (sub-type "Faction") directly.
- GMs: set name/logo/description, manage ordered roles and their Actor members, add/toggle/remove goals, drop Actors to track them, and set renown (-100..100; levels Infamous → Paragon). Membership and renown tracking are independent. Level changes post a chat message and every change is logged in the history.
- Players see factions that track an Actor they own (they need at least Observer permission on the containing Journal Entry for Foundry to send it to them). Players cannot edit.
- Run unit tests of the pure logic with `npm test`.

## Quest tracking
- The Quests button in the Journal sidebar opens the GM's quest manager. Quests
  have a giver, optional observers, related quests, rewards, a consequence, and
  a state. Factions list quests where they are a giver or observer.
- Search by name in **Related quests** to add links; remove selected links with
  their remove button. Select a linked quest's title to open its sheet.
- Drop Actors into the giver or Actor observers section and Items into rewards;
  duplicate item drops increase their quantity. D&D 5e currency has individual
  denomination inputs; other currency entries remain editable.
- On completion, the GM assigns rewards to Actors. XP is awarded in full to
  each selected recipient; items may be divided between recipients; currency
  is divided evenly with remainders converted to lower denominations where
  available. Failed awards and indivisible remainders are recorded on the quest
  for manual adjudication. Rewards are not automatically awarded twice.
- D&D 5e, Shadowdark, and Pathfinder 2e have reward adapters; these require
  in-world verification for the installed system version. Cosmere RPG XP and
  currency awards are not yet automated and are recorded as failures for
  manual adjudication. Unsupported system or Actor reward fields also fail
  explicitly rather than modifying unknown data.
- Complete each quest from only one GM client at a time. Foundry cannot update
  quest and Actor documents atomically: a pending audit entry after interruption
  may have been awarded and must be checked manually, not retried blindly.
- Faction-linked quest journals grant read-only access to users who can observe
  the faction and own a tracked Actor. A GM must be connected to synchronize
  access when faction involvement or Actor ownership changes.

## Journal organization
- An active GM automatically organizes faction and quest journals into
  module-owned **Factions** and **Quests** Journal folders on world load.
- Mixed faction/quest journals are split; module references are updated, but
  external links and macros may still contain old page UUIDs. Back up the world
  before enabling this version and check external references after migration.

## Structure
- `module.json` – manifest
- `scripts/` – ES modules (`main.mjs` entry point, `constants.mjs`, `settings.mjs`)
- `lang/` – localization files
- `styles/` – CSS (wrapped in a cascade layer)

## Development
Place or symlink this folder into your Foundry `Data/modules/` directory as `amras-mad-inventions`, then enable it in a world.
