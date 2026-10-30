# Multi-Subnet Network Topology & Load Balancer

Docker Compose topology: a dual-homed Nginx load balancer distributes traffic round-robin across two Python backends on an isolated private subnet.

## 1. Architecture Topology Diagram & Overview

```
                    Host / Browser / curl
                            │
                  http://localhost:8080
                            │
  ┌─────────────────────────┴──────────────────────────┐
  │ PUBLIC_SUBNET   172.28.1.0/24                      │
  │                                                    │
  │        nginx  (load balancer)                      │
  │        published port 8080 -> 80                   │
  └─────────────────────────┬──────────────────────────┘
                            │   nginx is dual-homed
                            │
  ┌─────────────────────────┴──────────────────────────┐
  │ PRIVATE_SUBNET  172.28.2.0/24   internal: true     │
  │                                                    │
  │        nginx  (second network interface)           │
  │                                                    │
  │   backend1:8000              backend2:8000         │
  │   SERVER_ID=backend1         SERVER_ID=backend2    │
  │   expose 8000 only           expose 8000 only      │
  │   healthcheck /healthz       healthcheck /healthz  │
  └────────────────────────────────────────────────────┘
```

| Component              | Networks        | Host access | Role                                                             |
| ---------------------- | --------------- | ----------- | ---------------------------------------------------------------- |
| `nginx`                | public, private | Port 8080   | Reverse proxy and round-robin load balancer                      |
| `backend1`, `backend2` | private         | None        | Python services returning their `SERVER_ID`; `/healthz` endpoint |

| File                           | Purpose                                                     |
| ------------------------------ | ----------------------------------------------------------- |
| `compose.yaml`                 | Services, subnets, health checks                            |
| `nginx/nginx.conf`             | Upstream pool, timeouts, retries, health endpoints, logging |
| `app.py`, `Dockerfile`         | Backend service                                             |
| `WK5_Network_Audit_Demo.ipynb` | Audit of the original AI draft                              |
| `WK5_Load_Balancer_Demo.ipynb` | QA tests for the corrected system                           |
| `audit_evidence/`              | Original AI files and audit results                         |

## 2. Setup & Execution Guide

