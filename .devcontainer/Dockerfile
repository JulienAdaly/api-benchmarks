FROM mcr.microsoft.com/devcontainers/python:3.13

# Install node 24

RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && \
    export NVM_DIR="$HOME/.nvm"

RUN [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" && \
    nvm install 24 && \
    nvm use 24 && \
    nvm alias default 24

# Install uv

RUN curl -LsSf https://astral.sh/uv/install.sh | sh

# Install bun (package manager)

RUN curl -fsSL https://bun.sh/install | bash

# Install just (command runner)

RUN wget -qO - 'https://proget.makedeb.org/debian-feeds/prebuilt-mpr.pub' | gpg --dearmor | sudo tee /usr/share/keyrings/prebuilt-mpr-archive-keyring.gpg 1> /dev/null
RUN echo "deb [arch=all,$(dpkg --print-architecture) signed-by=/usr/share/keyrings/prebuilt-mpr-archive-keyring.gpg] https://proget.makedeb.org prebuilt-mpr $(lsb_release -cs)" | sudo tee /etc/apt/sources.list.d/prebuilt-mpr.list
RUN apt update && apt install just

# Install Rust

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
RUN echo 'source $HOME/.cargo/env' >> $HOME/.bashrc
RUN echo 'source $HOME/.cargo/env' >> $HOME/.zshrc
ENV RUSTUP_TOOLCHAIN=stable
ENV PATH="$HOME/.cargo/bin:$PATH"
RUN /root/.cargo/bin/rustup update stable

# Install Go

RUN curl -LO https://go.dev/dl/go1.25.3.linux-arm64.tar.gz \
    && tar -C /usr/local -xzf go1.25.3.linux-arm64.tar.gz \
    && rm go1.25.3.linux-arm64.tar.gz

ENV PATH="/usr/local/go/bin:$PATH"

# Install Grafana k6

RUN curl -LO https://github.com/grafana/k6/releases/download/v1.3.0/k6-v1.3.0-linux-amd64.tar.gz && \
    tar -xzf k6-v1.3.0-linux-amd64.tar.gz && \
    mv k6-v1.3.0-linux-amd64/k6 /usr/local/bin/ && \
    rm -rf k6-v1.3.0-linux-amd64 k6-v1.3.0-linux-amd64.tar.gz