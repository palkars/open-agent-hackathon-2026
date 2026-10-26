# Install Zetaris on your local machine

This guide is based on the Zetaris getting-started [local install guide](https://github.com/zetaris/getting-started/blob/main/docs/install/updated_zetaris_installation_guide.md) and the Zetaris Cloud **Run locally** page. Expect about 20–30 minutes, mostly downloading.

**Contents**

1. [Check your laptop can run it](#step-1--check-your-laptop-can-run-it)
2. [Understand the three logins](#step-2--understand-the-three-logins)
3. [Get the platform bundle and credentials](#step-3--get-the-platform-bundle-and-credentials)
4. [Set up Ubuntu on WSL2 (Windows only)](#step-4--set-up-ubuntu-on-wsl2-windows-only)
5. [Connect Docker to Ubuntu](#step-5--connect-docker-to-ubuntu)
6. [Copy and unpack the bundle](#step-6--copy-and-unpack-the-bundle)
7. [Sign in to the registry and run the preflight check](#step-7--sign-in-to-the-registry-and-run-the-preflight-check)
8. [Edit `.env` before the first start](#step-8--edit-env-before-the-first-start)
9. [Pull and start Zetaris](#step-9--pull-and-start-zetaris)
10. [Sign in and run a first query](#step-10--sign-in-and-run-a-first-query)
11. [Stop and restart](#stop-and-restart)
12. [Troubleshooting](#troubleshooting)

---

## Step 1 — Check your laptop can run it

| Requirement | Minimum |
|---|---|
| Docker | Docker Desktop (macOS/Windows), or Docker Engine 25+ with the Compose plugin (Linux) |
| Memory allocated to Docker | 8 GB recommended; the install check fails below 6 GB |
| CPUs allocated to Docker | 4 |
| Free disk | 15 GB or more |
| Windows | Run every command from **WSL2**, with Docker Desktop's WSL integration turned on |
| Apple Silicon (M1/M2/M3…) | Works, but slower: the images are amd64 and run under emulation. Turn on **Use Rosetta** in Docker Desktop → Settings → General. |

What counts is the memory you give **Docker**, not your laptop's total RAM. In Docker Desktop, set it under **Settings → Resources**. If you can't give Docker 6–8 GB, use the [AWS route](https://github.com/zetaris/getting-started/blob/main/docs/install/choose-install.md) instead.

---

## Step 2 — Understand the three logins

You don't log in to Zetaris with Google from Ubuntu. Setting up Zetaris involves three separate logins, and Google is only for the first one.

| Login | Where you do it | What you use |
|---|---|---|
| **1. Zetaris Cloud** (download website) | Your web browser | Your Google account |
| **2. Zetaris image registry** (lets Docker download the software) | Ubuntu terminal | The registry sign-in command from **Step 1** of the Run locally page. Not your Google account or your Ubuntu username. |
| **3. Your own Zetaris** (once it's running) | Browser at http://localhost:3000 | The admin email and password from **Step 7** of the Run locally page, or the ones you set in `.env` |

---

## Step 3 — Get the platform bundle and credentials

1. Go to [zetaris.com/cloud](https://www.zetaris.com/cloud) and click **Start Free**, or go straight to the [Run locally page](https://cloud.enterprise.zetaris.com/dashboard/download). Sign in with Google.
2. Click **Download zetaris-platform.zip** (about 28 MB). It goes into your Downloads folder.
3. On the same page, note these two things:
   - **Step 1, "Sign in to the registry":** a `docker login zetarishackathon.azurecr.io ...` command with a username and token. You'll paste it into Ubuntu (login 2). Use the box's **copy** button, because the token may be hidden.
   - **Step 7, "Sign in":** the admin email (`admin@zetaris.com`) and password. You'll use them at http://localhost:3000 (login 3).

Keep the page open or store these details somewhere safe. Never paste them into chat or commit them to git.

If the page doesn't show a download or a registry command, your account may not have local access enabled yet. Contact [Zetaris Support](https://www.zetaris.com/support) or the [hackathon organisers](https://hackathon.genai.works/event/open-agent-hackathon-2026) and ask them to enable the local install.

---

## Step 4 — Set up Ubuntu on WSL2 (Windows only)

Windows users run every command from **WSL2**, a Linux terminal built into Windows. On macOS or Linux, skip to [Step 6](#step-6--copy-and-unpack-the-bundle) and use your normal terminal.

### 4.1 Install Ubuntu

1. Start **Docker Desktop** from the Start menu and wait until it says it's running.
2. Click **Start**, type `Ubuntu`, and open it.
3. If nothing called Ubuntu appears, open **PowerShell**, run `wsl --install`, restart your computer, and then open Ubuntu.

If `wsl --install` says `ERROR_ALREADY_EXISTS`, Ubuntu is already installed and you can carry on.

### 4.2 Check that Ubuntu is on WSL version 2

In **PowerShell**, run:

```powershell
wsl -l -v
```

You should see something like:

```
  NAME              STATE           VERSION
* Ubuntu            Stopped         2
  docker-desktop    Running         2
```

Look at the **VERSION** column for Ubuntu:

- If it says **2**, go on to 4.3.
- If it says **1**, convert it (this can take a few minutes), then run `wsl -l -v` again to confirm it now says 2:

  ```powershell
  wsl --set-version Ubuntu 2
  ```

If your Ubuntu line has a different name, such as `Ubuntu-22.04`, use that exact name in the commands.

### 4.3 Open Ubuntu

Either type this in PowerShell:

```powershell
wsl -d Ubuntu
```

or click **Start**, type `Ubuntu`, and open it.

Your prompt changes to something like `user@LAPTOP:~$`, which means you're inside Ubuntu.

The first time Ubuntu opens, it may ask you to **create a username and password**. You can choose anything. When you type the password, nothing appears on screen; that's normal.

---

## Step 5 — Connect Docker to Ubuntu

### 5.1 Turn on Docker for Ubuntu

1. Open **Docker Desktop** and wait until it says **Engine running** in the bottom-left corner.
2. Click the **gear icon (Settings) → Resources → WSL Integration**.
3. Make sure **Enable integration with my default WSL distro** is ticked, and switch on **Ubuntu**.
4. Click **Apply & Restart**.

### 5.2 Check the Docker versions

In the **Ubuntu** window (not PowerShell), run:

```bash
docker version
docker compose version
```

You need to see **both**:

- a **Server** section in the first output, version 25 or higher:

  ```
  Server: Docker Desktop
   Engine:
    Version:          29.x.x
  ```

- a line like `Docker Compose version v2.x.x` (or later) from the second.

If both appear, go to [Step 6](#step-6--copy-and-unpack-the-bundle).

### 5.3 If you get `permission denied ... docker.sock`

This means your Ubuntu user isn't allowed to use Docker yet, so the **Server** section is missing.

1. Give your Ubuntu user permission to use Docker:

   ```bash
   sudo usermod -aG docker $USER
   ```

   It asks for the Ubuntu password you created. Nothing appears on screen while you type it; that's normal.

   If it says `group 'docker' does not exist`, run these two commands instead:

   ```bash
   sudo groupadd docker
   sudo usermod -aG docker $USER
   ```

2. Restart Ubuntu so the permission takes effect. Close the Ubuntu window, then in **PowerShell** run:

   ```powershell
   wsl --shutdown
   ```

   Wait about 10 seconds, then reopen Ubuntu from the Start menu. If Docker Desktop shows a message, let it reconnect, or restart Docker Desktop.

3. Check again in Ubuntu:

   ```bash
   docker version
   ```

   This time you should see the **Server** section.

---

## Step 6 — Copy and unpack the bundle

Unpack the bundle in Ubuntu's own home folder. It runs much faster there than on the Windows drive under `/mnt/c/...`.

```bash
mkdir -p ~/zetaris
cd ~/zetaris
cp /mnt/c/Users/<your-windows-user>/Downloads/zetaris-platform.zip .
unzip zetaris-platform.zip
cd zetaris-platform
```

- Replace `<your-windows-user>` with your Windows user folder name, for example `manag`.
- If `unzip` isn't installed, first run `sudo apt update && sudo apt install -y unzip`.
- On macOS or Linux, move the zip from Downloads into `~/zetaris/` and run the same `unzip` and `cd` commands.

Run every remaining command from this `zetaris-platform` folder.

---

## Step 7 — Sign in to the registry and run the preflight check

1. Paste the **exact `docker login` command** from Step 1 of the Run locally page. In Ubuntu, paste with **right-click** or **Ctrl + Shift + V**. It looks like this:

   ```bash
   docker login zetarishackathon.azurecr.io
   ```

   If it asks for a **Username** and **Password**, enter the registry credentials from the download page. Don't use your Google details or your Ubuntu username. The password won't appear as you type or paste it. Press Enter afterwards.

   You should see:

   ```
   Login Succeeded
   ```

   This only works once `docker version` shows the **Server** section (Step 5).

2. Run the preflight check:

   ```bash
   ./preflight.sh
   ```

   Every check should say **PASS**. Fix every **FAIL** before you continue. A memory **WARN** at 6–7 GB is acceptable.

---

## Step 8 — Edit `.env` before the first start

Open the `.env` file that came in the bundle, for example with `nano .env`. Keep the image settings it already has, and set or confirm these:

| Variable | Value |
|---|---|
| `ZETARIS_ADMIN_EMAIL` | Your admin login email (default `admin@zetaris.com`) |
| `ZETARIS_ADMIN_PASSWORD` | 8+ characters, with lowercase, uppercase, a digit, and one of `$ @ ! % * ? &`. Any other symbol is rejected. |
| `ZETARIS_ADMIN_ORG` | Your organisation name |
| `ZSPARK_DRIVER_MEM` | `2g` |
| `ZSPARK_DRIVER_CORES` | `2` |
| `ZSPARK_MASTER_URL` | `local[2]` |
| `ZETARIS_API_MAX_HEAP` | `1g` |
| `UI_PORT` | `3000` |
| `ALLOWED_ORIGINS` | `http://localhost:3000` |
| `GUI_URL` | `http://localhost:3000` |
| `COMPOSE_PROFILES` | Leave empty |
| `ZETARIS_SEED_TPCH` | `true` (loads the sample data) |

This is where you choose the admin email and password for **login 3**. The email can be your Gmail address, but the password is a new one you make up, following the rules above. If you leave the defaults, use the credentials from Step 7 of the Run locally page.

Choose the admin email, password and org name carefully. **Changing them in `.env` after the first start does not change the accounts that were already created.**

Then lock the file down and validate it:

```bash
chmod 600 .env
docker compose config --quiet
```

---

## Step 9 — Pull and start Zetaris

```bash
docker compose pull        # about 4 GB, usually 10–20 minutes
docker compose up -d       # 2–10 minutes, longer on Apple Silicon
docker compose ps --all
```

Setup keeps running for a few minutes after `up -d` returns. A healthy start looks like this; **Exited** and **Started** are both fine:

```
 ✔ Container zetaris-postgres-1    Healthy
 ✔ Container zetaris-init-1        Exited
 ✔ Container zetaris-driver-1      Healthy
 ✔ Container zetaris-api-1         Healthy
 ✔ Container zetaris-ui-1          Started
 ✔ Container zetaris-bootstrap-1   Started
```

Watch the startup logs, then run the verifier:

```bash
docker compose logs --tail=80 driver api bootstrap
./verify.sh
```

Zetaris is ready when all of these are true:

- `postgres`, `driver`, `api`, `ui` and `ai-datasteward` are running and healthy.
- `init` and `bootstrap` show **Exited (0)**. That's expected: they're one-time setup jobs.
- `./verify.sh` passes all checks.

If `bootstrap` is still running, wait for it to finish. If the UI checks fail just after bootstrap finishes, wait a minute and run `./verify.sh` again.

---

## Step 10 — Sign in and run a first query

1. Open http://localhost:3000 in your browser.
2. Sign in with the admin email and password from [Step 8](#step-8--edit-env-before-the-first-start), or from Step 7 of the Run locally page if you kept the defaults.
3. **Change the password** from the user menu. If you do, also update `ZETARIS_ADMIN_PASSWORD` in `.env`, otherwise `./verify.sh` fails its login check.
4. Open the **SQL Editor** and run:

   ```sql
   SELECT 1 AS one;
   ```

   You should get one row containing `1`. Zetaris is installed.

**Next:** to connect ResearchOS to this instance, follow [build-oct26/research-os/zetaris/README.md](../build-oct26/research-os/zetaris/README.md).

---

## Stop and restart

Run these from the `zetaris-platform` folder:

| Command | Effect |
|---|---|
| `docker compose stop` | Pause the containers, keeping data |
| `docker compose start` | Resume paused containers |
| `docker compose down` | Remove the containers, keeping data |
| `docker compose up -d` | Start again with the same data |
| `docker compose down -v` | ⚠️ **Deletes your data and the encryption keypair** |
| `docker compose down -v --rmi all` | ⚠️ The same, and also removes the ~10 GB of images |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `wsl --install` → `ERROR_ALREADY_EXISTS` | Ubuntu is already installed; open it from the Start menu ([Step 4](#step-4--set-up-ubuntu-on-wsl2-windows-only)) |
| `docker version` → `permission denied ... docker.sock` | Add your user to the `docker` group, then run `wsl --shutdown` ([Step 5.3](#53-if-you-get-permission-denied--dockersock)) |
| `docker version` has no **Server** section | Start Docker Desktop and turn on WSL Integration for Ubuntu ([Step 5.1](#51-turn-on-docker-for-ubuntu)) |
| `docker login` → `unauthorized: authentication required` | Use the registry credentials from Step 1 of the Run locally page, not your Ubuntu username or Google account |
| `preflight.sh` → `FAIL not signed in to zetarishackathon.azurecr.io` | Complete the registry sign-in ([Step 7](#step-7--sign-in-to-the-registry-and-run-the-preflight-check)) |
| Run locally page shows no registry command | Ask [Zetaris Support](https://www.zetaris.com/support) or the organisers to enable local install access |
| `preflight.sh` → memory WARN | Fine at 6 GB or more; 8 GB is recommended |
| `verify.sh` fails right after startup | Wait a minute and run it again |
| http://localhost:3000 doesn't open | Run `docker compose ps --all` and check that `ui` and `api` are running |
| Can't paste into Ubuntu | Use right-click or **Ctrl + Shift + V** |

For more help, see the getting-started [troubleshooting guide](https://github.com/zetaris/getting-started/blob/main/docs/guides/troubleshooting.md).
