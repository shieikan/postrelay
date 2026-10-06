FROM rust:1.88-bookworm@sha256:af306cfa71d987911a781c37b59d7d67d934f49684058f96cf72079c3626bfe02 AS build
WORKDIR /src
RUN curl --fail --location --silent --show-error \
    https://codeload.github.com/sh1ma/Angelic-Angel/tar.gz/169a098e2025cc6e41a50fc8d521c483e21d9b6d -o source.tar.gz \
    && echo 'c30c954297248871c72523ca0413960a3b26de70391de68b5d97b1f8954c6bb7  source.tar.gz' | sha256sum --check \
    && tar -xzf source.tar.gz --strip-components=1 && rm source.tar.gz
COPY integrations/angelic-hardening.patch /tmp/angelic-hardening.patch
RUN patch -p1 < /tmp/angelic-hardening.patch
# Targeted security updates override the upstream lock, not its source identity.
COPY integrations/angelic/Cargo.lock /src/Cargo.lock
COPY integrations/angelic/runner.rs /src/src/bin/postrelay-angelic.rs
COPY integrations/angelic/runner_cli.rs /src/tests/runner_cli.rs
RUN cargo test --locked && cargo build --locked --release \
    && mkdir -m700 /private

FROM gcr.io/distroless/cc-debian13:nonroot@sha256:e792ab3d241a468a4fd7519ddbbebe66b49b5f365771716ea688ad40b6c6f1c2
COPY --from=build --chown=10001:10001 /private /private
COPY --from=build /src/target/release/angelic-angel /usr/local/bin/angelic-angel
COPY --from=build /src/target/release/postrelay-angelic /usr/local/bin/postrelay-angelic
COPY --from=build /src/LICENSE /usr/share/doc/angelic-angel/LICENSE
USER 10001:10001
ENTRYPOINT ["/usr/local/bin/postrelay-angelic"]
CMD ["listen"]
