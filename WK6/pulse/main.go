package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

var (
	startTime  = time.Now()
	version    = getenv("APP_VERSION", "1.0.0")
	port       = getenv("PORT", "8080")
	maxMemMB   = getenvInt("MAX_MEM_MB", 256) // healthz fails above this heap size
	maxGor     = getenvInt("MAX_GOROUTINES", 1000)
	maxLogs    = getenvInt("MAX_LOGS", 100)
	demoMode   = os.Getenv("DEMO_MODE") == "true" // enables the "simulate failure" switch
	idPattern  = regexp.MustCompile(`[0-9a-f]{64}`)
	cachedID   string
	cachedOnce sync.Once
)

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func getenvInt(k string, def int) int {
	if v, err := strconv.Atoi(os.Getenv(k)); err == nil && v > 0 {
		return v
	}
	return def
}

// ---------- Runtime metadata ----------

// containerID finds the 64-char container ID from /proc (cgroup v1 and v2).
// Falls back to the hostname, which Docker sets to the short container ID.
func containerID() string {
	cachedOnce.Do(func() {
		for _, f := range []string{"/proc/self/cgroup", "/proc/self/mountinfo"} {
			file, err := os.Open(f)
			if err != nil {
				continue
			}
			sc := bufio.NewScanner(file)
			for sc.Scan() {
				line := sc.Text()
				if f == "/proc/self/mountinfo" && !strings.Contains(line, "/containers/") {
					continue
				}
				if id := idPattern.FindString(line); id != "" {
					cachedID = id
					break
				}
			}
			file.Close()
			if cachedID != "" {
				return
			}
		}
		cachedID, _ = os.Hostname()
	})
	return cachedID
}

func shortID() string {
	id := containerID()
	if len(id) > 12 {
		return id[:12]
	}
	return id
}

func localIPs() []string {
	var ips []string
	addrs, _ := net.InterfaceAddrs()
	for _, a := range addrs {
		if n, ok := a.(*net.IPNet); ok && !n.IP.IsLoopback() && n.IP.To4() != nil {
			ips = append(ips, n.IP.String())
		}
	}
	return ips
}

func memMB() float64 {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	return float64(m.Alloc) / 1024 / 1024
}

type Info struct {
	Hostname    string   `json:"hostname"`
	ContainerID string   `json:"container_id"`
	ShortID     string   `json:"container_id_short"`
	Version     string   `json:"app_version"`
	GoVersion   string   `json:"go_version"`
	OS          string   `json:"os"`
	Arch        string   `json:"arch"`
	CPUs        int      `json:"cpus"`
	Goroutines  int      `json:"goroutines"`
	MemAllocMB  string   `json:"mem_alloc_mb"`
	PID         int      `json:"pid"`
	IPs         []string `json:"ip_addresses"`
	StartedAt   string   `json:"started_at"`
	Uptime      string   `json:"uptime"`
	ServerTime  string   `json:"server_time"`
	DemoMode    bool     `json:"demo_mode"`
}

func collectInfo() Info {
	host, _ := os.Hostname()
	return Info{
		Hostname:    host,
		ContainerID: containerID(),
		ShortID:     shortID(),
		Version:     version,
		GoVersion:   runtime.Version(),
		OS:          runtime.GOOS,
		Arch:        runtime.GOARCH,
		CPUs:        runtime.NumCPU(),
		Goroutines:  runtime.NumGoroutine(),
		MemAllocMB:  fmt.Sprintf("%.2f", memMB()),
		PID:         os.Getpid(),
		IPs:         localIPs(),
		StartedAt:   startTime.UTC().Format(time.RFC3339),
		Uptime:      time.Since(startTime).Round(time.Second).String(),
		ServerTime:  time.Now().UTC().Format(time.RFC3339),
		DemoMode:    demoMode,
	}
}

// ---------- Health checks + in-memory log ----------

type Check struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Detail string `json:"detail"`
}

type HealthLog struct {
	Time       time.Time `json:"time"`
	Status     string    `json:"status"`
	Source     string    `json:"source"`
	Host       string    `json:"host"`
	Uptime     string    `json:"uptime"`
	MemMB      string    `json:"mem_mb"`
	LatencyMS  float64   `json:"latency_ms"`
	FailReason string    `json:"fail_reason,omitempty"`
}

var (
	mu           sync.Mutex
	logs         []HealthLog
	totalChecks  int
	totalFails   int
	simulateFail bool
)

func runChecks() (string, []Check) {
	mem := memMB()
	gor := runtime.NumGoroutine()
	checks := []Check{
		{"server", "ok", "accepting requests"},
		{"memory", "ok", fmt.Sprintf("%.2f MB of %d MB limit", mem, maxMemMB)},
		{"goroutines", "ok", fmt.Sprintf("%d of %d limit", gor, maxGor)},
	}
	if mem > float64(maxMemMB) {
		checks[1].Status = "fail"
	}
	if gor > maxGor {
		checks[2].Status = "fail"
	}
	mu.Lock()
	sim := simulateFail
	mu.Unlock()
	if sim {
		checks = append(checks, Check{"simulated", "fail", "failure switched on from the dashboard"})
	}
	overall := "ok"
	for _, c := range checks {
		if c.Status != "ok" {
			overall = "fail"
		}
	}
	return overall, checks
}

