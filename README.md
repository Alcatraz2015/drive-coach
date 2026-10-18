# Drive Coach

A phone web app for teaching someone to drive. It has a live GPS map, checkpoint routes by stage, voice prompts, speed limit warnings, a skill board with coaching tips, and shareable lesson reports.

Live at https://alcatraz2015.github.io/drive-coach/. Open it in Safari, then Share → **Add to Home Screen**.

## Privacy
Lessons, GPS tracks, reports, profiles and skills stay on the phone, in the browser's IndexedDB storage. There is no server and no account. These requests leave the phone:
- **OpenFreeMap / OpenStreetMap:** map tiles for the area on screen. The report image uses OpenStreetMap tiles.
- **OSRM routing (router.project-osrm.org):** start, stop and destination points when a route is planned or a pin is snapped to a road. When you plan from where you are, the start point is your GPS position.
- **Nominatim:** the text you type into search.
- **Overpass:** road features, but only for areas outside the bundled Calgary-region data.

## Security
- All code runs from this site. Leaflet, MapLibre, jsPDF and the fonts are self-hosted in `vendor/` (copied from their npm packages), so no third-party script can be swapped in.
- A Content-Security-Policy in `index.html` blocks scripts from anywhere else and limits network access to the services above.
- GitHub Actions are pinned to commit SHAs. The test workflow has read-only access; only the weekly map-data job can push, and only to `data/osm/`.

**Back up all data** in the Routes tab saves a file you can restore on any phone.

## Files
| File | What it holds |
|---|---|
| `index.html` | Page markup |
| `css/app.css` | Styles, including light and dark themes |
| `js/data.js` | Content: skills, coaching tips, stage templates, mistake tips, areas, Alberta learner rules |
| `js/logic.js` | Pure logic: GPS filtering, checkpoint order, speed limits, auto-build, suggestions. Tested in Node. |
| `js/store.js` | IndexedDB storage, crash-safe lesson saving, migration from the old localStorage version |
| `js/osm.js` | OpenStreetMap lookups (Overpass with 3 mirrors, Nominatim) |
| `js/report.js` | Lesson report image and PDF |
| `js/app.js` | Map, live lesson, views, events |
| `vendor/` | Self-hosted libraries and fonts, with their licences |
| `sw.js` | Offline support. App files are network-first; map tiles are cached as you view them. |

## Tests
```
node --test tests/*.test.js
```

## Rules used
Alberta Class 7 learner rules are in `js/data.js` (`RULES`):
- No driving from 12:00 a.m. to 5:00 a.m.
- A supervisor aged 18+ with a full licence sits beside the learner.
- Zero alcohol and drugs.
- At least one year on Class 7 before the Class 5-GDL road test.

Check current rules with Alberta Registries.
