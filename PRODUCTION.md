# Production Deployment

This document describes running Gridlook behind Traefik with TLS on:

- `https://dmidev.org/dini`

The Compose setup uses label-based Traefik configuration in
`docker-compose.prod.yml`.

## What This Setup Does

- Runs `traefik` as reverse proxy and TLS terminator.
- Routes `Host(dmidev.org)` + `PathPrefix(/dini)` to the `app` service.
- Strips `/dini` before forwarding traffic to the app container.
- Redirects all HTTP traffic on port 80 to HTTPS on port 443.
- Uses Let's Encrypt via ACME HTTP challenge.

## Prerequisites

- DNS A/AAAA record for `dmidev.org` points to this server.
- Ports `80` and `443` are open inbound.
- Docker Engine + Docker Compose v2 plugin installed.
- A valid ACME contact email address.

## Runtime Configuration

The app reads runtime defaults from container environment variables:

- `GRIDLOOK_DEFAULT_DATASET_PATH`
- `GRIDLOOK_DEFAULT_VARIABLE_NAME`

These are written into `runtime-config.js` when the app container starts.

Before deployment, ensure the image tag in `GRIDLOOK_APP_IMAGE` exists in GHCR
and includes an amd64 variant (or a multi-platform manifest including amd64).
Recommended publish command:

```sh
docker buildx create --use --name gridlook-builder || docker buildx use gridlook-builder
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t ghcr.io/leifdenby/gridlook/gridlook-app:2026-02-25 \
  --push .
```

Example `.env.prod`:

```sh
TRAEFIK_ACME_EMAIL=ops@dmidev.org
GRIDLOOK_DEFAULT_DATASET_PATH=https://harmonie-zarr.s3.amazonaws.com/dini/control/2026-02-25T030000Z/single_levels.zarr
GRIDLOOK_DEFAULT_VARIABLE_NAME=
```

## Start / Update

Pull and start Traefik + app:

```sh
docker compose -f docker-compose.prod.yml --env-file .env.prod pull app
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d traefik app
```

Update runtime config values without rebuilding image:

```sh
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --force-recreate app
```

## Verify

Check containers:

```sh
docker compose -f docker-compose.prod.yml ps
```

Check runtime config rendered in container:

```sh
docker compose -f docker-compose.prod.yml exec app sh -lc 'cat /usr/share/nginx/html/runtime-config.js'
```

Test redirect and HTTPS routing:

```sh
curl -I http://dmidev.org/dini
curl -I https://dmidev.org/dini
```

Expected behavior:

- `http://dmidev.org/dini` returns a redirect to HTTPS.
- `https://dmidev.org/dini` returns app content.

## Notes

- `runtime-config.js` is configured as non-cacheable in Nginx.
- ACME cert state is persisted in the `letsencrypt` named volume.
- Traefik config is fully defined in `docker-compose.prod.yml` labels and
  command args.
- The production compose file defines which image tag is used (`GRIDLOOK_APP_IMAGE`).

## Fresh EC2 Setup (Amazon Linux 2023)

Run these steps on a clean EC2 instance.

### 1. Install dependencies

```sh
sudo dnf update -y
sudo dnf install -y git docker
```

### 2. Enable Docker

```sh
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
newgrp docker
docker version
docker compose version || echo "docker compose missing"
```

If Compose plugin is missing, install it:

```sh
sudo dnf install -y docker-compose-plugin
docker compose version
```

If `docker-compose-plugin` is not available via `dnf`, install manually:

```sh
ARCH=$(uname -m)
case "$ARCH" in
  x86_64) BIN=docker-compose-linux-x86_64 ;;
  aarch64|arm64) BIN=docker-compose-linux-aarch64 ;;
  *) echo "Unsupported arch: $ARCH"; exit 1 ;;
esac

sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -SL "https://github.com/docker/compose/releases/latest/download/${BIN}" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

docker compose version
```

If you see `compose build requires buildx 0.17.0 or later`, install/update
Buildx manually:

```sh
docker buildx version || true

ARCH=$(uname -m)
case "$ARCH" in
  x86_64) BIN=buildx-v0.21.2.linux-amd64 ;;
  aarch64|arm64) BIN=buildx-v0.21.2.linux-arm64 ;;
  *) echo "Unsupported arch: $ARCH"; exit 1 ;;
esac

sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -SL "https://github.com/docker/buildx/releases/download/v0.21.2/${BIN}" \
  -o /usr/local/lib/docker/cli-plugins/docker-buildx
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-buildx

docker buildx version
```

### 3. Configure AWS networking

In the EC2 security group, allow inbound:

- `80/tcp` from `0.0.0.0/0`
- `443/tcp` from `0.0.0.0/0`

### 4. Configure DNS

Point `dmidev.org` (A/AAAA records) to the EC2 public IP.

### 5. Clone repository

```sh
git clone <your-repo-url> gridlook
cd gridlook
```

### 6. Create production env file

```sh
cat > .env.prod <<'EOF'
TRAEFIK_ACME_EMAIL=ops@dmidev.org
GRIDLOOK_APP_IMAGE=ghcr.io/leifdenby/gridlook/gridlook-app:2026-02-25
GRIDLOOK_DEFAULT_DATASET_PATH=https://harmonie-zarr.s3.amazonaws.com/dini/control/2026-02-25T030000Z/single_levels.zarr
GRIDLOOK_DEFAULT_VARIABLE_NAME=
EOF
```

### 7. Start services

```sh
docker compose -f docker-compose.prod.yml --env-file .env.prod pull app
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d traefik app
```

### 8. Verify deployment

```sh
docker compose -f docker-compose.prod.yml ps
curl -I http://dmidev.org/dini
curl -I https://dmidev.org/dini
```

Expected:

- HTTP redirects to HTTPS.
- HTTPS serves Gridlook at `/dini`.

### 9. Update runtime dataset/variable later (no rebuild)

After editing `.env.prod`:

```sh
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --force-recreate app
```
