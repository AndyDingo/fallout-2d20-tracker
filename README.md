# Fallout 2d20 Tracker (SillyTavern Extension)

A lightweight, third-party SillyTavern extension that tracks and displays **Fallout: The Roleplaying Game (2d20)** character stats:

- **S.P.E.C.I.A.L.** attributes (STR, PER, END, CHA, INT, AGI, LCK)
- **HP & Radiation Cap** (auto-calculates `END + LCK + (Level - 1)` and lowers effective Max HP by current Radiation damage)
- **Party Action Points (AP)** pool (`0–6` interactive pips)
- **Luck Points** (`0–LCK`) & Caps
- **Live Prompt Injection** via `setExtensionPrompt` so `gemma4:26b` always knows exact stats
- **Gemma 4-Safe GM Auto-Parser**: Strips `<|channel>thought...<channel|>` and `<think>...</think>` reasoning blocks before reading tags like `[HP: -3 | AP: +1 | Rads: +2]`

## Installation

1. Extract the `fallout-2d20-tracker` folder into your SillyTavern directory:
   ```
   SillyTavern/public/scripts/extensions/third-party/fallout-2d20-tracker/
   ```
2. Ensure `manifest.json`, `index.js`, `settings.html`, and `style.css` sit directly inside that folder.
3. Restart or hard-refresh SillyTavern (`Ctrl+Shift+R`), then open **Extensions -> Fallout 2d20 Tracker** to configure depth, theme, and auto-parsing.

## Slash Commands

- `/f2d20 status` — Print current character sheet summary
- `/f2d20 hp -3` or `/f2d20 hp 10` — Adjust or set HP
- `/f2d20 ap +1` — Add or spend Party AP
- `/f2d20 rads +2` — Add Radiation damage (reduces effective Max HP)
- `/f2d20 luck -1` — Spend or restore Luck Points
- `/f2d20 special END 7` — Update a S.P.E.C.I.A.L. attribute
- `/f2d20 rest` — Restore HP to effective max and refresh Luck Points
