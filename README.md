# APBJA member app

(This app lives in the `apbja-app` branch of this repository. It has nothing to do with the reporter page on `main`.)

AP Broadcast Journalists Association member app: login by mobile number, district Presidents, approvals,
designations, Heads, messages and member ID cards.

- `public/index.html`: the app screens. **Push a change to the `apbja-app` branch and it is live within 2 minutes** (no new APK needed).
- `server/`: the APBJA server (Node 22, no packages). It runs in Docker on the Hostinger VPS as project `apbja`,
  port 8473, and touches nothing else on the server.
  - Data (database, photos, 30 daily backups) is in `/var/lib/apbja` on the VPS, **never in Git**.
  - `run.sh` pulls this repository every 2 minutes and restarts the server only when `server/` changed.
- `android/`: the Android app. It opens the server full screen. Pushing a change under `android/` builds a new APK:
  https://raw.githubusercontent.com/Mavytechsolutions/newsdesk-reporter/apbja-build/APBJA.apk
  (also reachable from the server at `/download`).
- `docker-compose.yml`: how the server is started on the VPS.

Testing: the OTP is 1234 for every number (no SMS yet). Admin login: 9959959524.
