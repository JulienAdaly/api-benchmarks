#!/usr/bin/env node

import { spawn } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { cleanupConnections } from '../postgres_connection_manager.mjs';

// Configuration
// Note: These ports match the docker-compose.yml backend services
// If backends are running in docker-compose, you can skip starting them
// by using the --skip-start flag (if implemented) or just run k6 directly
const IMPLEMENTATIONS = {
  // 'bun-js-fastify': {
  //   port: 3004,
  //   path: 'src/js-express',
  //   startCmd: 'bun run src/main-fastify.js',
  // },
  // 'node-js-fastify': {
  //   port: 3005,
  //   path: 'src/js-express',
  //   startCmd: 'node src/main-fastify.js',
  // },
  // 'node-js-effect': {
  //   port: 3002,
  //   path: 'src/js-effect',
  //   startCmd: 'node --import tsx src/main-node.ts',
  // },
  // 'bun-js-effect': {
  //   port: 3000,
  //   path: 'src/js-effect',
  //   startCmd: 'bun run src/main.ts',
  // },
  'python-fastapi': {
    port: 8000,
    path: 'src/python-fastapi',
    startCmd: 'uv run start_server.py'
  },
  'go-fiber': {
    port: 8080,
    path: 'src/go-fiber',
    startCmd: './go-fiber',
  },
  'rust-axum': {
    port: 8082,
    path: 'src/rust-axum',
    startCmd: 'export PORT=8082 && ./target/release/rust-axum-api',
  },
  'node-js-express': {
    port: 3003,
    path: 'src/js-express',
    startCmd: 'node src/main.js',
  },
  'bun-js-express': {
    port: 3001,
    path: 'src/js-express',
    startCmd: 'bun run src/main.js',
  },
};

const TEST_CONFIGS = [
  // { name: 'read_light', type: 'read', vus: 50, duration: '1m' },
  // { name: 'read_medium', type: 'read', vus: 200, duration: '1m' },
  // { name: 'read_heavy', type: 'read', vus: 500, duration: '1m' },
  // { name: 'read_extreme', type: 'read', vus: 1000, duration: '1m' },
  // { name: 'write_light', type: 'write', vus: 50, duration: '1m' },
  // { name: 'write_medium', type: 'write', vus: 200, duration: '1m' },
  // { name: 'write_heavy', type: 'write', vus: 500, duration: '1m' },
  // { name: 'write_extreme', type: 'write', vus: 1000, duration: '1m' },
  { name: 'mixed_light', type: 'mixed', vus: 50, duration: '20s' },
  { name: 'mixed_medium', type: 'mixed', vus: 200, duration: '20s' },
  { name: 'mixed_heavy', type: 'mixed', vus: 500, duration: '20s' },
  { name: 'mixed_extreme', type: 'mixed', vus: 1000, duration: '20s' },
];

const DEFAULT_CREDENTIALS = {
  email: 'admin@admin.fr',
  password: 'admin',
};

// Utility functions
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Load environment variables from .env files (root and implementation directory)
function parseDotenv(content) {
  const env = {};
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) return;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  });
  return env;
}

function loadEnvForImplementation(implAbsPath) {
  const rootEnvPath = resolve(process.cwd(), '.env');
  const implEnvPath = resolve(implAbsPath, '.env');
  let merged = {};
  if (existsSync(rootEnvPath)) {
    try {
      merged = { ...merged, ...parseDotenv(readFileSync(rootEnvPath, 'utf8')) };
    } catch { }
  }
  if (existsSync(implEnvPath)) {
    try {
      merged = { ...merged, ...parseDotenv(readFileSync(implEnvPath, 'utf8')) };
    } catch { }
  }
  return merged;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    implementations: [],
    tests: [],
    outputDir: 'benchmark_results',
    warmup: true,
    parallel: false,
    email: DEFAULT_CREDENTIALS.email,
    password: DEFAULT_CREDENTIALS.password,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--implementations':
      case '-i':
        parsed.implementations = args[++i].split(',');
        break;
      case '--tests':
      case '-t':
        parsed.tests = args[++i].split(',');
        break;
      case '--output':
      case '-o':
        parsed.outputDir = args[++i];
        break;
      case '--no-warmup':
        parsed.warmup = false;
        break;
      case '--parallel':
        parsed.parallel = true;
        break;
      case '--email':
        parsed.email = args[++i];
        break;
      case '--password':
        parsed.password = args[++i];
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
    }
  }

  // Defaults
  if (parsed.implementations.length === 0) {
    parsed.implementations = Object.keys(IMPLEMENTATIONS);
  }
  if (parsed.tests.length === 0) {
    parsed.tests = TEST_CONFIGS.map(t => t.name);
  }

  return parsed;
}

