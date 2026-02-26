# Developing Gridlook

This repository includes a production container (Nginx + built static assets),
a local dev container (Vite dev server), and a VS Code devcontainer setup.

## Requirements

- Docker Engine with Docker Compose
- Optional: VS Code + Dev Containers extension

## Production Container

Build and run the production image:

```sh
docker compose up --build -d app
```

Open:

- http://localhost:8080

Notes:

- The `app` service uses a multi-stage `Dockerfile`.
- Stage 1 builds the app with Node.js.
- Stage 2 serves `dist/` with Nginx on port `80`.
- Runtime defaults are read from `runtime-config.js` bundled into the image.
- To override runtime config from host without rebuilding, uncomment the
  `runtime-config.js` bind mount in `docker-compose.yml`.

### Runtime Configuration (no rebuild required)

Default behavior: edit `public/runtime-config.js` and rebuild app image:

```sh
docker compose up --build -d app
```

Example `public/runtime-config.js`:

```js
window.__GRIDLOOK_CONFIG__ = {
  defaultDatasetPath: "static/index_mr_eurec4a.json",
  defaultVariableName: "tas",
};
```

Host-override behavior (no rebuild): uncomment this in `docker-compose.yml`:

```yaml
# volumes:
#   - ./public/runtime-config.js:/usr/share/nginx/html/runtime-config.js:ro
```

Then recreate app:

```sh
docker compose up -d --force-recreate app
```

## Development Container (without VS Code)

Run the Vite dev server in a container with live reload:

```sh
docker compose up dev
```

Open:

- http://localhost:3000

Notes:

- Source code is mounted from your host (`.:/workspace`).
- `node_modules` is stored in a named Docker volume.

To use dynamic default dataset selection in dev, edit `public/runtime-config.js`
and compute `defaultDatasetPath` directly there.

## VS Code Dev Container

1. Open the repo in VS Code.
2. Run `Dev Containers: Reopen in Container`.
3. VS Code will attach to the `dev` service from `docker-compose.yml`.

After attach, the app is available on:

- http://localhost:3000

## Useful Commands

```sh
# Rebuild production image and run

docker compose up --build -d app

# Recreate app after runtime-config.js change

docker compose up -d --force-recreate app

# Stop containers

docker compose down

# Remove containers + named volumes (including dev node_modules)

docker compose down -v
```

## Publish Production Image (GHCR)

Build and push an image to GitHub Container Registry (`ghcr.io`):

```sh
gh auth refresh -h github.com -s write:packages,read:packages,repo
gh auth token | docker login ghcr.io -u "$(gh api user --jq .login)" --password-stdin

# Create/use a buildx builder once
docker buildx create --use --name gridlook-builder || docker buildx use gridlook-builder

# Recommended: publish a multi-platform image (amd64 + arm64)
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t ghcr.io/leifdenby/gridlook/gridlook-app:2026-02-25 \
  --push .
```

If you only target amd64 (for example most EC2 instances), use:

```sh
docker buildx build \
  --platform linux/amd64 \
  -t ghcr.io/leifdenby/gridlook/gridlook-app:2026-02-25 \
  --push .
```

If push fails with:

`permission_denied: The token provided does not match expected scopes`

refresh `gh` auth with package scopes again:

```sh
gh auth refresh -h github.com -s write:packages,read:packages,repo
```
