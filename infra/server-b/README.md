# Server B — code execution, workers, staging, backups

Server B is an Oracle Cloud VM in a **separate tenancy** (the owner's
brother's account), linked to Server A (production) by a WireGuard tunnel.
It has **no public ports except SSH**. Nothing here contains secrets: tokens,
keys and passwords live only on the servers (`.env`, `/etc/wireguard/*.key`).

| | |
|---|---|
| Shape | VM.Standard.A1.Flex (**arm64 / aarch64**), 2 OCPU / 12 GB / 45 GB boot volume (resize to 4 OCPU / 24 GB / 100 GB planned) |
| Region | af-johannesburg-1 |
| OS | Ubuntu 24.04.5 LTS, kernel 6.17 (`linux-oracle`), systemd 255, **cgroup v2 only** |
| Public IP | see the Oracle console (not recorded here) |
| Tunnel IP | **10.66.0.2** (Server A is 10.66.0.1) |
| Login | `ssh -i <key> ubuntu@<public-ip>` (key only, password auth off, passwordless sudo) |

## What runs on B

| Service | Status | Listens on |
|---|---|---|
| WireGuard `wg-quick@wg0` | ✅ live | UDP 51820 (from A's IP only) |
| Backup target (`vbbackup` user) | ✅ live | SSH, from 10.66.0.1 only |
| Code execution (Piston + Judge0-compatible adapter) | ✅ live (see §4 "Deployed on B") | adapter `10.66.0.2:2358`, Piston `127.0.0.1:2000` |
| `transcode-worker` (HLS) | ⏳ needs files in R2 first | — (pulls from Redis on A) |
| LiveKit Egress (recordings) | ⏳ needs R2 | — |
| Staging (`staging.validbridge.co.ke`) | ⏳ | via Cloudflare Tunnel or A's nginx |

Installed on 2026-09-25: Docker Engine 29.8.1 (official Docker apt repo,
arm64) with Compose v5.5.1 and buildx, `wireguard-tools` 1.0.20210914,
unattended security upgrades (already on in the Oracle image:
`/etc/apt/apt.conf.d/20auto-upgrades`). `ubuntu` is in the `docker` group.

Code execution: images `piston-api:arm64`, `piston-builder:arm64`,
`validbridge/judge0-compat:latest`; patched Piston checkout `/opt/piston-src`
(commit `de2b365`); language packages in `/srv/piston/packages`; compose
project in `/opt/validbridge/piston`; token in `/etc/validbridge/judge0-compat.env`.
Build logs in `~ubuntu/build-logs/` and `~ubuntu/spike-logs/`.

---

## 1. Set up B from scratch

```bash
# Docker Engine + compose plugin (official repo, arm64)
sudo apt-get update && sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
  wireguard-tools unattended-upgrades
sudo usermod -aG docker ubuntu
sudo dpkg-reconfigure -f noninteractive unattended-upgrades   # security upgrades on

# Docker must start after the tunnel (containers bind 10.66.0.2)
sudo mkdir -p /etc/systemd/system/docker.service.d
sudo cp systemd/docker-after-wireguard.conf /etc/systemd/system/docker.service.d/10-after-wireguard.conf
sudo systemctl daemon-reload
```

> **Docker and the firewall.** Ports published by Docker skip the host's
> `INPUT` rules. The bind address is the real firewall: always publish as
> `10.66.0.2:PORT:PORT` or `127.0.0.1:PORT:PORT`, never `PORT:PORT`.

## 2. WireGuard (live)

Templates: [`wireguard/wg0.server-b.conf.example`](wireguard/wg0.server-b.conf.example),
[`wireguard/wg0.server-a.conf.example`](wireguard/wg0.server-a.conf.example).

- B is `10.66.0.2/24`, A is `10.66.0.1/24`, both `ListenPort = 51820`.
- Private key: `/etc/wireguard/private.key` (root, 600), loaded by
  `PostUp = wg set %i private-key /etc/wireguard/private.key`, so `wg0.conf`
  holds no secret. Public key beside it in `public.key`.
- B's peer entry points at A's public IP, `AllowedIPs = 10.66.0.1/32`,
  `PersistentKeepalive = 25`.
- `systemctl enable --now wg-quick@wg0` on both servers.
- iptables on B (saved, survives reboot), in `INPUT` before the final REJECT:
  - `-s <A public IP>/32 -p udp --dport 51820 -j ACCEPT`
  - `-i wg0 -s 10.66.0.1/32 -j ACCEPT`
  - SSH 22/tcp, established, ICMP, loopback (Oracle image defaults)
- Oracle security lists: A allows UDP 51820 from B's IP; B allows UDP 51820
  from A's IP (`84.12.116.16/32`).
- Check: `sudo wg show` (recent handshake) and `ping -c3 10.66.0.1`.
- Server C later: new peer `10.66.0.3/32` on A; C gets A as its only peer.

## 3. Backups (live)

A pushes backups to B over the tunnel as user **`vbbackup`**
(system user, home `/srv/validbridge-backups`, mode 750):

- `~vbbackup/.ssh/authorized_keys` holds A's backup key, restricted:
  `from="10.66.0.1",no-agent-forwarding,no-port-forwarding,no-pty,no-X11-forwarding`.
- `db/` — nightly `pg_dump` custom-format files
  `validbridge-<UTC timestamp>.dump` (dir mode 700).
- `content/` — rsync mirror of A's content store (`orgs/`, `users/`).
- The schedule, retention and the script live on **A** (the pusher); B only
  receives. Leave the user and the directory alone when changing B.
- Planned (W10.9): encrypted copies to R2 bucket `validbridge-backups` with a
  30-day lifecycle, and a **weekly restore test on B**:
  `docker run --rm -e POSTGRES_PASSWORD=x -d --name restore-test postgres:16`,
  `pg_restore` the newest dump into it, run a row-count check, remove it.

---

## 4. Code execution: Judge0 vs Piston (spike 2026-09-25)

The API (`apps/api/src/routers/code_execution.py`) speaks the Judge0 CE API.
The question was whether Judge0 can run on this ARM box.

### Findings

**Judge0 official images are amd64 only.**

```
$ curl -s https://hub.docker.com/v2/repositories/judge0/judge0/tags  → every tag (1.12.0 … 1.13.1, latest, -extra): ['amd64']
$ … judge0/compilers tags (1.3.0 … 1.6.0-extra, latest):              ['amd64']
$ … judge0/buildpack-deps (base of compilers):                          ['amd64']
$ docker run --rm judge0/judge0:1.13.1 uname -m
WARNING: The requested image's platform (linux/amd64) does not match the detected host platform (linux/arm64/v8)
exec /api/docker-entrypoint.sh: exec format error
```
(The image is 14.2 GB; no qemu/binfmt is installed, and emulating a sandbox
would be far too slow anyway.) The pulled image was removed.

**Building Judge0 for arm64 from source is not realistic on B.**
`judge0/compilers` (549-line Dockerfile, last changed 2021) runs **31
from-source `make` builds** (three GCC versions 7.4/8.3/9.2, several Pythons,
Rubies, Octave, …) and **9 hard-coded x86-64 binary downloads** (OpenJDK,
FPC, GHC, Rust, Go, FreeBASIC, .NET, …) on a Debian buster base whose
package mirror is gone (buster is EOL: `apt-get update` → 404, needs
`archive.debian.org`). Every x86 download must be rewritten for aarch64, and
the three GCC builds alone take hours on 2 OCPU. Judge0's language table
(`db/languages`) hard-codes the resulting `/usr/local/<lang>-<ver>` paths, so
a reduced image means maintaining a fork of both repos.

**Judge0's sandbox needs cgroup v1, and this kernel cannot provide it.**
Judge0 1.13.1 pins `judge0/isolate@ad39cc4` (isolate 1.8.1). Built for arm64
on B and run privileged:

```
$ isolate --version          → The process isolator 1.8.1
$ isolate --cg -b 0 --init   → Failed to create control group /sys/fs/cgroup/memory/box-0/: No such file or directory   (exit 2)
$ isolate -b 1 --init        → /var/local/lib/isolate/1   (exit 0, no cgroups)
$ grep MEMCG /boot/config-$(uname -r)
CONFIG_MEMCG=y
# CONFIG_MEMCG_V1 is not set
# CONFIG_CPUSETS_V1 is not set
```
Judge0's own instructions (CHANGELOG v1.13.1) add
`systemd.unified_cgroup_hierarchy=0` to GRUB. **On B that is not enough**:
kernel 6.17 is built without the cgroup-v1 memory controller (optional since
Linux 6.11), so after the reboot there would still be no
`/sys/fs/cgroup/memory`. It would also need the 6.8 kernel
(`linux-image-oracle-6.8`, still in the archive) pinned as default. See
"Judge0 host prerequisites" below; **not applied**.

(Judge0 skips `--cg` when both `ENABLE_PER_PROCESS_AND_THREAD_TIME_LIMIT` and
`..._MEMORY_LIMIT` are true, so it could run on cgroup v2 with rlimit-only
memory limits, which break the JVM and Go. It still needs arm64 images, so
this does not help.)

**Piston runs on B today, on cgroup v2, without a reboot.**
Piston uses a cgroup-v2 isolate fork (`envicutor/isolate`); its entrypoint
refuses hybrid mode and wants pure v2, which is what B has. Upstream
`ghcr.io/engineer-man/piston` is also amd64-only, and the upstream package
index ships x86 binaries:

```
POST /api/v2/packages {"language":"node","version":"18.15.0"}   (upstream index)
→ run: "/piston/packages/node/18.15.0/bin/node: cannot execute binary file: Exec format error"
```

but both images build natively for arm64 once apt points at
archive.debian.org (`piston/build-arm64.sh`):

| Step (2 OCPU A1) | Time | Size |
|---|---|---|
| API image `piston-api:arm64` | 4 min | 1.3 GB |
| Package builder image | 4.5 min | 1.75 GB |
| node 18.15.0 (arm64 tarball) | ~0.5 min | 162 MB installed |
| java 15.0.2 (aarch64 JDK) | ~1 min | 270 MB |
| python 3.12.0 from source + numpy/pandas/scipy wheels | ~4 min | 815 MB |
| gcc 10.2.0 (C, C++ only) from source | 22.5 min | 1.4 GB (464 MB package) |

Tests against the arm64 Piston (limits: CPU 3 s, wall 5 s, 256 MB, network off):

| Test | Result |
|---|---|
| Python hello + stdin | `hello aarch64 world`, 38 ms CPU |
| Node hello | `hello arm64`, 122 ms CPU |
| Java hello (`Main.java`) | `hello aarch64`, 1.2 s CPU, 49 MB |
| Python `while True: pass`, `run_cpu_time=2000` | SIGKILL, status `TO`, cpu 2095 ms |
| Node `for(;;){}`, `run_cpu_time=1000` | SIGKILL, status `TO`, cpu 1090 ms |
| Python allocate 1 GB | killed (exit 137) at 256 MB |
| Python `urlopen("http://1.1.1.1")` | connection fails (no network) |
| Python fork 1000× | `BlockingIOError: [Errno 11]` (process limit) |
| Python syntax error / Java compile error | stderr + exit 1 |
| Python `sqlite3` + `numpy` | works (numpy 2.5.3) |
| C hello + stdin / C++ hello | `hello arm` / `hello c++`, 3–10 ms CPU |
| C compile error | compile stage `code 1`, gcc diagnostics in `compile.output` |
| C `for(;;)`, `run_cpu_time=1000` | SIGKILL, status `TO`, cpu 1092 ms |
| C null-pointer dereference | run `code 139` (128+SIGSEGV), `signal` null |
| 8 parallel Python runs | 366 ms total; single hello ≈ 50 ms round trip |

### Decision: **(b) Piston + a Judge0-compatible adapter**, on B

| Option | Works on B now | Cost | Effort / risk |
|---|---|---|---|
| (a) Judge0 built for arm64 + cgroup v1 | ❌ needs kernel downgrade to 6.8 + GRUB change + reboot, console access unconfirmed | free (A1) | Fork of judge0/compilers: 31 source builds, 9 x86 downloads, EOL base; many hours of builds per change; cgroup v1 is being removed from systemd (v256+) and kernels |
| **(b) Piston arm64 + adapter** | ✅ tested today, cgroup v2, no reboot | free (A1) | Build each language package for arm64 (most are source builds or have official aarch64 tarballs); write and own a small adapter (~300 lines) |
| (c) Small x86 Oracle shape + official Judge0 | ✅ on a new VM (fresh VM can take the GRUB change + reboot) | ~USD 25–35 / month (1 OCPU E4/E5.Flex, 8 GB, 50 GB; check the Oracle price list) | Least code; another VM to patch; a second tunnel peer; Judge0 1.13.1 image is 14 GB and last released 2024 |

Why (b): it is the only option that runs on the free ARM box without a risky
reboot, it uses the kernel's supported cgroup v2 path, sandbox limits were
verified on this machine, and the API keeps speaking Judge0 (no change to
`code_execution.py` or `assignments.py`). Keep (c) as the fallback if a
language we need cannot be built for arm64: the adapter would then simply
forward to a real Judge0.

### Deployed on B (2026-09-25)

Compose project `validbridge-code` in `/opt/validbridge/piston`
(copy of `infra/server-b/piston` + `infra/server-b/judge0-compat`):

| Container | Image | Listens on | Limits |
|---|---|---|---|
| `judge0-compat` | `validbridge/judge0-compat:latest` (built from `judge0-compat/`, Python 3.12 + FastAPI) | **`10.66.0.2:2358`** only | 0.5 CPU, 256 MB, 128 pids, read-only, no capabilities |
| `piston` | `piston-api:arm64` (Piston `de2b365` + cgroup-v2 isolate) | `127.0.0.1:2000` only | 1.8 CPU, 6 GB, 4096 pids; per run 3 s CPU / 5 s wall / 256 MB (overrides for JVM, Dart, PowerShell, compilers in `piston.env`); **no network in the sandbox** |

Both `restart: unless-stopped`. Docker waits for WireGuard via
`/etc/systemd/system/docker.service.d/10-after-wireguard.conf`.
Port 2358 is not reachable on the public IP (it is bound to the tunnel IP only).

**Token.** `/etc/validbridge/judge0-compat.env` (root, `600`; dir `700`)
holds `JUDGE0_COMPAT_TOKEN=<64 hex>`. It exists only there and in the API's
env on A. Because the file is root-only, run compose with `sudo`.

**Server A env** (API):
```
VALIDBRIDGE_JUDGE0_API_URL=http://10.66.0.2:2358
VALIDBRIDGE_JUDGE0_CLIENT_SECRET=<value of JUDGE0_COMPAT_TOKEN>
# VALIDBRIDGE_JUDGE0_CLIENT_ID is optional and ignored by the adapter
```
Copy without printing it, e.g. from a machine with both keys:
`ssh B "sudo sed -n 's/^JUDGE0_COMPAT_TOKEN=//p' /etc/validbridge/judge0-compat.env" | ssh A '…append as VALIDBRIDGE_JUDGE0_CLIENT_SECRET to the API env file…'`.

#### What the adapter implements

Code: `judge0-compat/app/` (`core.py` = pure mapping, `main.py` = HTTP,
`languages.py` = ID table). Tests: `judge0-compat/tests/` (pytest, 43 tests):
`docker build --build-arg WITH_TESTS=1 -t jc-test judge0-compat && docker run --rm jc-test python -m pytest -q tests`.

- **Auth:** `X-Judge0-Client-Secret` must equal `JUDGE0_COMPAT_TOKEN`
  (constant-time compare) or `401`; `X-Judge0-Client-ID` ignored. Only
  `/health` is open. The service refuses to start without a token (≥16 chars).
- **`POST /submissions`** (`wait=true|false`, `base64_encoded`, `fields`):
  `language_id`, `source_code`, `stdin`, `expected_output`,
  `cpu_time_limit`/`wall_time_limit`/`memory_limit` (may only lower the
  ceilings), `additional_files` (base64 zip, ≤50 files / 20 MB, no absolute
  or `..` paths; passed to Piston as base64 files so SQLite DBs stay binary
  and compile scripts do not see them). Answers `201` with `stdout`,
  `stderr`, `compile_output`, `message`, `time` (s, string), `wall_time`,
  `memory` (KB), `exit_code`, `exit_signal`, `token`, `status {id, description}`.
  `wait=false` returns `{token}` (the run still happens before the reply).
- Also: `GET /submissions/{token}` (in-memory, last 500), `POST/GET
  /submissions/batch` (≤20), `GET /languages`, `/languages/all`,
  `/languages/{id}`, `/statuses`, `/about`, `/workers`, `/health`.
- **Status mapping:** compile stage failed → 6 (also Java's
  `error: compilation failed` in the run stage); run `TO` → 5; SIGSEGV/139 → 7;
  SIGXFSZ/153 → 8; SIGFPE/136 → 9; SIGABRT/134 → 10; other signal
  (incl. 137 memory kill, message "Memory limit exceeded") and output limit → 12;
  non-zero exit → 11; exit 0 → 3, or 4 if `expected_output` was sent and does
  not match (line-wise rstrip, trailing blank lines ignored — same rule as the
  API). Sandbox `XX`, Piston down/5xx/timeout, runtime not installed, queue
  full, language unavailable on arm64 → **13** (the API's grader treats 13 as
  "not executed" and keeps the stored grade). Unknown `language_id` → `422`.
- **SQL (82)** runs as a Python program that behaves like the `sqlite3`
  shell on `db.sqlite3` (list mode, `|`, no headers). The API normally rewrites
  SQL to Python 71 itself when a DB is attached.
- **Queue:** at most `MAX_INFLIGHT=2` Piston calls (= `PISTON_MAX_CONCURRENT_JOBS`),
  `MAX_QUEUE=64` waiting; a request waits ≤22 s for a slot and ≤27 s in total
  (the API times out at 30 s), else 13.
- **Logs:** JSON lines on stdout (`docker logs judge0-compat`): token,
  language, status, time, memory, queue/total ms, source/stdin *lengths* and
  file count. Never source, stdin, expected output or program output.

#### Languages (verified 2026-09-25 with `judge0-compat/smoke-test.py`)

| Judge0 ID | Language | Piston runtime | Verified |
|---|---|---|---|
| 71 | Python 3 | python 3.12.0 (numpy, pandas, scipy) | ✅ 0.1 s |
| 63 | JavaScript | node 18.15.0 | ✅ 0.2 s |
| 74 | TypeScript | typescript 5.0.3 (tsc → node 18; no @types/node) | ✅ 2 s |
| 62 | Java | java 15.0.2 (class `Main`) | ✅ 1 s |
| 50 | C | gcc 10.2.0 (`-std=c11 -lm`) | ✅ 0.2 s |
| 54 | C++ | gcc 10.2.0 (`-std=c++17`) | ✅ 0.7 s |
| 59 | Fortran | gcc 10.2.0 gfortran | ✅ 0.2 s |
| 73 | Rust | rust 1.68.2 | ✅ 3 s |
| 60 | Go | go 1.16.2 | ✅ 1.2 s |
| 68 | PHP | php 8.2.3 | ✅ 0.3 s |
| 72 | Ruby | ruby 3.0.1 | ✅ 0.2 s |
| 78 | Kotlin | kotlin 1.8.20 (JDK 8) | ✅ 7 s (compile) |
| 81 | Scala | scala 3.2.2 (JDK 8) | ✅ 5.5 s (compile) |
| 85 | Perl | perl 5.36.0 | ✅ 0.1 s |
| 80 | R | rscript 4.1.1 | ✅ 0.2 s |
| 90 | Dart | dart 2.19.6 | ✅ 1.4 s |
| 64 | Lua | lua 5.4.4 | ✅ |
| 57 | Elixir | elixir 1.11.3 (Erlang 23) | ✅ 0.4 s |
| 86 | Clojure | clojure 1.10.3 (JDK 15) | ✅ 0.9 s |
| 46 | Bash | bash 5.2.0 | ✅ |
| 77 | Pascal | fpc 3.2.2 | ✅ 0.2 s |
| 69 | Prolog | SWI-Prolog 8.2.4 | ✅ |
| 55 | Common Lisp | SBCL 2.1.2 (built from source) | ✅ |
| 91 | PowerShell | pwsh 7.1.4 (invariant globalization) | ✅ 1 s |
| 82 | SQL | python 3.12.0 + sqlite3 (see above) | ✅ with `db.sqlite3` |
| 51 | C# | — not built (mono source build ~1 h+, or dotnet 5 arm64 with a custom csc wrapper) | ❌ status 13 |
| 61 | Haskell | — not built (no GHC 9.0.1 aarch64-deb10 binary; deb9 build untested, ~2 GB) | ❌ status 13 |
| 83 | Swift | — no aarch64 build for the Debian 10 base | ❌ status 13 |
| 79 | Objective-C | — needs clang + GNUstep | ❌ status 13 |
| 45 | Assembly (NASM) | — the product's sample is x86-64 assembly, cannot run on arm64 | ❌ status 13 |

Aliases (same runtimes): 48/49/75 → C, 52/53/76 → C++, 92/100 → Python, 93 → JavaScript, 94 → TypeScript, 95 → Go.
Times are one hello-world round trip incl. compile. JVM-compiled languages (Kotlin, Scala) compile on every test case: a 50-case batch at 8 in flight takes minutes and individual cases may hit the 27 s deadline (→ 13, grade kept). Checks also passed: 401 without/with wrong token, 2358 closed on the public IP, compile error 6, Java compile error 6, TLE 5, Wrong Answer 4, 1 GB allocation → 12 "Memory limit exceeded", segfault 7, exit 3 → 11, no network, API SQL path with `db.sqlite3` zip, text `additional_files` (interpreted + compiled), 10 parallel Python (0.3 s), 8 parallel Java (6 s).

#### Operating it

```bash
cd /opt/validbridge/piston
sudo docker compose ps
sudo docker compose logs -f judge0-compat            # JSON, no code
sudo python3 ../judge0-compat/smoke-test.py          # full check (reads the token itself)
curl -s 127.0.0.1:2000/api/v2/runtimes | jq -r '.[] | "\(.language) \(.version)"'
```

**Update the adapter:** copy `infra/server-b/judge0-compat` to
`/opt/validbridge/judge0-compat`, then `sudo docker compose up -d --build judge0-compat`.

**Add a language:**
1. Check the recipe `/opt/piston-src/packages/<lang>/<ver>/build.sh`. If it
   downloads an x86 binary, add an aarch64 rewrite to `patch-recipes-arm64.sh`
   (the script lists recipes that still point at x86).
2. `./build-arm64.sh <lang>-<ver>` (builds in the builder image, installs into
   `/srv/piston/packages`, rewrites `.env` to container paths).
3. `docker restart piston` (Piston loads packages at start).
4. Map the Judge0 ID in `judge0-compat/app/languages.py` (Piston language name,
   version, main file name; some recipes append the extension themselves),
   add a hello-world to `smoke-test.py`, redeploy the adapter, run the smoke test.
5. If it needs more than 256 MB / 3 s, add it to `PISTON_LIMIT_OVERRIDES` in
   `piston.env` and `sudo docker compose up -d piston`.

**Rotate the token** (brief 401s from A until both sides match):
```bash
sudo sh -c 'umask 077; echo "JUDGE0_COMPAT_TOKEN=$(openssl rand -hex 32)" > /etc/validbridge/judge0-compat.env'
cd /opt/validbridge/piston && sudo docker compose up -d judge0-compat   # re-reads env_file
# then set the same value as VALIDBRIDGE_JUDGE0_CLIENT_SECRET on A and restart the API
```

**Disk:** packages in `/srv/piston/packages`, built archives in
`/opt/piston-src/packages/*.pkg.tar.gz` (can be deleted; they only speed up
reinstalls). Keep ≥10 GB free on `/`.

### Judge0 host prerequisites (only for options (a) or (c))

> ⚠️ **Needs owner confirmation and working serial-console access** before
> anything below is done on B. A wrong kernel or GRUB entry leaves the VM
> unbootable without the Oracle console. Not applied on 2026-09-25.

On B (option (a)) both steps are required; on a fresh x86 Ubuntu 22.04 VM
(option (c)) the kernel usually still has v1 support and step 2 is enough
(check `grep MEMCG_V1 /boot/config-$(uname -r)`; `=y` or absent on ≤6.10 is fine).

```bash
# 1. (B only) Install and default to a kernel that still has the cgroup-v1 memory controller
sudo apt-get install -y linux-image-oracle-6.8 linux-headers-oracle-6.8
grep -E 'CONFIG_MEMCG_V1|^CONFIG_MEMCG=' /boot/config-6.8.*-oracle     # 6.8 predates the option: v1 built in
#    set GRUB_DEFAULT to the 6.8 entry ("Advanced options for Ubuntu>Ubuntu, with Linux 6.8.0-XXXX-oracle")
#    and hold the new kernels:  sudo apt-mark hold linux-image-oracle linux-oracle
# 2. Switch systemd to the legacy cgroup v1 hierarchy
sudo sed -i 's/^GRUB_CMDLINE_LINUX="\(.*\)"/GRUB_CMDLINE_LINUX="\1 systemd.unified_cgroup_hierarchy=0"/' /etc/default/grub
sudo update-grub
sudo reboot                                   # only with console access ready
# Verify
stat -fc %T /sys/fs/cgroup                    # tmpfs (v1), not cgroup2fs
ls /sys/fs/cgroup/memory                      # must exist
```
Note: this also moves Docker to cgroup v1 and would stop Piston (pure v2)
from starting; the two cannot share a host.

Judge0 templates for that case: [`judge0/docker-compose.yml`](judge0/docker-compose.yml),
[`judge0/judge0.conf.example`](judge0/judge0.conf.example)
(`AUTHN_HEADER=X-Judge0-Client-Secret`, `AUTHN_TOKEN=<secret>`,
`ENABLE_NETWORK=false`, limits, `COUNT` = cores, bound to the tunnel IP).

---

## 5. Owner actions still needed

0. **Point the API on A at the adapter**: set `VALIDBRIDGE_JUDGE0_API_URL=http://10.66.0.2:2358` and `VALIDBRIDGE_JUDGE0_CLIENT_SECRET` (value from `/etc/validbridge/judge0-compat.env` on B, copied without printing), restart the API, then run one playground snippet.

1. **Resize B** to 4 OCPU / 24 GB (Oracle console → Instance → Edit shape;
   the VM restarts, so do it when convenient) and **grow the boot volume** to
   100 GB (Block Volume → Boot volume → Edit size, then on the VM:
   `sudo growpart /dev/sda 1 && sudo resize2fs /dev/sda1`).
2. **Confirm Oracle serial-console access to B** (Instance → Console
   connection). Needed before any kernel/GRUB change.
3. Oracle security list of B: add ingress **UDP 51820 from `84.12.116.16/32`**
   if it is not there yet. The tunnel works today because B sends keepalives
   and the security list is stateful, but A cannot start a handshake after
   both sides restart without it. No other ingress than SSH.
4. Approve the decision (b), or choose (c) and create the x86 VM.
