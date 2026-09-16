# Jev CSV Workbench

A browser-first interface for turning CSV rows into structured Jev judgments.

## Privacy model

- No CSV or generated dataset is committed with the project.
- A selected CSV is parsed into memory inside the browser.
- The file is not uploaded, saved, or persisted by the frontend.
- Each explicitly selected row becomes one JSON state when the user clicks Run Jev.
- Only that state and the user-defined questions are sent through the Cloudflare Worker to TypeSafe.
- The Worker validates and forwards requests without storing or logging their bodies.
- The site fails closed behind a Netlify Edge Function password gate.
- The Cloudflare Worker verifies the same signed login cookie before calling Jev.
- Refreshing the page clears the loaded file and results.

## Jev workflow

Users can create up to 20 independent questions and run them together against each selected row:

- Noul: a yes/no judgment returned as the probability of yes.
- Choice: one option from a supplied map, plus probabilities and confidence.
- Score: a position across 2-10 ordered descriptive levels, plus probabilities and confidence.

The frontend limits each run to 25 rows and sends at most three row requests concurrently.

## Local preview

Serve this directory with any static file server and open `index.html`. CSV import and question editing work without a backend. Live Jev inference requires the Worker.

## Optional command-line CSV conversion

For local debugging only:

```sh
node scripts/transform.mjs path/to/input.csv data/local-output.json
```

`data/*.json` is ignored by Git and must not be deployed.

## Deployment

- GitHub stores the frontend, Worker, and deployment configuration together.
- Netlify publishes the static frontend.
- Cloudflare Worker keeps `TYPESAFE_API_KEY` server-side and forwards ephemeral inference requests.
- The RG Lab hub proxies `/jev-board/` to the project Netlify site and `/jev-board/api/*` to the Worker.

Set a long, unique `PROTECTED_PAGE_PASSWORD` in Netlify with the Functions scope, then redeploy. Set that same value and the Jev key as encrypted Worker secrets without putting either in source control:

```sh
wrangler secret put PROTECTED_PAGE_PASSWORD
wrangler secret put TYPESAFE_API_KEY
```

The login creates a signed, secure, HTTP-only cookie that expires after 24 hours. The edge gate blocks the entire frontend when the password is missing, and the Worker independently rejects unauthenticated inference requests.

Treat `main` as production. Make future changes on branches and merge after review.
