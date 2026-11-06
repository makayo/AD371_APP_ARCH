# Pulse - tiny container health dashboard

# ---- Build stage ----
# Pinned to an exact version so builds are repeatable
FROM golang:1.24.13-alpine AS build
WORKDIR /src
# go.mod first: if dependencies are added later, this layer stays cached
# while only the source files change
COPY go.mod ./
COPY *.go ./
# Static binary, stripped of debug info -> small and runs on scratch
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /app .

# ---- Runtime stage: empty image, just the binary ----
FROM scratch
LABEL org.opencontainers.image.title="pulse" \
      org.opencontainers.image.description="Tiny container health dashboard" \
      org.opencontainers.image.version="1.0.0"
COPY --from=build /app /app
ENV PORT=8080 APP_VERSION=1.0.0
EXPOSE 8080
# Run as an unprivileged user (nobody)
USER 65534:65534
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD ["/app", "-healthcheck"]
ENTRYPOINT ["/app"]
