# Explore’s local websites

Six small original websites ship with kidOS and are served over real loopback HTTP on the separate app-runner origin. They work offline. There are no remote images, fonts, analytics, embedded videos, accounts or downloaded article copies.

| Site | Content | Local path |
| --- | --- | --- |
| Little Science Lab | Evaporation, condensation and a puddle observation | `/explore/sites/science/` |
| Moon Post | Reflected sunlight and Moon phases | `/explore/sites/space/` |
| Small Wonders | Pollinators and careful observation | `/explore/sites/nature/` |
| The Little Gazette | An invented reporting exercise distinguishing observations and opinions | `/explore/sites/newspaper/` |
| The Web Workshop | Real HTTP requests, responses, forms and JSON | `/explore/sites/workshop/` |
| A Little Homepage | An invented explorer’s personal-page example and visitor badges | `/explore/sites/personal/` |

Every page links to other local pages and includes a genuine HTML POST form. Responses use fixed choices and original explanatory text; they are not saved. Search and the Request lab use fixed JSON endpoints. Site data lives in `sites.mjs`; `site.css` supplies the local design. The trusted server module renders escaped text into HTML. No child server code executes.

## Content provenance — 2026-10-08

All prose, fictional characters, activities, layout and CSS were created for kidOS. Unicode symbols and system fonts provide the small illustrations. No third-party imagery, article text or media is redistributed. A license for kidOS itself still needs to be chosen before distribution; original authorship is not a completed distribution license review.

The short factual statements were checked against these primary institutional/documentation sources on October 8, 2026. They are paraphrases; these links are references for adults/developers and are not fetched at runtime.

- Science: [NOAA Education — The water cycle](https://www.noaa.gov/education/resource-collections/freshwater/water-cycle), supporting liquid-to-vapor evaporation, vapor-to-liquid condensation, and the varied paths of water through Earth’s systems.
- Space and the Moon JSON example: [NASA Science — Moon Facts](https://science.nasa.gov/moon/facts/) and [NASA Science — Top Moon Questions](https://science.nasa.gov/moon/top-moon-questions/), supporting the Moon’s orbit, reflected sunlight, phases, and illumination of its far side.
- Nature: [U.S. National Park Service — About Pollinators](https://www.nps.gov/subjects/pollinators/what-is-a-pollinator.htm), supporting animal pollination and the existence of wind, water and self-pollination.
- Workshop: [MDN Web Docs — Overview of HTTP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Overview), supporting browser/server requests, responses, GET, POST and status codes.
- Newspaper and personal site: original clearly labeled fiction. Button Bay, Pebble and the reported paper boats are invented. No external news, real family messages, personal photos or household identities are included.

These are starter lessons, not an age-graded or comprehensive curriculum. Family language, reading level and content preferences remain open product decisions. Future educational collections need the same source and license review.

See [Explore implementation and limits](../../docs/EXPLORE.md). Private DNS, `home.arpa` naming, TLS enrollment, publishing and operating-system network policy remain future work.