function printUsage() {
  console.log(`
Benchmark Runner - Compare API implementations performance

Usage: node scripts/k6/benchmark_runner.mjs [options]

Options:
  -i, --implementations <list>  Comma-separated list of implementations to test
                               Available: ${Object.keys(IMPLEMENTATIONS).join(
    ', '
  )}
                               Default: all implementations

  -t, --tests <list>           Comma-separated list of test configurations
                               Available: ${TEST_CONFIGS.map(t => t.name).join(
    ', '
  )}
                               Default: all tests

  -o, --output <dir>           Output directory for results (default: benchmark_results)

  --no-warmup                  Skip warmup phase
  --parallel                   Run implementations in parallel (requires different ports)
  --email <email>              User email for authentication
  --password <password>        User password for authentication

  -h, --help                   Show this help

Examples:
  # Test all implementations with all test configs
  node scripts/k6/benchmark_runner.mjs

  # Test only Rust and Python with read tests
  node scripts/k6/benchmark_runner.mjs -i rust-axum,python-fastapi -t read_light,read_heavy

  # Quick comparison with light tests
  node scripts/k6/benchmark_runner.mjs -t read_light,write_light --no-warmup
`);
}

async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: options.silent ? 'pipe' : 'inherit',
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.env },
    });

    let stdout = '';
    let stderr = '';

    if (options.silent) {
      proc.stdout?.on('data', data => (stdout += data.toString()));
      proc.stderr?.on('data', data => (stderr += data.toString()));
    }

    proc.on('close', code => {
      if (code === 0) {
        resolve({ code, stdout, stderr });
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr}`));
      }
    });

    if (options.timeout) {
      setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error('Command timeout'));
      }, options.timeout);
    }
  });
}

async function isServiceRunning(port) {
  try {
    const response = await fetch(`http://localhost:${port}/posts`, {
      method: 'GET',
      signal: AbortSignal.timeout(1000),
    }).catch(() => null);

    // Accept any response (200, etc.) - just need server to be responding
    return response && response.status < 500;
  } catch (e) {
    return false;
  }
}

async function waitForServer(port, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      // Try to connect to the posts endpoint (public, no auth needed)
      const response = await fetch(`http://localhost:${port}/posts`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      }).catch(() => null);

      // Accept any response (200, etc.) - just need server to be responding
      if (response && response.status < 500) {
        return true;
      }
    } catch (e) {
      // Server not ready yet, continue waiting
    }

    console.log(
      `  Waiting for server on port ${port}... (${i + 1}/${maxAttempts})`
    );
    await sleep(2000);
  }
  return false;
}

