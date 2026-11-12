# Test plan

For an agent (or person) picking this project up. There are no automated tests: everything here is run by hand
or from the browser console. Each check says what to do and what a pass looks like.

Do section 1 after any change. Then do the sections for the areas you touched. Before a check-in, do all of them.

## 0. Setup and traps

**Serve the folder** on port 8765 (the preview config in `.claude/launch.json` does this) and open
`http://localhost:8765/`.

**The console handle.** `window.carillon` gives `bells, play, goTo, camera, controls, atlas, site, setMode,
renderer, composer`. Useful calls:

```js
carillon.goTo(3, true)            // jump to tour stop 4 with no flight
carillon.setMode('atlas')         // 'tower' | 'atlas' | 'site'
carillon.atlas.select(i)          // open carillon i's card; -1 goes home
carillon.atlas.marks.findIndex(m => m.c.name === 'Dom Tower')
```

**Traps that cost time before:**

- **Stale scripts.** The simple server sends no cache headers, so the browser may run an old file after an edit.
  Force it: `for (const f of ['index.html','main.js','atlas.js','site.js','carillons.js','world.js']) await
  fetch(f, {cache: 'reload'}); location.reload()`.
- **A hidden browser pane draws no frames.** `requestAnimationFrame` stops, so nothing that animates will advance:
  flights never finish, tunes do not progress, the globe does not turn. Either make the pane visible, or step the
  clock yourself: `let t = performance.now(); for (let k = 0; k < 400; k++) { t += 16; carillon.atlas.update(t); }`.
  Screenshots may also lag one frame; take a second one.
- **Timers are slowed in a hidden pane** to about one a second, so pointer moves spaced with `setTimeout` do not
  look like a flick. Dispatch them in one go.
- **Reduced motion.** If the device asks for less motion, flights are instant and nothing circles, and the Motion
  button starts at "off". This machine reports reduced motion. Click Motion to test the animated paths, and clear
  your change afterwards: `localStorage.removeItem('carillon-motion')`.
- **Width.** Below 820 px the layout switches to the narrow one. Test desktop at 1280 × 800 and phone at 375 × 812,
  and reset the viewport when done.
- **Synthetic pointer events** on the on-screen batons work, but real pointer capture is not exercised by them.
- **Audio cannot be heard by an agent.** Check that a strike happened (`carillon.bells[i].hitAt` changes) and say
  plainly that the sound itself was not judged.
- **`file://` in the embedded pane is a static snapshot** and runs no scripts. Use the headless checks in section 1.

## 1. Smoke test (always)

1. **Loads from disk with no network.** Pass: prints `Stop 1 of 8`.

   ```bash
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --user-data-dir=/tmp/carillon-check --host-resolver-rules="MAP * ~NOTFOUND" --virtual-time-budget=12000 --dump-dom "file://$PWD/index.html" | grep -o 'Stop 1 of 8'
   ```

2. **Loads from disk in Firefox** (the browser the first bug was reported in). Pass: the screenshot shows the
   guide panel with "Stop 1 of 8" and the baton keyboard. The 3D canvas is blank in a headless screenshot; that is
   expected.

   ```bash
   /Applications/Firefox.app/Contents/MacOS/firefox --headless --no-remote --profile /tmp/carillon-ff --window-size 1280,800 --screenshot /tmp/carillon-ff.png "file://$PWD/index.html"
   ```

3. **Only local requests when served.** After loading and opening the globe, pass:
   `[...new Set(performance.getEntriesByType('resource').map(e => new URL(e.name).host))]` is `["localhost:8765"]`.
4. **No errors.** Collect them for the whole session:
   `window.__errs = []; addEventListener('error', e => __errs.push(e.message))`. Pass: still empty at the end.
5. **Syntax.** `node --check main.js && node --check atlas.js && node --check site.js`.

## 2. The tower tour

| Check | How | Pass |
|---|---|---|
| Eight stops | Click Next through the tour | Titles change; dots follow; at stop 8 the button reads "Start again" and returns to stop 1 |
| Reset view | At each stop, move the camera, press Reset view | Returns to the stop's view. Screenshot stops 2, 3 and 4: stairwell from above; batons and pedals visible beside the player; crank rack and lowest bells with three labels |
| Playing | Type `z`, click a baton, click a bell in the belfry | `carillon.bells[i].hitAt` changes; the chip shows the bell's size |
| Pedals | Shift + `z` | Same bell, struck harder (`vel` 1) |
| Cranks | At stop 4, `carillon.play(0)` | The bourdon's wire glows; `carillon.bells[0].cranks.length === 3` |
| See inside | Press it at stop 1 | Camera at about `[11.5, 38.6, 15]`; button reads "Show the walls"; pressing again returns to the stop view |
| Partials | Stop 7: each partial button, and the major-third box | Frequencies shown; the tierce value changes with the box |

