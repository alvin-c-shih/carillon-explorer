# Design decisions

The design direction given by the project's owner during the build, in the order it was given, and what each one
turned into. Written from memory at the end of the session on 2026-11-12. Quoted lines are the owner's own words;
where the exact words were not kept, the request is paraphrased and marked so.

## 1. The starting point

- **Asked for** (paraphrased): an interactive way to learn about carillons.
- **Became:** a stylised 3D bell tower with a guided fly-through, bells you can play, and pedals.

## 2. Pedal shortcuts, and it must work from disk

> add keyboard shortcuts for the pedals too. When I launch index.html in Firefox, the buttons don't seem to do anything.

- **Pedals:** hold Shift with a low key to play the pedal for that bell.
- **Opening from disk is a requirement.** The page must work when `index.html` is double-clicked, not only from a
  server. This later drove the decision to keep every script a plain script and to bundle all libraries locally.

## 3. Real carillons, shown on something better than a flat picture

> Can you incorporate other educational materials like where the various carillons are located around the world,
> their specifications, fun trivia(?), and some visualization of it that goes beyond flat picture? Maybe something
> Google Earth style / circling drone?

- **Became:** the World atlas: a 3D globe with a tower for each carillon, a card with specifications and trivia, and a
  drone camera that circles the selected carillon.

## 4. Cost, the real tower, and a photo

> Anything you can include about cost? Is there no way to fly the drone around the actual tower? I thought Apple Maps /
> Google Maps had that level of detail. How about a nice photo on the info card?

- **Cost:** a Cost tab and cost notes on cards where a figure is published.
- **Photo:** each card has a banner photo from Wikimedia Commons, with credit.
- **The actual tower:** Google's and Apple's 3D models cannot be embedded, so the card links out to Google Earth.

## 5. Use OpenStreetMap for the tower's surroundings

> Are you sure there are no other sources for the external view of the towers than Google Earth?
>
> Yes, use OSM

- **Became:** "Fly around this tower in 3D": real building footprints and heights from OpenStreetMap, with the tower
  highlighted, for the 30 featured carillons.

## 6. The globe's home panel should be fun and easy

> The info at the top of the globe view feels cramped and hard to use. Please make it fun / easy.

- **Became:** tabs (Towers, Records, Cost), a ranked list with bars, a "Surprise me" button, and record cards.

## 7. Click the photo; show all 700; sensible filters and zooming

> I want to click on the banner picture to open the info card. Also I'd like all 700? carillons on the globe but some
> sensible filters, or zoom on cities / regions.

- **Photo click:** opens a large, uncropped view. (This was an interpretation of "open the info card".)
- **All carillons:** about 680 from Wikipedia's lists join the 30 featured ones.
- **Filters:** search, region or country, size, and featured-only. Choosing one turns and zooms the globe to the
  matches.

## 8. Review, then build the top three ideas

> Please review the usability and educational values. Suggest improvements, additional features.
>
> Build top three

- **Playable tunes:** four tunes with falling notes and a play-along mode that waits for you.
- **History on the globe:** a year slider from 1480 to 2025 with story stops.
- **Quiz:** eight questions a round, one answered by ear.

## 9. Fix the usability issues from the review

> Now fix the usability issues from your review

- Tower and globe link to each other in both directions.
- "Show more" in the list; shareable links that remember the view.
- Cards say when a carillon is placed only at its town; clumsy names tidied.
- Weak map close-ups fixed (Westerkerk, and four that showed no tower).
- Volume slider, reduced-motion support, and a phone layout.

## 10. Graphics should look current

> The tower graphic is kind of 90's looking. Can you make the graphics impressive by 2026 standards?

- **Became:** computed sky, sun shadows, contact shading, bloom, painted textures for stone, bronze and copper, and
  more architectural detail on the tower.

## 11. Flick the globe

> Can I get the globe to rotate based on the speed at which I flick it?

- **Became:** the globe keeps spinning at the speed of the flick and slows over a few seconds.
- **Side decision:** a Motion on/off button, because following the device's reduced-motion setting alone had
  silently switched off the fly-throughs.

## 12. Reset view must restore orientation too

> Reset View for the globe returns the zoom, but not the orientation. eg. If I pan to Antarctica, resetting view
> doesn't put me back on Antwerp.

- **Became:** Reset view returns the globe to its opening orientation and distance.
- **Still open:** the opening view is centred on the Atlantic, not on the Low Countries. Re-centring on Antwerp was
  offered and not decided.

## 13. Tunes must be easy to find

> Not obvious how to play songs besides Big Ben chime.

- **Became:** a "Play a tune" button on every stop of the tour, not only the last.

## 14. Every reset view should be useful

> Default view for carilloneur booth is not useful. Please review what things look like under reset view for every
> page which has such a button.

- **Became:** the playing cabin is seen from above the player's right, so the batons and pedals are visible. The
  climb, "Wires and cranks" and the map close-ups were reframed too.
- **Principle:** a default or reset view should show the thing the page is about without the reader moving the camera.

## 15. A way back to the start

> After Stop 8, how to get to beginning?

- **Became:** on the last stop, Next reads "Start again".

## 16. The wires should be mechanically honest

> Are the right angle turns in the cables to the bells realistic?
>
> Yes, model the cranks properly

- **Became:** three rocking bell cranks per bell, wire runs at separate heights, and clapper tails pulled sideways.
- **Principle:** where the model simplifies reality, the tour text says so.

## 17. "See inside", and countries on the globe

> See through walls makes me zoom into the bells myself.
> Maybe "See inside" and reframe nicely.
> Also would like it to be more obvious about countries / borders that carillons are in for the globe.
> Different colored spires? Try to come up with a pleasant design.

- **See inside:** the button is renamed and now flies to a view framing the whole instrument.
- **Countries:** border lines, each carillon country tinted in its own colour, towers in that colour, and a legend.
  Eight colours, chosen so neighbouring countries differ.

## 18. Last ideas

> All great ideas. Also a great tour of UChicago's carillon by Rob Scallon on YouTube.
>
> Real recordings
>
> The Scallon video can probably be a top-level resource since they talk about carillons in general as well as the
> specific UChicago one.

- **Real recordings:** built. Eight carillons have a verified Wikimedia Commons recording.
- **Rob Scallon video:** linked from the first and last tour stops and from the Rockefeller Chapel card, as a general
  resource and not only a Chicago one.
- **Called great, not built:** MIDI keyboard input, a night mode for the tower, writing and sharing your own tune,
  cleaning the data against a second source, and a swinging bell shown for contrast.

## 19. Run with no internet

> Can you ensure that the code can run local-only?

- **Became:** three.js, the Earth photo and the country outlines are local files in `vendor/`. Photos, recordings
  and links out still need a connection and fail quietly without one.

## Asked for and not yet done

- A code quality and security review before check-in. It was requested and then interrupted in favour of the
  local-only work.
