# 4DOTS Landing Page

A fast, dependency-free landing page for 4DOTS, hosted on Cloudflare Pages. Lead
submissions are validated by Cloudflare Turnstile and written to a private
Google Sheet through a small Google Apps Script web app.

## Architecture

```text
Visitor
  -> Cloudflare Pages static site
  -> Google Apps Script web app
      -> Cloudflare Turnstile verification
      -> server-side input validation
      -> private Google Sheet
```

The frontend contains no secret values. The Turnstile secret and Sheet ID stay
in Apps Script Properties.

## Repository Structure

```text
docs/                 Public Cloudflare Pages output
  index.html
  styles.css
  app.js
  _headers
apps-script/          Google Apps Script source
  Code.gs
  appsscript.json
tests/                Automated contract and validation tests
requirements-dev.txt  Pinned local/CI test dependency
wrangler.jsonc        Cloudflare Pages project configuration
assets/               Local design references; not published from docs/
```

## Run Locally

From the repository root:

```bash
python3 -m http.server 8000 --directory docs
```

Open `http://localhost:8000`. The form stays disabled until its public endpoint
and Turnstile site key are configured.

## Run Automated Tests

Create the local virtual environment and install the test dependency:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
```

Run the suite:

```bash
.venv/bin/pytest
```

The tests verify the Cloudflare Pages configuration and headers, Apps Script
timezone, frontend/backend allowed-value contract, backend validation and
formula-injection protection, and JavaScript syntax. GitHub Actions runs the
same suite on pushes and pull requests.

## Configure the Google Sheet

1. Create a private Google Sheet for leads.
2. Copy the ID from its URL:

   ```text
   https://docs.google.com/spreadsheets/d/SHEET_ID/edit
   ```

3. Do not make the Sheet public. The Apps Script deployment writes to it using
   the deploying Google account.

The script creates a `Leads` tab and header row automatically on the first
valid submission.

## Configure Cloudflare Turnstile

1. Create a free Turnstile widget in the Cloudflare dashboard.
2. Add the launch hostname, such as `4dots.pages.dev`, and any custom
   domain you plan to use.
3. Copy the public **site key** and private **secret key**.
4. Put the site key in [`docs/app.js`](docs/app.js):

   ```js
   turnstileSiteKey: "YOUR_PUBLIC_SITE_KEY",
   ```

Never put the Turnstile secret key in `docs/` or anywhere else served by
Cloudflare Pages.

## Deploy Google Apps Script

1. Open [Google Apps Script](https://script.google.com/) and create a project.
2. Replace its source with [`apps-script/Code.gs`](apps-script/Code.gs).
3. In **Project Settings**, enable showing the manifest file and replace it
   with [`apps-script/appsscript.json`](apps-script/appsscript.json).
4. Under **Script Properties**, add:

   | Property | Required | Value |
   | --- | --- | --- |
   | `SHEET_ID` | Yes | Google Sheet ID |
   | `TURNSTILE_SECRET` | Yes | Private Turnstile secret key |
   | `SHEET_NAME` | No | Defaults to `Leads` |
   | `ALLOWED_HOSTNAMES` | Recommended | Comma-separated hosts, such as `4dots.pages.dev,www.example.com` |
   | `RETURN_URL` | Recommended | Full public landing-page URL |

5. Select **Deploy > New deployment > Web app**.
6. Set **Execute as** to yourself.
7. Set access to **Anyone**.
8. Authorize the requested Google Sheets and external-request scopes.
9. Copy the deployed `/exec` URL.
10. Put that public URL in [`docs/app.js`](docs/app.js):

    ```js
    formEndpoint: "YOUR_GOOGLE_APPS_SCRIPT_EXEC_URL",
    ```

The `/exec` URL is a public endpoint and is safe to place in the frontend. The
receiver still requires a valid, single-use Turnstile token and validates all
submitted values server-side.

After changing `Code.gs`, create a new Apps Script deployment version so the
public endpoint receives the update.

## Deploy Cloudflare Pages

1. Push the repository to GitHub.
2. In the Cloudflare dashboard, open **Workers & Pages** and create a Pages
   application using **Import an existing Git repository**.
3. Connect this repository and use `main` as the production branch.
4. Select no framework preset, leave the build command blank, and use `docs` as
   the build output directory.
5. Deploy the project. Cloudflare will publish future pushes automatically and
   create preview deployments for non-production branches.

The checked-in [`wrangler.jsonc`](wrangler.jsonc) keeps the Pages project name,
output directory, and compatibility date in source control. Cloudflare will
publish the site at:

```text
https://4dots.pages.dev/
```

The exact `pages.dev` hostname may differ if the project name is unavailable.
After the first deployment, add the final hostname to Turnstile and the Apps
Script `ALLOWED_HOSTNAMES` property, then set `RETURN_URL` to the full site URL.

For an authenticated manual deployment with Wrangler:

```bash
npx wrangler pages deploy docs
```

## Security Notes

- Never commit API secrets, Sheet credentials, or Turnstile secrets.
- Keep the Google Sheet private and limit its editors.
- Use `ALLOWED_HOSTNAMES` in Apps Script for production.
- The receiver verifies Turnstile, validates allowed choices, limits field
  lengths, rejects malformed fields, uses a honeypot, locks concurrent writes,
  and neutralizes spreadsheet formula injection.
- Cloudflare Pages is appropriate for public lead forms, not passwords, card
  details, or other sensitive transactions.

## Launch Checklist

- Replace both placeholders in `docs/app.js`.
- Submit one valid test lead and confirm it appears in the private Sheet.
- Test invalid email, invalid phone, missing consent, and no selected service.
- Test on mobile and desktop.
- Set `RETURN_URL` and `ALLOWED_HOSTNAMES` to the final Cloudflare Pages or
  custom-domain hostname.
- Confirm Cloudflare Pages serves the security headers from `docs/_headers`.
- Add a privacy policy before running paid acquisition campaigns.

## License

See [LICENSE](LICENSE).
