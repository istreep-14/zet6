# Tip Pool

A phone-first web app for splitting a cash tip pool at the end of a shift. Enter who worked and when, enter the cash, and it tells each person exactly which bills go in their envelope.

No server, no login, no build step. Add it to your iPhone home screen and it runs like an app; everything is saved on the device.

---

## Using it

**Home** is the first tab — every session opens on it — and it's only for reading: nothing on it changes anything. Until the shift is complete it shows the three close-out steps (who worked → the tips → who gets what), each one tap away. **Staff** and **Tips** are only for entering things; they end with a **Next** button. **Shift** is this session's setup: night or day, the date, and the tip pools.

Each tab's header shows its name and the numbers that matter at a glance (Home: paid out, people, $/hour; Staff: people, hours, open – close; Tips: the total), with the tab's views underneath — tap one, or swipe sideways on the page to move between them. The header's title and the tab bar tuck away as you scroll down and come back as you scroll up. A swipe on a wide table scrolls the table first, then moves to the next view once it's at the end. Tabs change only by tapping them.

Tap the round date in the top-left corner — or swipe right from a tab's first view — for the **menu**: this session at a glance, the other sessions to switch to, copy / export / import, **Settings**, and the display size and light / dark at the bottom.

| Tab | Views |
|---|---|
| **Home** | **Pay** — each person: name, when they worked, hours, take-home; the chump; the total (hours, rate, paid out). **Shift** — everyone's shift on one timeline. **Bills** — each envelope, bill by bill, and the small bills you need. **Split** — how it was worked out: hours × rate, the rounding, each pool. Tap a person for their page (swipe right or Back to return). |
| **Staff** | **People** — one list: each person's name, **In**, **Out** and hours. The last row is **Add a name**: type a name and press Return, then the next — or paste a whole list. Saved names show as chips under it; one tap adds. Tap a time box to type it on the keypad (`5`, `530`, `1045`; a / p for any time of day) — **Next** walks through everyone's times in order — or hold it for the wheel. Tap a name for their drawer: name, role, a **break**, closer, remove. **Shift** — the shift's **Open** and **Close** (blank times follow them; closers end at the close), times per role, and the close-time what-if. |
| **Tips** | One view per pile of cash — each pool ("Night"), and each **part** of a pool when it's counted more than once in a night ("Part 1", "Part 2") — then **Drawer**. Count the bills with the −/+ steppers; **pull the page down** to type a total instead (and pull again to go back). **New part** saves this count and starts another. **Drawer** — if the drawer can't make exact change, the fewest swaps with **Apply**; the best bills for the uncounted cash; envelopes already made, stacks for a manager, tidying the drawer. |
| **Shift** | **Shift** — **Night** (one pool for the whole shift, the bar's) or **Day** (two pools: **Day**, bar + servers until the servers are out, then **Mid**, the bar's); servers & support; the session's name; a calendar for the date; export, delete. **Pools** — the shift's tip pools; tap one for its page: name, preset (**Night · Day · Mid · Party**), its window, who shares it, the support tip-out, the register **over / short**, remove. **Add a party** for a private event's tips over its own window. Closer bonus & chump. |

**Settings** (from the menu): every saved session (**New session**, tap to switch, Edit to rename or delete), theme, display size, 24-hour time, **Morning starts at** (a bare `7` reads as 7am if mornings start at 7 or earlier, else 7pm; a / p always overrides), copy as text, import / export.

After you change a time, a message at the bottom says what changed, with **Undo**.

### Staff

- **Add people** — on People, type in **Add a name** and press Return after each; a comma works too, or paste a list (one per line or comma-separated). With roles on, the chip beside the field says which role they come in as — tap it to change. Names are remembered on this device; saved ones not on shift are chips — tap to add, **Edit** to forget one.
- **Times** — tap the first In, type it, press **Next**, and keep going: it walks In → Out → the next person. **Default** puts a time back to the shift's.
- **Tap a name** for their drawer: name, role, a **break** (15m – 1h 30m off their hours; set when it began, and with several pools it comes off the pool it fell in — otherwise off each pool in proportion), make them a **closer**, or **remove** them.
- Lighter times follow the default; the **Close** time (Shift) moves every closer with it.

### How the split works

1. Each person's share = their hours × (total tips ÷ total hours).
2. Shares round down to whole dollars.
3. The leftover dollars go to the closers (or however you set them in **Bonus**).
4. Anything that still can't be split evenly stays in the drawer as the "chump".

With **Support** sharing a pool, support staff get a tip-out first (10% of the pool by default, or a set $/hour, for the hours they worked); everyone else splits the rest by hours.

With **Several pools** turned on (Settings), tips can be split by time window — e.g. a lunch pool and a dinner pool, each shared only by the people working then.

### Bills

The app works out which physical bills each person gets, keeping $100s/$50s proportional and spreading small bills evenly. If the drawer can't make exact change, **Pay › Bills** shows the fewest swaps that fix it (e.g. "Break 1 × $20 into 2 × $10"), and **Apply** updates the cash counts.

### Simple vs detailed

By default the app is in simple mode: one staff list and one tip pool. In Settings you can turn on **Servers & support** (separate bartender / server / support lists with their own default times) and **Several pools**.

---

## Saving

- Everything auto-saves on the device (`localStorage`).
- Every shift is saved as its own **session**; **New session** starts a fresh one and keeps the old ones in Settings → All sessions. Settings and saved names are shared by all sessions.
- **Export** (Settings) downloads the session as a dated `.json` file; **Import** adds a file back as a new session.

---

## Running it locally

ES modules need to be served over http (opening `index.html` as a file won't work):

```bash
npx serve .
# or
python3 -m http.server
```

Then open the URL it prints. Add `?pwa` to the URL to preview the home-screen layout in a desktop browser.

## Tests

```bash
npm test                    # runs every tests/*.test.js
node tests/shares.test.js   # or one file on its own
```

Plain Node `assert` scripts — no framework, nothing to install.

---

## For developers

`CLAUDE.md` is the technical guide: architecture, the state shape, the time model, the split and bill-distribution algorithms, and notes on the iOS home-screen layout. Code lives in `src/` (pure logic modules plus `src/render/` for the DOM) and one stylesheet, `css/app.css`.
