FROM python:3.14-alpine

WORKDIR /app
COPY app.py .

USER nobody

EXPOSE 8000

CMD ["python", "-u", "app.py"]
