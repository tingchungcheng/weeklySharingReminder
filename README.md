# Weekly sharing reminder

Static site that shows a **Wednesday rotation** for a roster of names. Names come from **DynamoDB** via **Lambda** and **API Gateway (HTTP API)**. The UI is hosted on **AWS Amplify Hosting** (GitHub-connected builds).

---

## Repository layout

| Path | Purpose |
|------|--------|
| `web/` | Frontend: `index.html`, `app.js`, `reminder-modal.js`, `roster-editor.js`, `styles.css`, `api-config.js` |
| `sam/` | Backend: `template.yaml`, Lambdas `handlers/list-names/`, `handlers/put-roster/`, `scripts/` (seed, **`dev_http_server.py`** for local API proxy) |
| `amplify.yml` | Writes `web/api-config.js` from **`API_BASE_URL`** and **`EDIT_ROSTER_KEY`** |
| `samconfig.toml` | Default `sam build` / `sam deploy` options (stack name, region, profile, template path) |
| `.env.example` | Documents Amplify env names **`API_BASE_URL`**, **`EDIT_ROSTER_KEY`** (must match SAM `EditRosterSecret`) |
| `.env` | **Local only** — gitignored; optional notes for yourself |

---

## Prerequisites

- **AWS CLI** configured (`aws configure` or a named profile, e.g. `export AWS_PROFILE=your-profile`)
- **AWS SAM CLI** — [Install SAM](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
- **Node.js** (for SAM to install Lambda dependencies during `sam build`)
- **Git** (for Amplify)

---

## Local frontend

- **Minimal:** `python3 -m http.server 8080 --directory web` then open `http://localhost:8080/`. The browser calls AWS directly; **`sam deploy`** must include the **OPTIONS /roster** CORS fix or **`PUT /roster`** can fail with “Failed to fetch”.
- **If fetches still fail** (extensions, or API not redeployed yet): from repo root run  
  `python3 sam/scripts/dev_http_server.py`  
  (use `PORT=8099 …` if **8080** is busy). In `web/api-config.js` set **`window.WEEKLY_SHARING_DEV_API_PROXY = true`** so requests go to **`/__weekly_api/...`** on the same origin; the script proxies to your execute-api URL (override with env **`WEEKLY_SHARING_API_PROXY_TARGET`**).

---

## Backend: SAM (Lambda + DynamoDB + HTTP API)

### What gets deployed

- **DynamoDB** table with partition key `pk` (string).
- **Lambda** reads one item: `pk = ROSTER`, attribute `names` (list of strings).
- **HTTP API** exposes:
  - `GET /names` → JSON `{ "names": [ "...", ... ] }` (names sorted alphabetically, unique case-insensitively).
  - `PUT /roster` → replace the whole `ROSTER` item; body `{ "names": ["...", ...] }`; header **`X-Edit-Key`** must match stack parameter **`EditRosterSecret`** (min 8 characters).

Template: `sam/template.yaml`.

### Build and deploy

From the **repository root**:

```bash
sam build
sam deploy --parameter-overrides EditRosterSecret='your-long-random-secret'
```

Use the **same** string in Amplify **`EDIT_ROSTER_KEY`** (written to `window.WEEKLY_SHARING_EDIT_KEY`) and locally in `web/api-config.js`. If `EditRosterSecret` is empty or wrong, `PUT /roster` returns **401**.

First time you may prefer:

```bash
sam deploy --guided
```

Then align `samconfig.toml` with your choices (stack name, region, profile).

### After deploy: outputs

In **CloudFormation** → your stack → **Outputs**, or:

```bash
aws cloudformation describe-stacks \
  --stack-name weekly-sharing-reminder-api \
  --query "Stacks[0].Outputs[?OutputKey=='HttpApiEndpoint'].OutputValue | [0]" \
  --output text
```

That value is your **`API_BASE_URL`** (no trailing slash). The browser calls:

`{API_BASE_URL}/names` and `{API_BASE_URL}/roster` (PUT).

### DynamoDB seed

Do **not** pass the CloudFormation **stack name** as the table name. Either resolve the table from the stack or paste the physical table name.

**Recommended (uses output `RosterTableName`):**

```bash
export AWS_PROFILE=your-profile   # if you use a named profile
./sam/scripts/seed-roster.sh --stack weekly-sharing-reminder-api
```

**Or** pass the table name from Outputs / DynamoDB console:

```bash
./sam/scripts/seed-roster.sh your-physical-table-name
```

Seed payload is defined in `sam/scripts/seed-item.json` (`pk = ROSTER`, `names` list).

### Smoke test the API

```bash
API_BASE_URL="https://YOUR_ID.execute-api.REGION.amazonaws.com"
curl -sS "${API_BASE_URL}/names"
```

Expect `{"names":[...]}`.

---

## Frontend: Amplify Hosting (GitHub)

### Why you must push

Amplify builds from your **Git** branch. Changes only go live after **commit + push** (unless you use a different workflow).

### Environment variable (not in GitHub)

Amplify does **not** read secrets from GitHub for your API URL. You set them in the **Amplify console**:

**App → Hosting → Environment variables** (or equivalent for your Amplify version)

Add:

| Name | Value |
|------|--------|
| `API_BASE_URL` | Full HTTP API base URL from CloudFormation output `HttpApiEndpoint` (no trailing slash) |
| `EDIT_ROSTER_KEY` | Same string as SAM **`EditRosterSecret`** (pen / edit roster in the UI) |

During build, `amplify.yml` runs:

```text
echo "window.WEEKLY_SHARING_API_BASE = \"${API_BASE_URL}\";" > web/api-config.js
echo "window.WEEKLY_SHARING_EDIT_KEY = \"${EDIT_ROSTER_KEY}\";" >> web/api-config.js
```

So **`web/api-config.js` in the repo** is a local/dev template; **Amplify** overwrites it on each build.

### Artifact root

`amplify.yml` sets **`baseDirectory: web`**. Only files under `web/` are published as the site root (`/` → `web/index.html`).

---

## Local development

### Do not open `index.html` as `file://`

Double-clicking the file uses the **`file://`** protocol. Browsers often block or break **`fetch()`** to your HTTPS API, which shows as **“Failed to fetch”**. The hosted site works because it is served over **HTTPS**.

### Serve `web/` over HTTP

From the **repository root**:

```bash
python3 -m http.server 8080 --directory web
```

Open **http://localhost:8080/**

Edit **`web/api-config.js`** locally: set `window.WEEKLY_SHARING_API_BASE` to match Amplify **`API_BASE_URL`**.

---

## Calendar reminder (+ modal)

The **+** button opens a dialog: user enters a **name** (must match the roster, same rules as the list). Then:

- **Google Calendar** — opens Google’s **event template** URL in a new tab (no server; user confirms save).
- **Outlook / Teams (365)** — opens **Outlook on the web** compose (`outlook.office.com`), which is the same calendar many **work/school Teams** tenants use. If your account lives on **Outlook.com** instead, use **Download .ics** and import into [outlook.live.com](https://outlook.live.com) calendar.
- **Download .ics** — works with Apple Calendar and other apps that accept `.ics` imports.

The event is **the day before** your sharing **Wednesday**, **09:00–09:30 local** (browser timezone), with title and description derived from the roster row. **`SERIES_START` in `web/app.js`** must stay aligned with how Wednesdays are computed for the list.

No extra AWS cost for this path (no reminder Lambda or SES).

---

## Environment files (`.env`)

- **`.env`** is **gitignored** — use it for local tooling notes if you want; the **browser does not read `.env`**.
- **`.env.example`** documents **`API_BASE_URL`** and **`EDIT_ROSTER_KEY`** for Amplify parity.
- Anything bundled into **browser JavaScript** is visible in devtools; keep **real secrets** (DB passwords, signing keys) in **Lambda / Secrets Manager**, not in frontend env vars.

---

## AWS credentials remarks

- If `sam deploy` or `aws` fails with **InvalidClientTokenId** / **UnrecognizedClient**, refresh credentials (new access keys in IAM, or SSO session).
- Prefer a **named profile**: `export AWS_PROFILE=your-profile` so the default profile is not accidentally used.
- **Never commit** access keys or `.env` with secrets.

---

## Security and production remarks

- **CORS** is returned from Lambdas (`Access-Control-Allow-Origin: *`) and explicit **`OPTIONS`** routes on `/names` and `/roster` so browser preflight for **`PUT`** + **`X-Edit-Key`** succeeds. To lock down later, echo a fixed **`Access-Control-Allow-Origin`** from Lambda instead of `*`.
- The **API Gateway URL** is public; protect sensitive operations with **auth** (e.g. Cognito, API keys, Lambda authorizer) when you add writes or admin routes.
- **Rotate** any access key that was ever pasted into chat or committed by mistake.

---

## Troubleshooting

| Symptom | Things to check |
|--------|-------------------|
| Amplify build OK but site shows “configure API” | **`API_BASE_URL`** missing or empty in Amplify env vars; redeploy after saving. |
| “Failed to fetch” / CORS (status **0**) from localhost | Use **HTTP server** for `web/`, not **`file://`**. Confirm **`api-config.js`** URL. Redeploy SAM so **`OPTIONS /roster`** returns CORS headers (see template comments). |
| `ResourceNotFoundException` on seed | You passed the **stack name** instead of the **DynamoDB table name** — use `./sam/scripts/seed-roster.sh --stack ...`. |
| Empty `names` in API | Item missing or wrong shape — need **`pk = ROSTER`** and **`names`** string list; re-run seed. |
| `sam build` npm errors | Lambda `package.json` must include **`name`** and **`version`** (required by `npm pack` during SAM build). |
| Calendar button does nothing / “No match on roster” | Name spelling must match **`/names`** data; load roster first. |
| Outlook opens wrong account | Sign into the correct Microsoft work profile in the browser, or use **.ics** import. |
| **401** on save roster | **`X-Edit-Key`** must match **`EditRosterSecret`** (SAM deploy + Amplify `EDIT_ROSTER_KEY` / local `api-config.js`). |

---

## License / ownership

Use and adapt as needed for your team; add a license file if you open-source the repo.