## 3. Tunes

| Check | How | Pass |
|---|---|---|
| Menu | "Play a tune" on any stop | Five tunes; four have Play along |
| Listen | Listen to Ode to Joy | `.fall` elements appear in the lane; the button reads "Stop the tune" |
| Play along | Play along, then strike the baton with class `want` each time one appears | The lane advances only on the right note; a wrong note names the bell it is waiting for |
| Finish | Play a short tune to the end with frames running | The lane clears and the note line gives the count of notes and slips. **This has never been watched end to end; do it with a visible pane** |
| Echo game | Stop 8, Echo game | A phrase plays; echoing it adds a note; a wrong note ends the game with a message |

## 4. The globe

| Check | How | Pass |
|---|---|---|
| Count | `carillon.atlas.marks.length` | About 683; no duplicates: `marks.map(m => m.c.name + '|' + m.c.city)` has no repeats |
| Countries | Look at Europe | Borders drawn; carillon countries tinted; towers match their country's colour |
| Legend | Click Belgium in the legend | List shows only Belgium; globe zooms to it; clicking again clears |
| Search | Type `chicago` | A few matches; globe turns to them |
| Card | Click a list row | Card with photo, spec rows, and a note if placed only at its town |
| Back / Next | On a card | Walks the filtered list in order |
| Reset view | Turn the globe away, press Reset view | Camera back at latitude 38, distance 33, north up. With a card open it resets the drone and keeps the card |
| Flick | Drag quickly and release | The globe keeps turning and slows; a held release does not spin |
| History | History tab; drag the slider to 1644; press a story | Count and story text change; the globe shows only earlier carillons |
| Quiz | Start, answer eight | Feedback after each; a score out of 8 at the end |
| Link state | Set a filter and open a card, copy the address, load it fresh | Same filter and card |

## 5. Map close-ups

| Check | How | Pass |
|---|---|---|
| All 30 load | For each featured carillon, `await carillon.site.load(mark.c)` | Returns `kind` of `parts`, `height`, `outline` or `standin`; never throws; none is `none` |
| Westerkerk | Load it | `kind: 'parts'`, height about 82 |
| Framing | Open Dom Tower, Riverside Church and Kirk in the Hills | The highlighted tower or building is in view, not hidden or filling the screen |

## 6. Photos and recordings (needs a connection)

| Check | How | Pass |
|---|---|---|
| Photo | Open a featured card | Photo with a credit line; clicking it opens the large view; Escape closes it |
| Recordings | Tick "Real recording"; for each of the eight, press "Hear the real carillon" | An audio player appears with a duration and a credit. Mute it while testing |
| Offline | Block the network and open a card | No photo, no error; the recording button says it could not load |

## 7. Safety of data shown as HTML

Text from `world.js` comes from Wikipedia and must never run as markup.

```js
const evil = '<img src=x onerror=window.__pwn=1>&"\'';
const m = carillon.atlas.marks.find(x => !x.c.featured && x.c.bells > 40);
Object.assign(m.c, { name: evil, city: evil, country: evil, maker: evil, since: evil });
```

Then redraw the list, open that card, and run a quiz round. Also load
`#view=globe&q=%22%3E%3Cimg%20src%3Dx%20onerror%3Dwindow.__pwn%3D1%3E`.

Pass: `window.__pwn` is undefined, `document.querySelectorAll('#body img[src=x]').length` is 0, and the text
appears literally. Any new place that writes data into `innerHTML` must use `esc()`.

## 8. Accessibility

Use the keyboard only for these.

