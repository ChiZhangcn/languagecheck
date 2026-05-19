# LanguageCheck Deployment

This package is a Node.js/Express web app. The browser UI is served from `public/`, and the font parsing API is served by `src/server.js`.

## Server Setup

1. Install Node.js 20 or newer.
2. Extract the package:

```bash
tar -xzf languagecheck-server.tar.gz
cd languagecheck-server
```

3. Install production dependencies:

```bash
npm ci --omit=dev
```

4. Start the app on localhost:

```bash
HOST=127.0.0.1 PORT=3000 npm start
```

5. Check health:

```bash
curl http://127.0.0.1:3000/api/health
```

## nginx

Use `deploy/nginx-languagecheck.conf` as a starting point. Update `server_name` to your domain, then reload nginx.

The app upload limit is 20 MB, so nginx should set `client_max_body_size 25m` or higher.

## Process Manager

For production, run the Node app with a process manager such as `systemd`, `pm2`, or your server platform's supervisor. Keep nginx as the public entry point and bind the Node app to `127.0.0.1`.
