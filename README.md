# Tip Pool

A phone-first web app for splitting a cash tip pool at the end of a shift. Enter who worked and when, enter the cash, and it tells each person exactly which bills go in their envelope.

No server, no login, no build step. Add it to your iPhone home screen and it runs like an app; everything is saved on the device.

---

## Using it

**Summary** is home — every session opens on it. Until the shift is complete it shows the three close-out steps (who worked → the tips → who gets what), each one tap away; Staff and Tips end with a **Next** button.

| Tab | What it's for |
|---|---|
| **Summary** | Who gets what: tips, hours, rate and the small bills you need, then each person on one line — name, In and Out (tap a time to type it on the keypad, or hold it for the wheel), hours and tips — and the total (hold it to adjust the tips). Other views (List, Pools — every person's hours and tips in each pool, Bills — each envelope, Math — hours × rate and the rounding) are in the page's drawer. |
| **Staff** | Who worked, as a list of cards: each person's name, In → Out, hours, and a timeline of their shift against the night (the red line is the close). **Add names**: type a name and Return, or paste a whole list — they go in in that order; saved names are chips, one tap adds. **Select** (on the bar above the tabs) several people and set their times from hour chips — **Each in turn** gives the next one each time you tap (4, 5, 6, 6 down the list), **Same for all** sets everyone. **Times** turns every time into a box: tap to type it on the keypad (`5`, `530`, `1045`; a / p for any time of day; Next moves along), or hold for the wheel. **Close** sets the shift's close: closers, and anyone without their own Out, end then. Tap a person for their drawer: times, a **break**, closer, remove. |
| **Tips** | The shift type and the cash. **Night shift** is one pool. **Day shift** is two: **Day** (bar + servers, from open until the servers are out) and **Mid** (bar only, from then until the bar is out) — the hand-over follows when the servers actually leave. **+ Party** adds a private party's tips: set its window, and they're shared by bar and servers by the hours they worked inside it (support gets a tip-out). For each pool, type the amount, or turn on **Count bills** for the bills you can see at a glance; **Over / short** re-splits if the register is off. |
| **Payout** | The bills: each person's envelope, bill by bill. If the drawer can't make exact change, a fix card shows the fewest swaps and **Apply** updates the cash count. **How the split works** explains the maths. |

The tabs at the bottom go to Summary · Staff · Tips · Payout, and a sideways swipe on the page steps through them too; swiping right on Summary opens the sessions panel, swiping left on Payout opens this shift's panel. The bar above the tabs holds the page's own actions (Summary: close time, chump, copy · Staff: Add, Times, Select, Close · Tips: count bills, over / short, party · Payout: stacks, tidy); **swipe up** from it or the tabs — or tap the page's tab again, or ⌃ — for that page's drawer: everything else it can do, what it shows, and every other page and tool. While you turn a wheel it shows what the change does, then Undo / Apply.

The menu button — or a swipe in from the left edge — opens the **sessions panel**: every saved shift (tap one to switch, Edit to rename or delete), **New session**, and app settings (theme Auto / Light / Dark, display size Small / Medium / Large, servers & support, multiple pools, 24-hour time, import). The date in the header — or a swipe in from the right edge — opens **this shift's panel**: name, shift type (Night / Day), a calendar to set the date, default shift times (keypad or drag; remembered separately for day and night shifts, and a new session starts from them), and in app settings **Morning starts at** — a bare `7` reads as 7am if mornings start at 7 or earlier, else 7pm (a / p always overrides), closer bonus, close-time what-if, export and delete.

### Staff

- **Add names** — type them one after another (Return after each), or paste a list (one per line or comma-separated). With roles on, pick which role they come in as. Names are remembered on this device; saved ones not on shift show as chips — tap to add, **Edit saved** to forget one.
- **Select** → pick people → tap an In or Out hour. **Each in turn** walks down the picked people (the next one is marked), **Same for all** sets them all; **:30** shifts the chips to the half hour, **Default** / **Close** put a time back to the default, **Undo** takes back the last tap.
- **Tap a person** for their drawer: In and Out (tap for the wheel), a **break** (15m – 1h 30m off their hours; set when it began, and with several pools it comes off the pool it fell in — otherwise off each pool in proportion), make them a **closer**, or **remove** them.
- Faint times follow the default; the **Close** time moves every closer with it.

### How the split works

1. Each person's share = their hours × (total tips ÷ total hours).
2. Shares round down to whole dollars.
3. The leftover dollars go to the closers (or however you set them in **Bonus**).
4. Anything that still can't be split evenly stays in the drawer as the "chump".

With **Support** sharing a pool, support staff get a tip-out first (10% of the pool by default, or a set $/hour, for the hours they worked); everyone else splits the rest by hours.

With **Multiple pools** turned on (sessions panel), tips can be split by time window — e.g. a lunch pool and a dinner pool, each shared only by the people working then.

### Bills

The app works out which physical bills each person gets, keeping $100s/$50s proportional and spreading small bills evenly. If the drawer can't make exact change, the Payout tab shows the fewest swaps that fix it (e.g. "Break 1 × $20 into 2 × $10"), and **Apply** updates the cash counts.

### Simple vs detailed

By default the app is in simple mode: one staff list and one tip pool. In the sessions panel you can turn on **Servers & support** (separate bartender / server / support lists with their own default times) and **Multiple pools**.

---

## Saving

- Everything auto-saves on the device (`localStorage`).
- Every shift is saved as its own **session**; **New session** starts a fresh one and keeps the old ones in the sessions panel. Settings and saved names are shared by all sessions.
- **Export JSON** in this shift's panel downloads the session as a dated `.json` file; **Import** in the sessions panel adds a file back as a new session.

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