func handleHealthz(w http.ResponseWriter, r *http.Request) {
	t := time.Now()
	status, checks := runChecks()

	source := "external"
	switch r.Header.Get("X-Healthcheck") {
	case "docker":
		source = "docker"
	case "ui":
		source = "dashboard"
	}
	reason := ""
	for _, c := range checks {
		if c.Status != "ok" {
			reason = c.Name + ": " + c.Detail
			break
		}
	}
	entry := HealthLog{
		Time:       t.UTC(),
		Status:     status,
		Source:     source,
		Host:       shortID(),
		Uptime:     time.Since(startTime).Round(time.Second).String(),
		MemMB:      fmt.Sprintf("%.2f", memMB()),
		LatencyMS:  float64(time.Since(t).Microseconds()) / 1000,
		FailReason: reason,
	}

	mu.Lock()
	logs = append(logs, entry)
	if len(logs) > maxLogs {
		logs = logs[len(logs)-maxLogs:]
	}
	totalChecks++
	if status != "ok" {
		totalFails++
	}
	mu.Unlock()

	code := http.StatusOK
	if status != "ok" {
		code = http.StatusServiceUnavailable
		log.Printf("healthz FAIL (%s): %s", source, reason)
	}
	writeJSON(w, code, map[string]any{
		"status": status,
		"host":   entry.Host,
		"uptime": entry.Uptime,
		"checks": checks,
	})
}

func handleHealthLogs(w http.ResponseWriter, r *http.Request) {
	mu.Lock()
	defer mu.Unlock()
	out := make([]HealthLog, len(logs))
	copy(out, logs)
	writeJSON(w, http.StatusOK, map[string]any{
		"total_checks":  totalChecks,
		"total_fails":   totalFails,
		"simulate_fail": simulateFail,
		"logs":          out,
	})
}

// handlePulse is a tiny endpoint the dashboard polls every second to drive the
// heartbeat line. It returns the statuses of checks that happened since `since`.
func handlePulse(w http.ResponseWriter, r *http.Request) {
	since, err := strconv.Atoi(r.URL.Query().Get("since"))
	if err != nil {
		since = -1
	}
	mu.Lock()
	defer mu.Unlock()
	newStatuses := []string{}
	if since >= 0 {
		n := totalChecks - since
		if n > len(logs) {
			n = len(logs)
		}
		for _, l := range logs[len(logs)-max(n, 0):] {
			newStatuses = append(newStatuses, l.Status)
		}
	}
	status := "ok"
	if simulateFail || (len(logs) > 0 && logs[len(logs)-1].Status != "ok") {
		status = "fail"
	}
	perMin := 0
	cutoff := time.Now().Add(-time.Minute)
	for _, l := range logs {
		if l.Time.After(cutoff) {
			perMin++
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"total":   totalChecks,
		"new":     newStatuses,
		"status":  status,
		"per_min": perMin,
	})
}

func handleSimulate(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Fail bool `json:"fail"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "send {\"fail\": true|false}"})
		return
	}
	mu.Lock()
	simulateFail = in.Fail
	mu.Unlock()
	log.Printf("simulated failure set to %v", in.Fail)
	writeJSON(w, http.StatusOK, map[string]bool{"simulate_fail": in.Fail})
}

// ---------- HTTP plumbing ----------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	enc.Encode(v)
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t := time.Now()
		next.ServeHTTP(w, r)
		if r.URL.Path == "/" || r.URL.Path == "/info" {
			log.Printf("%s %s %s %v", r.RemoteAddr, r.Method, r.URL.Path, time.Since(t))
		}
	})
}

// healthcheck is used by Docker's HEALTHCHECK, since a scratch image has no curl/wget.
func healthcheck() int {
	c := http.Client{Timeout: 2 * time.Second}
	req, _ := http.NewRequest("GET", "http://127.0.0.1:"+port+"/healthz", nil)
	req.Header.Set("X-Healthcheck", "docker")
	resp, err := c.Do(req)
	if err != nil {
		return 1
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}

func main() {
	hc := flag.Bool("healthcheck", false, "probe /healthz and exit 0/1")
	flag.Parse()
	if *hc {
		os.Exit(healthcheck())
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, landingPage)
	})
	mux.HandleFunc("GET /healthz", handleHealthz)
	mux.HandleFunc("GET /info", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, collectInfo())
	})
	mux.HandleFunc("GET /api/health-logs", handleHealthLogs)
	mux.HandleFunc("GET /api/pulse", handlePulse)
	if demoMode {
		mux.HandleFunc("POST /api/simulate", handleSimulate)
	}

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           logRequests(mux),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		log.Printf("listening on :%s (pulse %s, container %s, demo mode %v)", port, version, shortID(), demoMode)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	// Graceful shutdown on `docker stop` (SIGTERM) or Ctrl+C.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	log.Println("shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
}
