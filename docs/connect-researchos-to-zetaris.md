# Connect ResearchOS to your local Zetaris

Use this guide once Zetaris is installed and running on your machine. For installation, see [Install Zetaris on your local machine](zetaris-local-install.md).

## Before you start

The `node_modules` folder committed to this repo is a Windows build, so `npx tsx` won't run on macOS or Linux, including WSL Ubuntu. Run `npm install` in `build-oct26/` first:

```bash
cd build-oct26
npm install
```

## Step 1 — Copy your organisation ID

In the Zetaris UI (http://localhost:3000), go to **Management → Organisation** and copy the numeric **ID**.

## Step 2 — Create an API key

Go to **Management → API Tokens**, click **+**, and copy the key. It's shown only once.

## Step 3 — Create `.env.local`

In `build-oct26/`, copy the template:

```bash
cp .env.example .env.local
```

Then fill in these values:

```dotenv
ZETARIS_CHANNEL=proxy
ZETARIS_BASE_URL=http://localhost:3000
ZETARIS_ORG_ID=<your org ID>
ZETARIS_API_KEY=<your key>
```

`.env.local` is gitignored. Never commit it or paste the API key into chat.

## Step 4 — Load the ResearchOS data into Zetaris

In the Zetaris **SQL Editor**, run the four statements in [`build-oct26/research-os/zetaris/sql/research_os_create.sql`](../build-oct26/research-os/zetaris/sql/research_os_create.sql), one at a time.

## Step 5 — Check the app can reach Zetaris

```bash
npm run zetaris:check     # expect papers: 3, notes: 30, experiments: 2
```

## Step 6 — Use Zetaris as the data source

```bash
DATA_SOURCE=zetaris npx tsx research-os/research.ts search "post quantum"
```

To make Zetaris the default, set `DATA_SOURCE=zetaris` in `.env.local`.

## Stopping and restarting Zetaris

Run these from the `zetaris-platform` folder:

```bash
docker compose stop      # pause; data kept
docker compose start     # resume
docker compose down      # remove containers; data kept
docker compose up -d     # bring back with the same data
```

Avoid `docker compose down -v` unless you want to wipe everything. It deletes the stored metadata and encryption keys.

## Getting help

If you get stuck, the Zetaris [troubleshooting guide](https://github.com/zetaris/getting-started/blob/main/docs/guides/troubleshooting.md) covers the common errors. More detail on the ResearchOS setup is in [`build-oct26/research-os/zetaris/README.md`](../build-oct26/research-os/zetaris/README.md).
