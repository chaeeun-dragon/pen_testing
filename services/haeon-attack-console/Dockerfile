FROM python:3.12-alpine
WORKDIR /app
COPY server.py /app/server.py
COPY www /app/www
ENV CONSOLE_PORT=8094
EXPOSE 8094
CMD ["python", "/app/server.py"]
