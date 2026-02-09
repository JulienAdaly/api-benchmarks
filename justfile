prepare:
    cd src/go-fiber && go build -o go-fiber
    cd src/rust-axum && cargo build --release
    cd src/java-javalin && ./gradlew --no-daemon shadowJar

run:
    bun run scripts/k6/benchmark_runner.mjs --parallel --no-warmup
