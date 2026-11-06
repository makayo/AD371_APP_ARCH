# Pulse

A tiny container health dashboard. One Go binary, zero dependencies, shipped in a `scratch` image of about 6 MB.

- **Landing page** with live status, a heartbeat monitor, health log and runtime info
- **`/healthz`** health endpoint, used by Docker's built-in `HEALTHCHECK`
- **`/info`** runtime metadata: hostname, container ID, IPs, memory, uptime and more

## Screenshots

**Healthy:** live status, heartbeat monitor, and Docker's health checks every 15s

![Pulse dashboard, healthy](screenshots/dashboard-healthy.png)

**Simulated failure:** the heartbeat turns red and each failed check shows its reason

![Pulse dashboard, unhealthy](screenshots/dashboard-unhealthy.png)

**Docker detects it on its own:** `docker ps` shows `(unhealthy)` after 3 failed checks, then `(healthy)` again after recovery, without restarting the container

![docker ps unhealthy](screenshots/docker-unhealthy.png)

![docker ps healthy](screenshots/docker-healthy.png)

## Project files

```
pulse/
├── main.go          # server, health checks, API endpoints
├── page.go          # the dashboard page (HTML/CSS/JS)
├── go.mod
├── Dockerfile       # multi-stage build -> scratch image
├── .dockerignore
├── README.md
└── screenshots/     # images used in this README
```

## Quick start

Open a terminal in VS Code (**Terminal → New Terminal**) inside the `pulse` folder.

**1. Build the image**

```bash
docker build -t pulse .
```

**2. Run it**

```bash
docker run -d --name pulse -p 8080:8080 pulse
```

**3. Open the dashboard:** http://localhost:8080

**4. Check that Docker sees it as healthy** (wait about 10 seconds first)

```bash
docker ps
```

The STATUS column should say `Up ... (healthy)`.

## Demo mode

Demo mode adds a **Simulate failure** button so you can show Docker marking the container unhealthy.

```bash
docker rm -f pulse
docker run -d --name pulse -p 8080:8080 -e DEMO_MODE=true pulse
```

## Demo walkthrough

1. **Show it running:** open http://localhost:8080. Point out the heartbeat: tall spikes are Docker's health checks (every 15s); small beats show the page is connected.
2. **Show the image size:** `docker images pulse` shows about 6 MB, because it's a single static binary on an empty `scratch` base.
3. **Show container identity:** the container ID on the page matches `docker ps`.
4. **Break it:** click **Simulate failure**. The line turns red, the header says *unhealthy*, and after 3 failed checks (about 45s) `docker ps` shows `(unhealthy)`. You can also run `docker inspect --format "{{json .State.Health}}" pulse` to see Docker's own health log.
5. **Fix it:** click **Stop simulated failure**. It goes back to *healthy*.
6. **Kill it:** `docker stop pulse`. The heartbeat goes flat with *signal lost*. Run `docker start pulse` and the beats come back on their own.
7. **Replace it:** `docker rm -f pulse`, then run it again. The page shows a new container ID and the health log starts fresh, because containers are disposable.

## Endpoints

| Endpoint | What it returns |
|---|---|
| `GET /` | The dashboard |
| `GET /healthz` | `200` + `{"status":"ok", ...}` when healthy, `503` when not |
| `GET /info` | Runtime metadata as JSON |
| `GET /api/health-logs` | The last 100 health checks + totals |
| `GET /api/pulse` | Small payload the heartbeat line polls every second |
| `POST /api/simulate` | Turn the simulated failure on/off (only when `DEMO_MODE=true`) |

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Port to listen on |
| `APP_VERSION` | `1.0.0` | Version shown on the page |
| `DEMO_MODE` | off | `true` shows the Simulate failure button |
| `MAX_MEM_MB` | `256` | `/healthz` fails if the app's memory goes above this |
| `MAX_GOROUTINES` | `1000` | `/healthz` fails above this many goroutines |
| `MAX_LOGS` | `100` | How many health checks to keep in the log |

Example: `docker run -d --name pulse -p 8080:8080 -e APP_VERSION=2.0.0 pulse`

## Useful commands

```bash
docker logs -f pulse      # follow the app's logs
docker stop pulse         # stop (graceful shutdown)
docker start pulse        # start again
docker rm -f pulse        # remove the container
docker rmi pulse          # remove the image
```

## Run without Docker (optional)

If you have Go 1.22+ installed:

```bash
go run .
```

Then open http://localhost:8080.

## Troubleshooting

- **"Cannot connect to the Docker daemon":** start Docker Desktop and wait until it says it's running.
- **"port is already allocated":** something else uses 8080. Use another port: `-p 9090:8080`, then open http://localhost:9090.
- **"Conflict. The container name /pulse is already in use":** run `docker rm -f pulse` first.
- **Hostname/container ID shows something odd:** they come from inside the container; outside Docker (`go run .`) you'll see your computer's name instead.
