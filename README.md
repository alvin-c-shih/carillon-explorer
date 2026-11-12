# Carillon Explorer

An interactive way to learn about carillons: a 3D bell tower you can climb and play, a globe of the world's
carillons, and close-up views of real towers.

**Live:** https://alvin-c-shih.github.io/carillon-explorer/

## Run it

Open `index.html` in a browser. Nothing needs installing and no internet connection is needed.

Or serve the folder, which is what the preview setup in `.claude/launch.json` does:

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

A connection is used only for extras, which are simply absent without one: photos and recordings on the carillon
cards (streamed from Wikimedia Commons when a card is opened) and the links out to other sites.

## Files

| File | What it is | Edit by hand? |
|---|---|---|
| `index.html` | Page, styles | Yes |
| `main.js` | The tower, the tour, sound, tunes, panels, quiz | Yes |
| `atlas.js` | The globe | Yes |
| `site.js` | Map close-up of one tower | Yes |
| `carillons.js` | The 30 featured carillons and the list of real recordings | Yes |
| `world.js` | Every other carillon | No: `python3 tools/build_world.py` |
| `sites/*.js` | Map data around each featured tower | No: `node tools/fetch-sites.mjs` |
| `vendor/*` | three.js, the Earth photo, country outlines | No: `node tools/build-vendor.mjs` |

The three build tools need a connection; the app does not. `DECISIONS.md` records the design direction.

## Licence

The project's own code and text are under the Apache License 2.0: see `LICENSE` and `NOTICE`. Material from others
keeps its own licence, listed below.

## Sources and licences

- **three.js** 0.170.0, MIT licence (bundled in `vendor/three.bundle.js`, licence notices kept).
- **Carillon list** (`world.js`): text from Wikipedia's lists of carillons, CC BY-SA 4.0. Positions from
  OpenStreetMap's Nominatim geocoder, ODbL.
- **Map data** (`sites/`): © OpenStreetMap contributors, ODbL.
- **Country outlines**: world-atlas, from Natural Earth, public domain.
- **Earth photo**: from the three.js examples, NASA imagery.
- **Photos and recordings**: Wikimedia Commons, each shown with its author and licence where it appears.

Because `world.js` and `sites/` carry CC BY-SA and ODbL material, keep these notices with any copy you publish.

## Accessibility

- Everything can be reached and used from the keyboard: Tab to the 3D scene and use the arrow keys and + − to turn
  and zoom; Tab to the batons and use the arrow keys and Enter; the globe's carillons are also in the list.
- Screen readers get a description of each scene, an announcement when the stop or carillon changes, and focus
  that follows the content.
- "Typing plays bells" switches off the single-letter shortcuts; "Motion" switches off flights and circling.

## Checks

`TESTING.md` is the full test plan. There are no automated tests. The quickest check after a change is to load the
page from disk in a headless browser with the network blocked and confirm the first tour stop appears:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --user-data-dir=/tmp/carillon-check --host-resolver-rules="MAP * ~NOTFOUND" --virtual-time-budget=12000 --dump-dom "file://$PWD/index.html" | grep -o 'Stop 1 of 8'
```
