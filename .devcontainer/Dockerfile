FROM mcr.microsoft.com/devcontainers/python:3.14

# Install basics
RUN apt update && apt install -y just wget curl procps git build-essential

# Install node 24 and bun
ENV NVM_DIR=/usr/local/nvm
ENV NODE_VERSION=24
RUN mkdir -p $NVM_DIR && \
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && \
    . $NVM_DIR/nvm.sh && \
    nvm install $NODE_VERSION && \
    nvm alias default $NODE_VERSION && \
    nvm use default && \
    # Create symlinks for global access
    NODE_BIN=$(. $NVM_DIR/nvm.sh && nvm which $NODE_VERSION) && \
    NODE_PATH=$(dirname "$NODE_BIN") && \
    ln -s "$NODE_BIN" /usr/local/bin/node && \
    ln -s "$NODE_PATH/npm" /usr/local/bin/npm && \
    ln -s "$NODE_PATH/npx" /usr/local/bin/npx

# Install uv
RUN curl -LsSf https://astral.sh/uv/install.sh | sh

# Install bun (package manager)
RUN curl -fsSL https://bun.sh/install | bash && \
    ln -s /root/.bun/bin/bun /usr/local/bin/bun

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
ENV PATH="/root/.cargo/bin:$PATH"
RUN rustup update stable

# Install Go and k6 (architecture aware)
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then \
        GO_ARCH="arm64"; \
        K6_ARCH="arm64"; \
    else \
        GO_ARCH="amd64"; \
        K6_ARCH="amd64"; \
    fi && \
    # Install Go
    curl -LO "https://go.dev/dl/go1.25.3.linux-${GO_ARCH}.tar.gz" && \
    tar -C /usr/local -xzf "go1.25.3.linux-${GO_ARCH}.tar.gz" && \
    rm "go1.25.3.linux-${GO_ARCH}.tar.gz" && \
    # Install k6
    curl -LO "https://github.com/grafana/k6/releases/download/v1.3.0/k6-v1.3.0-linux-${K6_ARCH}.tar.gz" && \
    tar -xzf "k6-v1.3.0-linux-${K6_ARCH}.tar.gz" && \
    mv "k6-v1.3.0-linux-${K6_ARCH}/k6" /usr/local/bin/ && \
    rm -rf "k6-v1.3.0-linux-${K6_ARCH}" "k6-v1.3.0-linux-${K6_ARCH}.tar.gz"

# Set up paths and shell environment
ENV PATH="/usr/local/go/bin:/root/.cargo/bin:/root/.bun/bin:/root/.local/bin:$PATH"
RUN echo "source $NVM_DIR/nvm.sh" >> /root/.bashrc && \
    echo "export PATH=\"/usr/local/go/bin:/root/.cargo/bin:/root/.bun/bin:/root/.local/bin:\$PATH\"" >> /root/.bashrc