**Prerequisites:** [Git](https://git-scm.com/downloads), [Docker Desktop](https://www.docker.com/products/docker-desktop/) (running), and port 8080 free. For the notebooks: Python 3 with Jupyter.

**Quick start**

```bash
git clone https://github.com/makayo/AD371_APP_ARCH.git
cd AD371_APP_ARCH/WK5/multi_subnet_load_balancer
docker compose up -d --build --wait
curl http://localhost:8080/        # repeat to see round-robin
```

**Commands** (run from `multi_subnet_load_balancer`)

| Task                      | Command                                            |
| ------------------------- | -------------------------------------------------- |
| Build and start           | `docker compose up -d --build --wait`              |
| Status                    | `docker compose ps`                                |
| Logs                      | `docker compose logs -f nginx`                     |
| Stop                      | `docker compose stop`                              |
| Start                     | `docker compose start`                             |
| Clean up                  | `docker compose down`                              |
| Clean up including images | `docker compose down --rmi local --remove-orphans` |

Full QA tests: open `WK5_Load_Balancer_Demo.ipynb` in Jupyter and run all cells.

## 3. AI Disclosure & Prompt Appendix

| Tool    | Role                                                                      |
| ------- | ------------------------------------------------------------------------- |
| ChatGPT | Initial architecture and audit notebook cells                             |
| Claude  | Audit of the ChatGPT output, corrected configuration, QA notebook, README |

### Prompts

Initial prompt: the assignment's sample prompt (exact text below). ChatGPT follow-ups are reconstructed from terminal history; Claude follow-ups are paraphrased.

**ChatGPT**

1. Provide the commands to build and start the stack, and confirm all containers are running.
2. How do I verify round-robin load balancing from the terminal?
3. How do I check the load balancer's health endpoint, including the response headers?
4. Show me how to inspect the public and private networks to confirm subnet membership and isolation.
5. The private subnet is not marked internal. Add `internal: true` to `compose.yaml` and redeploy.
6. Test failover: stop `backend1` and send requests with a timeout to see whether traffic reroutes.
7. Revert `compose.yaml` to the original AI-generated configuration so the audit reflects the original draft.
8. Add Markdown documentation to the audit notebook.

**Claude**

1. Review the project against Steps 1 and 2 without modifying it, preserving flaws as findings.
2. Document the audit notebook with explanations and findings, keeping the original code and outputs.
3. Create a corrected `nginx.conf` and `compose.yaml` and a separate, tested demo notebook.
4. Write a README that meets the repository requirements.

<details>
<summary><strong>Initial prompt (exact text)</strong></summary>

> Act as a senior network systems architect. I need a multi-container network topology configured using Docker Compose (or Terraform/Cloud IaC) demonstrating isolated subnets and reverse-proxy load balancing for a web application.
>
> The architecture must include:
>
> 1. Two Isolated Network Subnets:
>    - 'public_subnet': Accessible from the host/internet.
>    - 'private_subnet': Isolated backend network with no direct external port exposure.
> 2. A Load Balancer (Nginx or HAProxy):
>    - Dual-homed on both 'public_subnet' and 'private_subnet'.
>    - Exposes port 80/443 to the host.
>    - Configured with an upstream pool distributing requests across backend instances using Round-Robin.
> 3. At least Two Web Application Backend Replicas (e.g., Node.js, Python, or Go):
>    - Connected ONLY to 'private_subnet'.
>    - Each instance must return a unique identifier (e.g., container hostname or server ID) so I can verify which instance handled the request.
>    - Includes a simple health-check endpoint (/healthz).
>
> Provide the Docker Compose file, the load balancer configuration file (e.g., nginx.conf), the minimal backend application code, and step-by-step instructions to run and test it.

</details>

### AI output: correct vs. patched

**Correct:** no backend ports published; nginx the only dual-homed service; service-name upstreams; round-robin; unique server IDs and `/healthz`.

**Patched:**

| Issue                             | Effect                                          | Patch                                                          |
| --------------------------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| No proxy timeouts                 | 2 of 5 requests timed out with one backend down | `proxy_connect_timeout 1s`; read/send `5s`                     |
| No retry policy                   | Failed requests not rerouted                    | `proxy_next_upstream error timeout http_502 http_503 http_504` |
| No passive health tuning          | Dead backend kept being tried                   | `max_fails=1 fail_timeout=5s`                                  |
| DNS resolved once at startup      | Restarted backend might not rejoin              | `resolver 127.0.0.11 valid=5s` with `resolve`                  |
| `/healthz` answered by nginx only | Backends never health-checked                   | Docker health checks on each backend                           |
| Duplicate `Content-Type` header   | Malformed response                              | `default_type text/plain`                                      |
| Private subnet not internal       | Backends could reach the internet               | `internal: true`                                               |
| Start order only                  | nginx could start before backends were ready    | `condition: service_healthy`                                   |
| No upstream logging               | Routing not traceable                           | Upstream `log_format`                                          |

Deviations: host port 8080 instead of 80; no TLS. Original AI files: `audit_evidence/` and Git tag `wk5-ai-original`.

## 4. QA Test Summary

Windows, Docker Desktop, 28 Oct 2026.

| QA test                         | AI draft                                                                               | Corrected                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Round-robin (10 requests)       | ✅ 5/5 alternation                                                                     | ✅ 5/5 alternation                                               |
| Failover (`backend1` stopped)   | ❌ 2 of 5 requests timed out (5 s hangs)                                               | ✅ 10/10 served by `backend2`, 0 dropped, no 502                 |
| Recovery (`backend1` restarted) | ❌ No mechanism: DNS resolved once at startup                                          | ✅ Healthy in 6.6 s, back in rotation in 7.7 s, no nginx restart |
| Host access to backend ports    | ✅ Blocked (no published ports)                                                        | ✅ Blocked                                                       |
| Health check                    | ⚠️ 200 from nginx only; duplicate `Content-Type`; reported healthy with a backend down | ✅ 200 with a single header; backend health checked by Docker    |
| Browser console                 | Not tested                                                                             | ✅ Clean                                                         |

**Checklist (corrected system)**

- [x] Round-robin distribution verified
- [x] Failover with zero dropped requests verified
- [x] Automatic rejoin after restart verified
- [x] Subnet isolation verified
- [x] Health check returns 200 OK; browser console clean
