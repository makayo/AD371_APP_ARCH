# Pulse - tiny container health dashboard
# ---- Build stage ----
FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY *.go ./
# Static binary, stripped of debug info -> small and runs on scratch
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /app .

# ---- Runtime stage: empty image, just the binary ----
FROM scratch
COPY --from=build /app /app
ENV PORT=8080 APP_VERSION=1.0.0
EXPOSE 8080
# Run as an unprivileged user (nobody)
USER 65534:65534
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD ["/app", "-healthcheck"]
ENTRYPOINT ["/app"]
