from http.server import BaseHTTPRequestHandler, HTTPServer
import os

SERVER_ID = os.getenv("SERVER_ID", "unknown")


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/healthz":
            status = 200
            message = "healthy"
        else:
            status = 200
            message = f"Request handled by {SERVER_ID}\n"

        self.send_response(status)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(message.encode())

    def log_message(self, format, *args):
        print(f"{SERVER_ID}: {format % args}")


HTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
