# Drive Coach

A phone web app for teaching someone to drive. It has a live GPS map, checkpoint routes by stage, voice prompts, speed limit warnings, a skill board with coaching tips, and shareable lesson reports.

Live at https://alcatraz2015.github.io/drive-coach/. Open it in Safari, then Share → **Add to Home Screen**.

## Privacy
Everything stays on the phone, in the browser's IndexedDB storage. There is no server and no account. The phone does make some requests:
- **OpenStreetMap:** map tiles for the area on screen, road features for auto-build, and speed limits near the car.
- **Nominatim:** place search.
- **Google Fonts and cdnjs:** fonts and libraries.

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
| `sw.js` | Offline support. App files are network-first; map tiles are cached as you view them. |

## Tests
```
node --test tests/
```

## Rules used
Alberta Class 7 learner rules are in `js/data.js` (`RULES`):
- No driving from 12:00 a.m. to 5:00 a.m.
- A supervisor aged 18+ with a full licence sits beside the learner.
- Zero alcohol and drugs.
- At least one year on Class 7 before the Class 5-GDL road test.

Check current rules with Alberta Registries.