async function startImplementation(name, config) {
  // Check if service is already running (e.g., in Docker)
  const alreadyRunning = await isServiceRunning(config.port);
  if (alreadyRunning) {
    console.log(`✓ ${name} is already running on port ${config.port} (skipping start)`);
    // Return a dummy handle that indicates the service is already running
    return {
      proc: null,
      processExited: () => false,
      alreadyRunning: true
    };
  }

  console.log(`Starting ${name}...`);

  const implAbsPath = resolve(process.cwd(), config.path);
  const dotenvEnv = loadEnvForImplementation(implAbsPath);

  const proc = spawn('sh', ['-c', config.startCmd], {
    cwd: implAbsPath,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: { ...process.env, ...dotenvEnv, PORT: config.port.toString() },
  });

  // Log server output for debugging
  proc.stdout?.on('data', data => {
    const output = data.toString().trim();
    if (output) console.log(`  [${name}] ${output}`);
  });

  proc.stderr?.on('data', data => {
    const output = data.toString().trim();
    if (output && !output.includes('WARN')) {
      // Filter out common warnings
      console.log(`  [${name}] ${output}`);
    }
  });

  let processExited = false;
  let exitCode = null;

  // Handle process exit
  proc.on('exit', code => {
    processExited = true;
    exitCode = code;
    if (code !== null && code !== 0) {
      console.log(`  [${name}] Process exited with code ${code}`);
    }
  });

  // Wait for server to be ready
  const ready = await waitForServer(config.port);
  if (!ready || processExited) {
    proc.kill('SIGTERM');
    throw new Error(`${name} failed to start on port ${config.port}`);
  }

  console.log(`✓ ${name} ready on port ${config.port}`);
  return { proc, processExited: () => processExited, alreadyRunning: false };
}

async function runWarmup(baseUrl, email, password) {
  console.log('Running warmup...');

  try {
    await runCommand(
      'k6',
      [
        'run',
        '--quiet',
        '-e',
        `BASE_URL=${baseUrl}`,
        '-e',
        `EMAIL=${email}`,
        '-e',
        `PASSWORD=${password}`,
        '-e',
        'TEST_TYPE=read',
        '-e',
        'VUS=10',
        '-e',
        'DURATION=30s',
        'scripts/k6/throughput_test.js',
      ],
      { silent: true, timeout: 45000 }
    );

    console.log('✓ Warmup completed');
  } catch (e) {
    console.warn('⚠ Warmup failed, continuing anyway:', e.message);
  }
}

async function runBenchmark(impl, config, testConfig, outputDir, credentials) {
  const baseUrl = `http://localhost:${config.port}`;
  // const resultFile = resolve(outputDir, `${impl}_${testConfig.name}.json`);

  console.log(`Running ${testConfig.name} on ${impl}...`);

  const env = {
    BASE_URL: baseUrl,
    EMAIL: credentials.email,
    PASSWORD: credentials.password,
    TEST_TYPE: testConfig.type,
    VUS: testConfig.vus.toString(),
    DURATION: testConfig.duration,
  };

  try {
    // Run k6 and capture both JSON output and stdout summary
    const summaryFile = resolve(
      outputDir,
      `${impl}_${testConfig.name}_summary.txt`
    );

    const result = await runCommand(
      'k6',
      [
        'run',
        '--summary-export',
        summaryFile,
        ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
        'scripts/k6/throughput_test.js',
      ],
      {
        timeout: (() => {
          const durationMatch = testConfig.duration.match(/^(\d+)([sm])$/);
          if (durationMatch) {
            const value = parseInt(durationMatch[1]);
            const unit = durationMatch[2];
            const durationSeconds = unit === 'm' ? value * 60 : value;
            return (durationSeconds + 60) * 1000; // Add 60s buffer
          }
          return 180000; // 3 minute default timeout
        })(),
        silent: false,
      }
    );

    // Parse RPS from k6's stdout output (most reliable)
    let rps = null;
    let totalRequests = 0;

    // Look for the http_reqs line in the summary file with is a JSON file
    const summary = readFileSync(summaryFile, 'utf8');
    const summaryJson = JSON.parse(summary);
    const httpReqs = summaryJson.metrics.http_reqs;
    totalRequests = httpReqs.count;
    rps = httpReqs.rate;

    return {
      implementation: impl,
      test: testConfig.name,
      vus: testConfig.vus,
      duration: testConfig.duration,
      totalRequests,
      rps: Math.round(rps * 100) / 100,
    };
  } catch (error) {
    console.error(`✗ ${testConfig.name} on ${impl} failed:`, error.message);
    return {
      implementation: impl,
      test: testConfig.name,
      vus: testConfig.vus,
      duration: testConfig.duration,
      error: error.message,
    };
  }
}

