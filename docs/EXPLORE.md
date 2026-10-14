# Explore

Explore now has six original local starter websites, links between them, searchable lessons, genuine HTML forms, fixed JSON activities and a request inspector. It uses the existing separate loopback runner origin. This is a working local web collection; private DNS, HTTPS and system-wide network enforcement are not implemented.

## Use it

Open **Explore**, choose a website, and follow its lesson and links. The **Local address** is the actual runner address and path, such as `http://127.0.0.1:8788/explore/sites/space/`. It updates as the site follows its local links or receives a form response. **Reload page** returns to that site’s lesson. **All websites** returns to the directory.

Search reads site titles, descriptions and lesson text through `/explore/api/search?q=…`. All words must appear somewhere in a matching lesson. Empty search shows all sites. Search is local, limited to 80 characters, and not stored. It does not search the public internet or family files.

Every lesson has a multiple-choice HTML form that sends a real POST to its local `/answer` path. The server validates the exact fixed choices and returns HTML containing the answer. It does not write state, remember scores or collect free-form personal information. The newspaper and personal homepage are explicitly invented examples.

**Request lab** sends one of three genuine requests: GET the Moon JSON data, POST a water-cycle prediction as JSON, or GET the selected website’s HTML. It shows the method, complete URL, submitted body, actual HTTP status, content type, request protocol reported by the server, measured elapsed time, response size and response body. Responses are displayed as text, never executed. The lab inspects requests it explicitly sends; it is not a browser-wide traffic monitor and does not claim to capture every iframe asset, click or form submission. Its last response stays only in the current open Explore view.

The desktop workspace can retain the selected site ID. Reopening starts at that site’s lesson; form responses, query text and Request lab results are not restored. No URL, credential or iframe execution state is stored in the workspace.

## Runtime boundary

`services/platform/explore.mjs` exports a runner handler and a catalog function. The platform’s authenticated `/api/explore` endpoint supplies the catalog. Public educational content occupies the fixed runner `/explore/` prefix. The handler has no Store reference, write operation, child-code evaluator or generic proxy.

Site frames use `sandbox="allow-scripts allow-forms"` without same-origin authority. Their server CSP permits only the local stylesheet and small local location-reporting script, blocks fetch connections and embedded frames, and restricts forms to the local site prefix. No platform token, media cookie or capability is sent into the frame. A narrowly validated message may update the trusted UI’s displayed site/path only: the parent checks the exact mounted frame, opaque `null` origin, message shape and fixed site path. It cannot invoke platform APIs.

The trusted Request lab fetches only fixed Explore paths with `credentials: 'omit'`, no redirects and no token headers. CORS grants reading to the exact desktop origin, never `*` or the opaque frame origin. The desktop CSP permits that specific runner origin for these fetches. HTML forms with an opaque origin may submit fixed nonpersistent lesson answers; JSON APIs reject that origin. Existing desktop Host/Origin/Fetch Metadata/token checks continue to reject runner or opaque-origin access to the desktop session and project APIs.

Limits: 1 KiB request bodies, eight concurrent body readers, fixed methods/routes/fields/choice values, no compressed bodies, UTF-8 input, and at most 32 KiB per inspected response. The inspector times out after ten seconds. The shared service request timeout also applies. Paths reject encoding, traversal and host aliases before routing. Search results expose only curated metadata. These browser and HTTP boundaries are not Linux child-code containment or operating-system resource limits.

## Verification

`node --test services/platform/explore.test.mjs`: **9 passed, 0 failed** on the development host with temporary loopback-only HTTP services. The tests cover all six pages and local dependencies; real form responses; search filtering; fixed JSON routes; CORS/preflight; content types, body limits and methods; raw traversal and host rejection; credential-free real HTTP inspection; response bounds and transport failure; exact iframe-message identity; and rejection of simulated runner/opaque-origin requests by the real desktop session/project endpoints.

These tests establish the HTTP and helper contracts. They do not certify browser layout, actual sandbox navigation, input accessibility, Linux containment or Pi behavior. End-to-end browser and integrated-suite verification belongs in the current milestone record after it runs.

## Still planned

Private DNS and `home.arpa` names, device-specific HTTPS credentials and trust enrollment, parent network policy, child site publishing, persistent notes/bookmarks, curriculum expansion, and a contained Python/native server runtime remain future work. No host DNS, firewall, trust store or network configuration changes are needed for this slice.

See [content sources and provenance](../content/private-web/README.md). Original lessons are small offline starter content, not copied articles or live news.
