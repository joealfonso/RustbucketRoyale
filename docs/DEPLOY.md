# Deploying

The game runs on Fly.io as one machine that serves the page and the game from one address (M10). `fly.toml` holds the
settings; `Dockerfile` builds the image on Fly's builders, so Docker is not needed on your computer.

## Free and quick: your Mac and a Cloudflare tunnel
For a game night or the 10b check, no account and no card. Your Mac is the server, so it must stay awake.
1. Once: `brew install cloudflared`.
2. `npm run build && npm start` (the production server on port 8080; `PORT=8090 npm start` to keep 8080 free for
   development).
3. In a second terminal: `cloudflared tunnel --url http://localhost:8080` (or 8090). It prints an
   `https://....trycloudflare.com` address: send that. The game connects back through it over wss; the origin check
   passes as it is (checked 2026-10-19).
4. Ctrl+C both when done. The address is new each time.

## One time, by Joseph (needs your account)
1. Install the Fly command line: `brew install flyctl`.
2. Sign up or log in: `fly auth signup` (or `fly auth login`). Fly asks for a card.
3. Make the app: `fly apps create rustbucket-royale`. If the name is taken, pick another and change `app` in
   `fly.toml` to match.
4. Pick the region nearest you and your friends: `fly platform regions`, then set `primary_region` in `fly.toml`.
   It says `iad` (US east) as a guess.
5. First deploy, from the repo folder: `git lfs pull`, then `fly deploy --ha=false`. `--ha=false` matters: rooms live
   in one machine's memory, and Fly makes two machines on a first deploy without it.
6. Open `https://<app name>.fly.dev`. Create a room and send the invite link to another device.
7. Set a spending alert under Billing in the Fly dashboard. One `shared-cpu-1x` machine with 1 GB costs about $6 a
   month if it never sleeps; it sleeps when nobody is on it, so expect less.

## Deploys from CI after that
1. Make a deploy token: `fly tokens create deploy -x 8760h` (a year).
2. Add it to GitHub as an Actions secret named `FLY_API_TOKEN`: repo Settings, Secrets and variables, Actions, or
   `gh secret set FLY_API_TOKEN` and paste it. Never put it in the repo.
3. Every push to `main` that passes the gauntlet now deploys (the `deploy` job in `.github/workflows/ci.yml`).
   Without the secret the job says so and skips.

A deploy restarts the machine, which ends any match in progress. Deploy when nobody is playing.

## Looking at it
- `fly logs`: the server's log. A line a minute says how many rooms are open; nothing about who is playing.
- `fly status`: the machine and its health check (`/health`).
- `curl https://<app name>.fly.dev/health`: `{"ok":true,"rooms":N}`.

## Never
- Set `DEV_TUNING` on Fly: the server refuses to start with it in production.
- Scale past one machine (`fly scale count`) before rooms are routed to the machine that holds them.
