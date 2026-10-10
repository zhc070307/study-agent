# syntax=docker/dockerfile:1
FROM node:24.19.0-bookworm-slim
ENV PYTHONUNBUFFERED=1 LANG=C.UTF-8
WORKDIR /app
# Optional corporate/build proxy CA; never retained in the resulting image.
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export CURL_CA_BUNDLE=/run/secrets/proxy_ca NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv build-essential curl ca-certificates bash git ripgrep \
      latexmk texlive-xetex texlive-lang-chinese texlive-latex-extra \
      texlive-fonts-recommended texlive-science poppler-utils tini && \
    rm -rf /var/lib/apt/lists/* && npm install -g pnpm@11.19.0
COPY --chmod=755 . .
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export CURL_CA_BUNDLE=/run/secrets/proxy_ca NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    ./study-agent setup && mkdir -p /data && chown node:node /data
USER node
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/', timeout=5)" || exit 1
ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
CMD ["python3", "study-agent", "web", "--container", "--data", "/data", "--port", "8765"]