function generateReport(results, outputDir) {
  // Group results by test
  const byTest = {};
  results.forEach(result => {
    if (!byTest[result.test]) byTest[result.test] = [];
    byTest[result.test].push(result);
  });

  // Generate markdown report
  let markdown = `# API Benchmark Results\n\n`;
  markdown += `Generated: ${new Date().toISOString()}\n\n`;

  // Summary table
  markdown += `## Summary\n\n`;
  markdown += `| Implementation | Test | VUs | RPS | Status |\n`;
  markdown += `|---|---|---|---|---|\n`;

  results.forEach(result => {
    const status = result.error ? '❌ Failed' : '✅ Success';
    const rps = result.rps ? result.rps.toLocaleString() : 'N/A';
    markdown += `| ${result.implementation} | ${result.test} | ${result.vus} | ${rps} | ${status} |\n`;
  });

  // Detailed results by test
  Object.entries(byTest).forEach(([testName, testResults]) => {
    markdown += `\n## ${testName}\n\n`;

    const successful = testResults.filter(r => !r.error);
    if (successful.length > 0) {
      // Sort by RPS descending
      successful.sort((a, b) => (b.rps || 0) - (a.rps || 0));

      markdown += `### Performance Ranking\n\n`;
      successful.forEach((result, index) => {
        const medal =
          index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '  ';
        markdown += `${medal} **${result.implementation
          }**: ${result.rps.toLocaleString()} RPS\n`;
      });

      if (successful.length > 1) {
        const best = successful[0];
        const worst = successful[successful.length - 1];
        const improvement = (
          ((best.rps - worst.rps) / worst.rps) *
          100
        ).toFixed(1);
        markdown += `\n*${best.implementation} is ${improvement}% faster than ${worst.implementation}*\n`;
      }
    }

    // Failed tests
    const failed = testResults.filter(r => r.error);
    if (failed.length > 0) {
      markdown += `\n### Failed Tests\n\n`;
      failed.forEach(result => {
        markdown += `- **${result.implementation}**: ${result.error}\n`;
      });
    }
  });

  // Write report
  const reportPath = resolve(outputDir, 'benchmark_report.md');
  writeFileSync(reportPath, markdown);

  // Write CSV for easy analysis
  const csvLines = ['implementation,test,vus,duration,rps,status'];
  results.forEach(result => {
    const status = result.error ? 'failed' : 'success';
    csvLines.push(
      `${result.implementation},${result.test},${result.vus},${result.duration
      },${result.rps || ''},${status}`
    );
  });

  const csvPath = resolve(outputDir, 'benchmark_results.csv');
  writeFileSync(csvPath, csvLines.join('\n'));

  return { reportPath, csvPath };
}

