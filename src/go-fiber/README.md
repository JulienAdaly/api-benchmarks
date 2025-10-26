# Go Fiber Implementation

A high-performance Go API implementation using the Fiber web framework, with Profile-Guided Optimization (PGO) support.

## Building

### Standard Build

```bash
cd src/go-fiber
go build -o go-fiber
```

### Optimized Build with PGO

For maximum performance, use the PGO (Profile-Guided Optimization) build script:

```bash
cd src/go-fiber
./build_with_pgo.sh
```

This script:

1. Builds an instrumented binary with profiling enabled
2. Runs load tests to collect runtime profiling data
3. Rebuilds the binary using the collected profile for optimizations

**Expected performance improvement**: 2-15% faster with PGO

#### Using PGO with Custom Environment

```bash
DATABASE_URL="postgresql://user:pass@host:5432/db" \
JWT_SECRET="your-secret" \
./build_with_pgo.sh
```

## Running

```bash
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"
export JWT_SECRET="secret"

./go-fiber
```

The server will start on port 8080 by default, or the port specified in the `PORT` environment variable.

## How PGO Works

Profile-Guided Optimization (PGO) was introduced in Go 1.21. The process:

1. **Instrumentation**: The first build includes CPU profiling instrumentation
2. **Profile Collection**: Run the server under realistic load to collect profiling data
3. **Optimization**: Rebuild using the profile data to:
   - Optimize hot code paths (functions called most frequently)
   - Improve branch prediction
   - Better inline decisions
   - Optimize memory layout

## Performance Optimizations

- **Connection Pooling**: Configured for high concurrency (50 max, 10 min connections)
- **JWT Validation**: Efficient token parsing without unnecessary allocations
- **UUID Handling**: Optimized conversion from PostgreSQL UUID types to strings
- **SQL Query Caching**: Pre-loads all SQL queries at startup

## Dependencies

- [Fiber v2](https://github.com/gofiber/fiber) - Fast HTTP web framework
- [pgx](https://github.com/jackc/pgx) - PostgreSQL driver
- [jwt-go](https://github.com/golang-jwt/jwt) - JWT token handling
- [bcrypt](golang.org/x/crypto/bcrypt) - Password hashing

