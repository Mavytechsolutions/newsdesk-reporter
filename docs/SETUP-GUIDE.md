# MAVY NEWS: How to run the server on your computer

## ⭐ Already online (Hostinger VPS)

| What | Address |
|---|---|
| **Download the app (APK)** | http://194.238.17.81:8475 (open on your phone) |
| **Newsroom (add stories)** | http://194.238.17.81:8474/newsroom |
| News server | http://194.238.17.81:8474/api/v1/health |
| Newsroom admin login | admin@mavynews.in (password: in hPanel → VPS → Docker Manager → **mavy-news** → Environment → `ADMIN_PASSWORD`) |

* These run in their own Docker projects, **mavy-news** (server + database) and **mavy-apk** (app builder + download page), separate from apbja and rentipa.
* **To build a new APK after code changes:** hPanel → VPS → Docker Manager → **mavy-apk** → Restart. Wait about 20 minutes, then the download page shows the new version.
* **To update the server after code changes:** restart **mavy-news**. It downloads the latest code from GitHub (branch `mavy-news-app` of `newsdesk-reporter`).
* **Login OTP (until real SMS is set up):** open **mavy-news** → Logs and look for `DEV OTP`.

---


You only need to do the **one-time setup** once. After that, use **"Every day"**.

---

## One-time setup (about 20 minutes)

**1. Install two free programs**

* **Node.js** (version 22 LTS) from https://nodejs.org. Click the big green "LTS" button and install it.
* **Docker Desktop** from https://www.docker.com/products/docker-desktop. Install it, then open it once and leave it running.

**2. Unzip the project**

Unzip `mavy-news.zip` into a folder you will remember, for example `Documents\mavy-news`.

**3. Open a terminal inside the project**

* **Windows:** open the `mavy-news` folder, click the address bar, type `cmd`, press Enter.
* **Mac:** right-click the `mavy-news` folder and choose "New Terminal at Folder".

**4. Copy and paste these commands one at a time** (press Enter after each, and wait for it to finish):

```
docker compose -f infra/docker-compose.yml up -d
cd apps/api
npm install
copy .env.example .env
npm run db:migrate
npm run db:seed
```

> On **Mac**, use `cp .env.example .env` instead of the `copy` line.

You should see ✔ marks: *Database is up to date*, *Locations: 91*, *Categories: 16*, *Super Admin created*.

**5. Admin login**

The newsroom admin is `admin@mavynews.in` with the password from `SEED_ADMIN_PASSWORD` in `apps/api/.env`.
On a real (online) server, open `.env` in Notepad and change that password **before** running `npm run db:seed`.

---

## Every day: start the server

Open a terminal in `mavy-news/apps/api` and type:

```
npm run dev
```

When you see **"✔ MAVY NEWS API running"**, open this link in your browser:
http://localhost:4000/api/v1/health

If it shows `"status":"ok"`, the server is working. To see news: http://localhost:4000/api/v1/articles

To stop the server, press **Ctrl + C** in the terminal.

---

## Open the MAVY NEWS app on your phone

Your phone and computer must be on the **same Wi-Fi**.

**One time:**

1. On your Android phone, install **Expo Go** from the Play Store. On iPhone, install it from the App Store.
2. Find your computer's Wi-Fi address:
   * **Windows:** open a terminal, type `ipconfig` and look for **IPv4 Address**, for example `192.168.1.10`.
   * **Mac:** System Settings → Wi-Fi → Details → **IP address**.
3. Open a terminal in `mavy-news/apps/mobile` and type:
   ```
   npm install
   copy .env.example .env
   ```
   (Mac: `cp .env.example .env`)
4. Open `apps/mobile/.env` in Notepad. Replace `192.168.1.10` with **your** address from step 2 and save the file.

**Every time:**

1. Start the server first, as in "Every day" above (keep that window open).
2. Open a **second** terminal in `mavy-news/apps/mobile` and type:
   ```
   npx expo start
   ```
3. A **QR code** appears. On Android, open Expo Go and tap "Scan QR code". On iPhone, use the Camera app.
4. The MAVY NEWS app opens on your phone. The first time it asks for your language and places.

> If Windows asks "Allow Node.js on networks?", click **Allow**. Otherwise the phone cannot reach the server.
> The login OTP appears in the **server** window (yellow "DEV OTP" line) until real SMS is switched on.

---

## Make the APK file (install the app without Expo Go)

This builds the real app on Expo's free cloud computers. It takes about 15–25 minutes, and you only wait.

1. Create a free account at **https://expo.dev/signup** (email + password).
2. Open a terminal in `mavy-news/apps/mobile` and type these one at a time:
   ```
   npm install
   npx eas-cli login
   npx eas-cli build -p android --profile preview
   ```
   * At `login`, type your Expo email and password.
   * If it asks **"Generate a new Android Keystore?"**, press **Y** (yes).
   * If it asks to create a project, press **Y**.
3. When it finishes, it shows a **link and a QR code**. Open the link on your phone, then download and install the APK.
   (Android may ask to "Allow installing from this source". Allow it.)

**Connect the installed app to your server:**

1. Start the server on your computer ("Every day" above). Phone and computer must be on the same Wi-Fi.
2. In the app, go to **Profile → Server address**. If the app can't connect on first launch, the box also appears there.
3. Type your computer's Wi-Fi address with `:4000`, for example `http://192.168.1.10:4000`.
4. Tap **Test & save**. When it shows **Connected ✓**, the news loads.

> This testing APK talks to the server on your computer. For the public release, the server will run on an online host with an `https://` address, and that address will be built into the app.

---

## Check that everything works (automatic tests)

```
npm test
```

You should see **38 passed**.

---

## If something goes wrong

| You see | What to do |
|---|---|
| `docker: command not found` | Open Docker Desktop first, wait until it says "running", then try again |
| `ECONNREFUSED 5432` | The database is not running. Run the `docker compose ... up -d` line again |
| `Missing required setting` | You skipped `copy .env.example .env`. Run it, then try again |
| A login OTP during testing | In development the OTP is printed in the server window (yellow "DEV OTP" line) |
