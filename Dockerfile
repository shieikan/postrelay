FROM python:3.12.15-slim-trixie@sha256:05cda9777409a9c3ffddd94a4c476b79f0769a0b4857f0c7ed9226b6800b0d6f AS python-runtime
COPY scripts/python-runtime.py /tmp/python-runtime.py
RUN python -B /tmp/python-runtime.py

FROM gcr.io/distroless/cc-debian13:nonroot@sha256:e792ab3d241a468a4fd7519ddbbebe66b49b5f365771716ea688ad40b6c6f1c2
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 LD_LIBRARY_PATH=/usr/local/lib
WORKDIR /app
COPY --from=python-runtime /runtime/ /
# Keep the existing volume owner; do not change users' data permissions on upgrade.
COPY --from=python-runtime --chown=10001:10001 /runtime/data /data
COPY postrelay /app/postrelay
COPY web /app/web
COPY LICENSE /app/LICENSE
COPY THIRD_PARTY_LICENSES.md /app/THIRD_PARTY_LICENSES.md
USER 10001:10001
EXPOSE 8765
CMD ["python", "-m", "postrelay", "--host", "0.0.0.0", "--mode", "selfhost", "--data-dir", "/data"]
