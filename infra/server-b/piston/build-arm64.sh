#!/usr/bin/env bash
# Build Piston (API image + language packages) for linux/arm64 on Server B.
#
# Why: the upstream image ghcr.io/engineer-man/piston is amd64-only and the
# upstream package index ships x86-64 binaries ("Exec format error" on ARM).
# Both Dockerfiles are based on Debian buster (EOL), so apt must point at
# archive.debian.org. This script patches copies of the Dockerfiles, never the
# checked-out files, and builds packages locally.
#
# Usage:  ./build-arm64.sh [package ...]      e.g. ./build-arm64.sh python-3.12.0 node-18.15.0
# Result: image piston-api:arm64, packages extracted into $DATA/packages.
# Timings measured on A1.Flex 2 OCPU: API image 4 min, builder image 4.5 min,
# node 18 ~0.5 min, java 15 ~1 min, python 3.12 (+numpy/pandas/scipy) ~4 min,
# gcc 10.2 (C/C++ only) 22.5 min. Disk: ~2.7 GB of packages for these four.
set -euo pipefail

SRC=${SRC:-/opt/piston-src}                 # git checkout of engineer-man/piston
DATA=${DATA:-/srv/piston}                   # bind-mounted into the API container
PISTON_REF=${PISTON_REF:-de2b365}           # commit tested in the 2026-09-25 spike
PACKAGES=("$@")
[ ${#PACKAGES[@]} -eq 0 ] && PACKAGES=(python-3.12.0 node-18.15.0 java-15.0.2 gcc-10.2.0)

if [ ! -d "$SRC/.git" ]; then
  sudo git clone https://github.com/engineer-man/piston "$SRC"
  sudo chown -R "$USER" "$SRC"
fi
git -C "$SRC" checkout -q "$PISTON_REF"

ARCHIVE_FIX='RUN printf "deb http://archive.debian.org/debian buster main\\ndeb http://archive.debian.org/debian-security buster/updates main\\n" > /etc/apt/sources.list \&\& echo "Acquire::Check-Valid-Until false;" > /etc/apt/apt.conf.d/99archive'

# 1. API image (includes the cgroup-v2 isolate fork envicutor/isolate)
if [ -z "${REBUILD_IMAGES:-}" ] && docker image inspect piston-api:arm64 >/dev/null 2>&1; then
  echo "piston-api:arm64 exists (REBUILD_IMAGES=1 to rebuild)"
else
  sed -e "s|^FROM buildpack-deps:buster AS isolate|&\n$ARCHIVE_FIX|" \
      -e "s|^FROM node:15.10.0-buster-slim|&\n$ARCHIVE_FIX|" \
      "$SRC/api/Dockerfile" > "$SRC/api/Dockerfile.arm64"
  docker build -f "$SRC/api/Dockerfile.arm64" -t piston-api:arm64 "$SRC/api"
fi

# 2. Package builder image
if [ -z "${REBUILD_IMAGES:-}" ] && docker image inspect piston-builder:arm64 >/dev/null 2>&1; then
  echo "piston-builder:arm64 exists (REBUILD_IMAGES=1 to rebuild)"
else
  sed -e "s|^FROM debian:buster-slim|&\n$ARCHIVE_FIX|" \
      -e "s|linux-headers-amd64|linux-headers-arm64|" \
      "$SRC/repo/Dockerfile" > "$SRC/repo/Dockerfile.arm64"
  docker build -f "$SRC/repo/Dockerfile.arm64" -t piston-builder:arm64 "$SRC/repo"
fi

# 3. Switch recipes to arm64 downloads / source builds (see patch-recipes-arm64.sh)
"$(dirname "$0")/patch-recipes-arm64.sh" "$SRC"

# 4. Build packages (*.pkg.tar.gz in $SRC/packages)
docker run --rm -v "$SRC:/piston" piston-builder:arm64 "${PACKAGES[@]}" --no-server
sudo chown -R "$(id -u):$(id -g)" "$SRC"   # the builder writes as root

# 5. Install into the API data dir (what `ppman install` would do)
sudo mkdir -p "$DATA/packages"
for p in "${PACKAGES[@]}"; do
  lang=${p%-*}; ver=${p##*-}
  dest="$DATA/packages/$lang/$ver"
  sudo rm -rf "$dest"; sudo mkdir -p "$dest"
  if [ ! -f "$SRC/packages/$p.pkg.tar.gz" ]; then echo "SKIP $p: build failed (see log)"; continue; fi
  sudo tar xzf "$SRC/packages/$p.pkg.tar.gz" -C "$dest"
  # Cache the runtime environment and mark as installed
  sudo bash -c "cd '$dest' && env -i bash -c 'source environment; env' \
    | grep -vE '^(PWD|OLDPWD|_|SHLVL)=' | sed 's|$DATA/|/piston/|g' > .env && date +%s000 > .ppman-installed"
  # (.env paths must be the container's /piston/..., not the host's $DATA/...)
  # Drop the build output left in the recipe dir (the .pkg.tar.gz is kept)
  git -C "$SRC" clean -fdxq "packages/$lang/$ver" || true
done
echo "Done. Restart the API so it loads the packages:  docker compose restart piston"
