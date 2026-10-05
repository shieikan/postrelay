FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN groupadd --gid 10001 postrelay && useradd --uid 10001 --gid 10001 --no-create-home postrelay && mkdir /data && chown postrelay:postrelay /data && chmod 700 /data
COPY postrelay /app/postrelay
COPY web /app/web
COPY LICENSE /app/LICENSE
COPY THIRD_PARTY_LICENSES.md /app/THIRD_PARTY_LICENSES.md
USER postrelay
EXPOSE 8765
CMD ["python", "-m", "postrelay", "--host", "0.0.0.0", "--mode", "selfhost", "--data-dir", "/data"]
