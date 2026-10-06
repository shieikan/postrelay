FROM rust:1.88-bookworm AS build
WORKDIR /src
RUN curl --fail --location --silent --show-error \
    https://codeload.github.com/sh1ma/Angelic-Angel/tar.gz/169a098e2025cc6e41a50fc8d521c483e21d9b6d -o source.tar.gz \
    && echo 'c30c954297248871c72523ca0413960a3b26de70391de68b5d97b1f8954c6bb7  source.tar.gz' | sha256sum --check \
    && tar -xzf source.tar.gz --strip-components=1 && rm source.tar.gz
COPY integrations/angelic-hardening.patch /tmp/angelic-hardening.patch
RUN patch -p1 < /tmp/angelic-hardening.patch
# Targeted security updates override the upstream lock, not its source identity.
COPY integrations/angelic/Cargo.lock /src/Cargo.lock
RUN cargo test --locked && cargo build --locked --release

FROM debian:bookworm-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install --yes --no-install-recommends ca-certificates python3 libssl3 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 angelic \
    && useradd --uid 10001 --gid 10001 --no-create-home angelic \
    && mkdir /private && chown angelic:angelic /private && chmod 700 /private
COPY --from=build /src/target/release/angelic-angel /usr/local/bin/angelic-angel
COPY --from=build /src/LICENSE /usr/share/doc/angelic-angel/LICENSE
COPY integrations/angelic/runner.py /usr/local/lib/angelic-runner.py
USER angelic
ENTRYPOINT ["python3", "-B", "/usr/local/lib/angelic-runner.py"]
CMD ["listen"]
