# Tip Pool

A phone-first web app for splitting a cash tip pool at the end of a shift. Enter who worked and when, enter the cash, and it tells each person exactly which bills go in their envelope.

No server, no login, no build step. Add it to your iPhone home screen and it runs like an app; everything is saved on the device.

---

## Using it

**Home** is the first tab — every session opens on it — and it's only for reading: nothing on it changes anything. Until the shift is complete it shows the three close-out steps (who worked → the tips → who gets what), each one tap away. **Staff** and **Tips** are only for entering things; they end with a **Next** button.

Every tab has its own views along the top — tap one, or swipe sideways on the page to move between them. Tabs change only by tapping them.

| Tab | Views |
|---|---|
| **Home** | **Pay** — each person: name, when they worked, hours, take-home; the chump; the total (hours, rate, paid out). **Shift** — everyone's shift on one timeline. **Bills** — each envelope, bill by bill, and the small bills you need. **Split** — how it was worked out: hours × rate, the rounding, each pool. Tap a person for their page (swipe right or Back to return). |
| **Staff** | **People** — a table you edit right there: each person's **In** and **Out** are boxes — tap to type on the keypad (`5`, `530`, `1045`; a / p for any time of day; Next moves along), hold for the wheel — and their hours. Tap a name for their drawer: times, a **break**, closer, remove. **Add** — type names (Return after each) or paste a list; saved names are chips. **Bulk** — pick people and set their times from hour chips: **Each in turn** (4, 5, 6, 6 down the list) or **Same for all**; closers, remove. **Defaults** — the shift's **Open** and **Close** (blank times follow them; closers end at the close), times per role, and the close-time what-if. |
| **Tips** | **Cash** — type the total, or count the bills; checkpoints; **Register over / short**. **Pools** — **Night shift** is one pool; **Day shift** is two: **Day** (bar + servers, until the servers are out) and **Mid** (bar only, after). **+ Party** adds a private party's tips over its own window. Who shares each pool, the support tip-out, the closer bonus & chump. **Drawer** — if the drawer can't make exact change, the fewest swaps with **Apply**; the best bills for the uncounted cash; envelopes already made, stacks for a manager, tidying the drawer. |
| **Settings** | **Shift** — this session's name, a calendar for the date, export, delete. **Sessions** — **New session** and every saved shift (tap to switch; Edit to rename or delete). **App** — theme, display size, servers & support, several pools, 24-hour time, **Morning starts at** (a bare `7` reads as 7am if mornings start at 7 or earlier, else 7pm; a / p always overrides), copy as text, import / export. |

After you change a time, a message at the bottom says what changed, with **Undo**.

### Staff

- **Add names** — type them one after another (Return after each), or paste a list (one per line or comma-separated). With roles on, pick which role they come in as. Names are remembered on this device; saved ones not on shift show as chips — tap to add, **Edit saved** to forget one.
- **Bulk** → pick people → tap an In or Out hour. **Each in turn** walks down the picked people (the next one is marked), **Same for all** sets them all; **:30** shifts the chips to the half hour, **Default** / **Close** put a time back to the default, **Undo** takes back the last tap.
- **Tap a name** for their drawer: In and Out (tap to type, hold for the wheel), a **break** (15m – 1h 30m off their hours; set when it began, and with several pools it comes off the pool it fell in — otherwise off each pool in proportion), make them a **closer**, or **remove** them.
- Lighter times follow the default; the **Close** time (Defaults) moves every closer with it.

### How the split works

1. Each person's share = their hours × (total tips ÷ total hours).
2. Shares round down to whole dollars.
3. The leftover dollars go to the closers (or however you set them in **Bonus**).
4. Anything that still can't be split evenly stays in the drawer as the "chump".

With **Support** sharing a pool, support staff get a tip-out first (10% of the pool by default, or a set $/hour, for the hours they worked); everyone else splits the rest by hours.

With **Several pools** turned on (Settings), tips can be split by time window — e.g. a lunch pool and a dinner pool, each shared only by the people working then.

### Bills

The app works out which physical bills each person gets, keeping $100s/$50s proportional and spreading small bills evenly. If the drawer can't make exact change, Tips › Drawer shows the fewest swaps that fix it (e.g. "Break 1 × $20 into 2 × $10"), and **Apply** updates the cash counts.

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