| Check | How | Pass |
|---|---|---|
| Focus is visible | Tab through the page | Every stop shows a white outline, including the 3D scene and the batons |
| Scene | Focus the canvas; press arrows, `+`, `-` | The view turns and zooms in all three modes; the tour stop does not change |
| Scene description | Read `canvas.getAttribute('aria-label')` at a stop, on the globe, on a card, in a close-up | A sentence describing what is shown, different in each |
| Batons | Tab to the keyboard; Right, Down, Enter | Focus moves C4 → C♯4 → C♯4 pedal; Enter strikes it |
| Typing toggle | Press "Typing plays bells"; type `z` | Off: no strike. On: strike. The choice survives a reload |
| Announcements | Change stop; open a card | `#announce` text reads "Stop n of 8: title" or the carillon's name, town, country and bells |
| Focus after redraw | Press a tab, a legend chip, a quiz answer, a list row, "All carillons" | Focus stays on the same control, or moves to Next (quiz), the heading (new card), or the row you came from (back to the list). It never drops to the top of the page |
| Photo dialog | Enter on the photo; Tab; Escape | Focus goes to Close, cycles inside the dialog, and returns to the photo |
| Globe labels | With a card open, Tab to a neighbour label and press Enter | That carillon opens |
| New-tab links | Inspect any outside link in the panel | Contains hidden text "(opens in a new tab)" |
| Reduced motion | Motion: off | No flights, no circling; flicking still works |

Not covered, and worth doing with real tools: a screen reader pass (VoiceOver), an automated audit (axe or
Lighthouse), and colour contrast of text over the 3D scene.

## 9. Phone layout

Emulate an iPhone 16: 393 × 760 upright (the space left by Safari's bars) and 852 × 393 on its side.

Upright, the app is laid out like a phone app: a tab bar along the bottom (Tour, Play, Globe), the guide as a
sheet that pulls up from the bottom, the scene above it, and scene controls in the top right corner.

| Check | How | Pass |
|---|---|---|
| Tabs | Tap Tour, Play, Globe | Tour: sheet with the stop's text. Play: batons along the bottom, "Play a tune" top left, no sheet. Globe: sheet with the atlas. The current tab is bronze |
| Tabs follow the app | From a tour stop, press a "visit" link; start a play-along from stop 8; start the Echo game | The tab bar moves to Globe, Play, Play |
| Sheet by tap | Tap the handle | Half ↔ peek (peek shows the title and Back / Next only) |
| Sheet by drag | Drag the handle up, then down | Snaps to full, half or peek; the scene re-centres in the space above |
| Sheet by itself | Tap a tower while the sheet is at peek; open a 3D close-up | The card rises to half; the close-up drops the sheet to peek |
| Top controls | Look at the top right | See inside (tower only), Reset view, ⋯. The ⋯ box holds Copy link, Motion and Sound |
| Batons | Play tab | Each natural baton at least 30 px wide; the strip scrolls sideways and starts at C4 |
| Play along | Start one | Falling notes sit inside the baton strip with note names; the wanted baton scrolls into view; a status line sits just above the strip |
| Labels | Stop 3 and a carillon card | Labels near the right edge open leftwards; none cut off; at most five on the globe; none over the sheet |
| Fit | Globe tab; a 3D close-up | The whole globe fits the width; the highlighted tower is not cropped |
| On its side | 852 × 393 | Desktop arrangement in miniature: guide on the left with a fold arrow, batons below, ☰-style ⋯ menu in the top right |
| Live resize | Load at 1280 × 800, then resize to 393 × 760 **without reloading**, and back | The layout switches both ways; no leftover menus; desktop shows no tab bar, no ⋯ and no handle |

Not possible in emulation: real touch (drag, pinch, flick), Safari's moving toolbars, the notch and home bar
insets, and sound with the ring switch set to silent.

**Stale code on a real device.** A phone that has visited before may hold old files. `index.html` names every
script with a fingerprint (`main.js?v=…`), so a fresh page always gets matching code, but GitHub Pages lets
browsers keep the page itself for up to ten minutes. If a new control "does nothing", reload after a few minutes
before debugging. Run `node tools/stamp.mjs` before each commit that changes a script.

## 10. Performance

```js
const gl = carillon.renderer.getContext(); carillon.composer.render(); gl.finish();
const t = performance.now(); for (let k = 0; k < 20; k++) carillon.composer.render(); gl.finish();
(performance.now() - t) / 20
```

Pass: under about 16 ms per frame in the tower. It measured about 6 ms at 2560 × 1600 on the build machine.

## 11. After rebuilding data

| Rebuilt | Check | Pass |
|---|---|---|
| `world.js` (`python3 tools/build_world.py`) | Read the diff; count rows; look for names starting "Installed", "The ", or containing `[` | About 680 rows; no junk names; then sections 4 and 7 |
| `sites/` (`node tools/fetch-sites.mjs`) | Section 5 | All 30 load |
| `vendor/` (`node tools/build-vendor.mjs`) | `cmp` the new `three.bundle.js` with the old one if versions did not change | Identical; then section 1 |

## Reporting

Say which sections you ran and which you did not. Say separately what you could not observe (sound, live
animation in a hidden pane, real touch), so the next reader does not take silence for a pass.
