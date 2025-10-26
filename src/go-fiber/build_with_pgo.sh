#!/bin/bash
set -e

# Build with PGO (Profile-Guided Optimization) for Go Fiber
#
# This script:
# 1. Builds an instrumented binary with profiling enabled
# 2. Runs it under load to collect profiling data
# 3. Builds the final optimized binary using the collected profile
#
# PGO allows the Go compiler to make data-driven optimizations by
# collecting runtime data about which functions are hot, branch
# prediction patterns, etc. This typically improves performance by 2-15%.
#
# Usage:
#   cd src/go-fiber
#   ./build_with_pgo.sh
#
# Or with custom environment:
#   DATABASE_URL="..." JWT_SECRET="..." ./build_with_pgo.sh

echo "Building Go Fiber with PGO (Profile-Guided Optimization)..."
echo ""

# Ensure we're in the right directory
cd "$(dirname "$0")"

# Step 1: Build initial binary with CPU profiling enabled
echo "Step 1: Building instrumented binary..."
go build -o go-fiber-profiling

# Step 2: Prepare environment
DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/postgres}"
JWT_SECRET="${JWT_SECRET:-secret}"
PORT="${PORT:-8080}"

echo "Step 2: Starting server with profiling enabled..."
echo "DATABASE_URL: ${DATABASE_URL}"
echo "Starting on port: ${PORT}"
echo ""

# Start the server with CPU profiling
CPU_PROFILE="cpu.prof" DATABASE_URL="$DATABASE_URL" JWT_SECRET="$JWT_SECRET" PORT="$PORT" ./go-fiber-profiling &
SERVER_PID=$!

# Give the server time to start
echo "Waiting for server to start..."
for i in {1..10}; do
    sleep 1
    if curl -s "http://localhost:${PORT}/posts" > /dev/null 2>&1; then
        echo "Server is ready!"
        break
    fi
    if [ $i -eq 10 ]; then
        echo "Error: Server failed to start"
        kill $SERVER_PID 2>/dev/null || true
        rm -f go-fiber-profiling
        exit 1
    fi
done

echo "Server started with PID: $SERVER_PID"
echo ""

# Step 3: Run load test to generate profiling data
echo "Step 3: Running load test to generate profiling data..."

# Find the script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}/../../"

# Check if k6 is available
if command -v k6 &> /dev/null && [ -f "${ROOT_DIR}scripts/k6/throughput_test.js" ]; then
    echo "Using k6 for load testing..."
    cd "$ROOT_DIR"
    k6 run -e BASE_URL=http://localhost:${PORT} -e EMAIL=admin@admin.fr -e PASSWORD=admin -e TEST_TYPE=mixed -e VUS=50 -e DURATION=20s scripts/k6/throughput_test.js
    cd - > /dev/null
fi
echo ""

# Step 4: Stop the profiled server gracefully
echo "Step 4: Stopping profiled server..."
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

# Wait for profile to be written
sleep 2

echo ""
echo "Checking for profile file..."
if [ -f "cpu.prof" ]; then
    SIZE=$(wc -c < cpu.prof)
    echo "Profile collected: $SIZE bytes"
else
    echo "Warning: No CPU profile file found"
fi
echo ""

# Step 5: Build the optimized binary using PGO
echo "Step 5: Building optimized binary with profile data..."
if [ -f "cpu.prof" ] && [ -s "cpu.prof" ]; then
    go build -pgo=cpu.prof -o go-fiber
    echo "✓ Built optimized binary with profile data"
else
    echo "Warning: No profile found, building without PGO..."
    go build -o go-fiber
fi

# Step 6: Cleanup
echo ""
echo "Cleaning up..."
rm -f go-fiber-profiling
rm -f cpu.prof
rm -f profile_load_summary.json

echo ""
echo "✓ Build complete! Optimized binary: ./go-fiber"
echo "  Profile data was used to optimize the binary"
echo ""