async function main() {
  const args = parseArgs();

  console.log('🚀 Starting API Benchmark Suite');
  console.log(`Implementations: ${args.implementations.join(', ')}`);
  console.log(`Tests: ${args.tests.join(', ')}`);

  // Create output directory
  const outputDir = resolve(process.cwd(), args.outputDir);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const testConfigs = TEST_CONFIGS.filter(t => args.tests.includes(t.name));
  const results = [];
  const runningProcs = [];

  try {
    for (const implName of args.implementations) {
      const implConfig = IMPLEMENTATIONS[implName];
      if (!implConfig) {
        console.error(`Unknown implementation: ${implName}`);
        continue;
      }

      // Cleanup PostgreSQL connections before starting new implementation
      console.log('\n🧹 Cleaning up PostgreSQL connections...');
      try {
        // Use longer timeout to handle cases where there are many connections
        await cleanupConnections(30, process.env.DATABASE_URL);
      } catch (error) {
        // If cleanup fails due to too many connections, wait a bit and try once more
        if (error.message && error.message.includes('too many clients')) {
          console.warn('⚠ Too many connections, waiting before retry...');
          await sleep(5000);
          try {
            await cleanupConnections(30, process.env.DATABASE_URL);
          } catch (retryError) {
            console.warn('⚠ PostgreSQL cleanup failed after retry, continuing anyway:', retryError.message);
          }
        } else {
          console.warn('⚠ PostgreSQL cleanup failed, continuing anyway:', error.message);
        }
      }

      console.log(`\n📊 Testing ${implName}`);

      try {
        // Start implementation
        const implHandle = await startImplementation(implName, implConfig);
        runningProcs.push(implHandle);

        const baseUrl = `http://localhost:${implConfig.port}`;

        // Warmup
        if (args.warmup) {
          await runWarmup(baseUrl, args.email, args.password);
        }

        // Run tests
        for (const testConfig of testConfigs) {
          const result = await runBenchmark(
            implName,
            implConfig,
            testConfig,
            outputDir,
            {
              email: args.email,
              password: args.password,
            }
          );
          results.push(result);

          if (result.rps) {
            console.log(
              `✓ ${testConfig.name}: ${result.rps.toLocaleString()} RPS`
            );
          }

          // Cool down between tests
          await sleep(5000);
        }

        // Stop implementation (only if we started it and it's still running)
        if (!implHandle.alreadyRunning && !implHandle.processExited() && implHandle.proc) {
          console.log(`Stopping ${implName}...`);
          implHandle.proc.kill('SIGTERM');
          // Wait longer for server to shut down and close connections gracefully
          await sleep(5000);
          
          // Force kill if still running after graceful shutdown
          if (!implHandle.processExited()) {
            console.log(`Force killing ${implName}...`);
            implHandle.proc.kill('SIGKILL');
            await sleep(2000);
          }
        }

        // Cleanup PostgreSQL connections after stopping implementation
        // Wait a bit longer for connections to close naturally before forcing cleanup
        console.log('\n🧹 Cleaning up PostgreSQL connections after stopping...');
        await sleep(3000); // Give connections time to close naturally
        try {
          await cleanupConnections(30, process.env.DATABASE_URL);
        } catch (error) {
          console.warn('⚠ PostgreSQL cleanup failed, continuing anyway:', error.message);
        }
      } catch (error) {
        console.error(`Failed to test ${implName}:`, error.message);
        results.push({
          implementation: implName,
          test: testConfigs[0]?.name || 'unknown',
          error: error.message,
        });
      }
    }

    // Generate report
    const { reportPath, csvPath } = generateReport(results, outputDir);

    console.log('\n🎉 Benchmark completed!');
    console.log(`📊 Report: ${reportPath}`);
    console.log(`📈 CSV: ${csvPath}`);

    // Show quick summary
    const byImpl = {};
    results
      .filter(r => !r.error)
      .forEach(r => {
        if (!byImpl[r.implementation]) byImpl[r.implementation] = [];
        byImpl[r.implementation].push(r.rps);
      });

    console.log('\n🏆 Overall Performance Summary:');
    Object.entries(byImpl)
      .map(([impl, rpsList]) => ({
        impl,
        avgRps: rpsList.reduce((a, b) => a + b, 0) / rpsList.length,
      }))
      .sort((a, b) => b.avgRps - a.avgRps)
      .forEach((entry, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
        console.log(
          `${medal} ${entry.impl}: ${Math.round(
            entry.avgRps
          ).toLocaleString()} avg RPS`
        );
      });
  } catch (error) {
    console.error('❌ Benchmark failed:', error);
    process.exit(1);
  } finally {
    // Clean up any running processes (only ones we started)
    runningProcs.forEach(proc => {
      try {
        // Handle both old format (proc) and new format ({proc, processExited, alreadyRunning})
        const actualProc = proc.proc || proc;
        if (actualProc && !proc.alreadyRunning && !proc.processExited?.()) {
          actualProc.kill('SIGTERM');
        }
      } catch (e) {
        // Process might already be dead
      }
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
