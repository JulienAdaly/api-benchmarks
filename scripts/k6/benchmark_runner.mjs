#!/usr/bin/env node

import { spawn } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

// Configuration
const IMPLEMENTATIONS = {
  'rust-axum': { port: 8080, path: 'src/rust-axum', startCmd: 'cargo run --release' },
  'go-fiber': { port: 8080, path: 'src/go-fiber', startCmd: 'go run .' },
  'python-fastapi-granian': { port: 8000, path: 'src/python-fastapi', startCmd: 'DB_POOL_MIN=5 DB_POOL_MAX=5 uv run start_server_granian.py' },
  'python-fastapi-uvicorn': { port: 8000, path: 'src/python-fastapi', startCmd: 'uv run start_server.py' },
  'js-bun-native': { port: 3000, path: 'src/js-express', startCmd: 'PG_MAX=90 PG_IDLE_TIMEOUT=9 PG_CONNECT_TIMEOUT=9 bun run src/main-bun-native.js' },
  'js-bun-express+bunpg': { port: 3000, path: 'src/js-express', startCmd: 'PG_MAX=90 PG_IDLE_TIMEOUT=9 PG_CONNECT_TIMEOUT=9 bun run src/main-bun.js' },
  'js-bun-express': { port: 3000, path: 'src/js-express', startCmd: 'PG_POOL_MAX=90 bun run src/main.js' },
  "js-node-express": { port: 3000, path: 'src/js-express', startCmd: 'NODE_OPTIONS="--max-old-space-size=16384" UV_THREADPOOL_SIZE=16 PG_POOL_MAX=90 node src/main.js' }

};

const TEST_CONFIGS = [
  { name: 'read_light', type: 'read', vus: 50, duration: '1m' },
  { name: 'read_medium', type: 'read', vus: 200, duration: '1m' },
  { name: 'read_heavy', type: 'read', vus: 500, duration: '1m' },
  { name: 'read_extreme', type: 'read', vus: 1000, duration: '1m' },
  { name: 'write_light', type: 'write', vus: 50, duration: '1m' },
  { name: 'write_medium', type: 'write', vus: 200, duration: '1m' },
  { name: 'write_heavy', type: 'write', vus: 500, duration: '1m' },
  { name: 'write_extreme', type: 'write', vus: 1000, duration: '1m' },
  { name: 'mixed_light', type: 'mixed', vus: 50, duration: '1m' },
  { name: 'mixed_medium', type: 'mixed', vus: 200, duration: '1m' },
  { name: 'mixed_heavy', type: 'mixed', vus: 500, duration: '1m' },
  { name: 'mixed_extreme', type: 'mixed', vus: 1000, duration: '1m' },
];

const DEFAULT_CREDENTIALS = {
  email: 'admin@admin.fr',
  password: 'admin'
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
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
    password: DEFAULT_CREDENTIALS.password
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
        break;
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
                               Available: ${Object.keys(IMPLEMENTATIONS).join(', ')}
                               Default: all implementations
  
  -t, --tests <list>           Comma-separated list of test configurations
                               Available: ${TEST_CONFIGS.map(t => t.name).join(', ')}
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
      env: { ...process.env, ...options.env }
    });

    let stdout = '';
    let stderr = '';

    if (options.silent) {
      proc.stdout?.on('data', (data) => stdout += data.toString());
      proc.stderr?.on('data', (data) => stderr += data.toString());
    }

    proc.on('close', (code) => {
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

async function waitForServer(port, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      // Try to connect to the posts endpoint (public, no auth needed)
      const response = await fetch(`http://localhost:${port}/auth/login`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000)
      }).catch(() => null);

      // Accept any response (200, 401, etc.) - just need server to be responding
      if (response && response.status < 500) {
        return true;
      }
    } catch (e) {
      // Server not ready yet, continue waiting
    }

    console.log(`  Waiting for server on port ${port}... (${i + 1}/${maxAttempts})`);
    await sleep(2000);
  }
  return false;
}

async function startImplementation(name, config) {
  console.log(`Starting ${name}...`);

  const implAbsPath = resolve(process.cwd(), config.path);
  const dotenvEnv = loadEnvForImplementation(implAbsPath);

  const proc = spawn('sh', ['-c', config.startCmd], {
    cwd: implAbsPath,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: { ...process.env, ...dotenvEnv, PORT: config.port.toString() }
  });

  // Log server output for debugging
  proc.stdout?.on('data', (data) => {
    const output = data.toString().trim();
    if (output) console.log(`  [${name}] ${output}`);
  });

  proc.stderr?.on('data', (data) => {
    const output = data.toString().trim();
    if (output && !output.includes('WARN')) { // Filter out common warnings
      console.log(`  [${name}] ${output}`);
    }
  });

  // Handle process exit
  proc.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.log(`  [${name}] Process exited with code ${code}`);
    }
  });

  // Wait for server to be ready
  const ready = await waitForServer(config.port);
  if (!ready) {
    proc.kill('SIGTERM');
    throw new Error(`${name} failed to start on port ${config.port}`);
  }

  console.log(`✓ ${name} ready on port ${config.port}`);
  return proc;
}

async function runWarmup(baseUrl, email, password) {
  console.log('Running warmup...');

  try {
    await runCommand('k6', [
      'run',
      '--quiet',
      '-e', `BASE_URL=${baseUrl}`,
      '-e', `EMAIL=${email}`,
      '-e', `PASSWORD=${password}`,
      '-e', 'TEST_TYPE=read',
      '-e', 'VUS=10',
      '-e', 'DURATION=30s',
      'scripts/k6/throughput_test.js'
    ], { silent: true, timeout: 45000 });

    console.log('✓ Warmup completed');
  } catch (e) {
    console.warn('⚠ Warmup failed, continuing anyway:', e.message);
  }
}

async function runBenchmark(impl, config, testConfig, outputDir, credentials) {
  const baseUrl = `http://localhost:${config.port}`;
  const resultFile = resolve(outputDir, `${impl}_${testConfig.name}.json`);

  console.log(`Running ${testConfig.name} on ${impl}...`);

  const env = {
    BASE_URL: baseUrl,
    EMAIL: credentials.email,
    PASSWORD: credentials.password,
    TEST_TYPE: testConfig.type,
    VUS: testConfig.vus.toString(),
    DURATION: testConfig.duration
  };

  try {
    // Run k6 and capture both JSON output and stdout summary
    const summaryFile = resolve(outputDir, `${impl}_${testConfig.name}_summary.txt`);

    const result = await runCommand('k6', [
      'run',
      '--out', `json=${resultFile}`,
      '--summary-export', summaryFile,
      ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
      'scripts/k6/throughput_test.js'
    ], {
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
      silent: false
    });

    // Parse RPS from k6's stdout output (most reliable)
    let rps = null;
    let totalRequests = 0;

    const output = result.stdout || '';

    // Look for the http_reqs line in the summary
    const httpReqsMatch = output.match(/http_reqs\.+:\s+(\d+)\s+([\d.]+)\/s/);
    if (httpReqsMatch) {
      totalRequests = parseInt(httpReqsMatch[1]);
      rps = parseFloat(httpReqsMatch[2]);
    }

    // Fallback: calculate from JSON data points if stdout parsing failed
    if (!rps) {
      try {
        const rawResults = readFileSync(resultFile, 'utf8')
          .split('\n')
          .filter(line => line.trim())
          .map(line => JSON.parse(line));

        // Use only http_reqs points
        const requestPoints = rawResults.filter(entry =>
          entry.type === 'Point' && entry.metric === 'http_reqs'
        );

        // Exclude setup and teardown phases if present to measure actual test window
        const nonSetupTeardown = requestPoints.filter(entry => {
          const group = entry?.data?.tags?.group;
          if (group === '::setup') return false;
          if (typeof group === 'string' && group.startsWith('::teardown')) return false;
          return true;
        });

        const pointsForDuration = nonSetupTeardown.length > 0 ? nonSetupTeardown : requestPoints;

        // Sum requests within the measured window
        totalRequests = pointsForDuration.reduce((sum, entry) => sum + (entry?.data?.value || 0), 0);

        // Compute real elapsed time from first to last measured point
        // Compute min/max timestamps iteratively to avoid call stack limits
        let startMs = Infinity;
        let endMs = -Infinity;
        for (const p of pointsForDuration) {
          const t = new Date(p?.data?.time).getTime();
          if (Number.isFinite(t)) {
            if (t < startMs) startMs = t;
            if (t > endMs) endMs = t;
          }
        }

        if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
          const durationSeconds = Math.max(0.000001, (endMs - startMs) / 1000);
          rps = totalRequests / durationSeconds;
        } else {
          // Fallback to configured duration if timestamps are unavailable
          const durationMatch = testConfig.duration.match(/^(\d+)([sm])$/);
          if (durationMatch) {
            const value = parseInt(durationMatch[1]);
            const unit = durationMatch[2];
            const durationSeconds = unit === 'm' ? value * 60 : value;
            rps = totalRequests / durationSeconds;
          }
        }
      } catch (e) {
        console.warn(`Failed to parse JSON results for ${impl}_${testConfig.name}:`, e.message);
      }
    }

    return {
      implementation: impl,
      test: testConfig.name,
      vus: testConfig.vus,
      duration: testConfig.duration,
      totalRequests,
      rps: Math.round(rps * 100) / 100,
      resultFile
    };

  } catch (error) {
    console.error(`✗ ${testConfig.name} on ${impl} failed:`, error.message);
    return {
      implementation: impl,
      test: testConfig.name,
      vus: testConfig.vus,
      duration: testConfig.duration,
      error: error.message
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
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '  ';
        markdown += `${medal} **${result.implementation}**: ${result.rps.toLocaleString()} RPS\n`;
      });

      if (successful.length > 1) {
        const best = successful[0];
        const worst = successful[successful.length - 1];
        const improvement = ((best.rps - worst.rps) / worst.rps * 100).toFixed(1);
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
    csvLines.push(`${result.implementation},${result.test},${result.vus},${result.duration},${result.rps || ''},${status}`);
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

      console.log(`\n📊 Testing ${implName}`);

      // Start implementation
      const proc = await startImplementation(implName, implConfig);
      runningProcs.push(proc);

      const baseUrl = `http://localhost:${implConfig.port}`;

      // Warmup
      if (args.warmup) {
        await runWarmup(baseUrl, args.email, args.password);
      }

      // Run tests
      for (const testConfig of testConfigs) {
        const result = await runBenchmark(implName, implConfig, testConfig, outputDir, {
          email: args.email,
          password: args.password
        });
        results.push(result);

        if (result.rps) {
          console.log(`✓ ${testConfig.name}: ${result.rps.toLocaleString()} RPS`);
        }

        // Cool down between tests
        await sleep(5000);
      }

      // Stop implementation
      proc.kill('SIGTERM');
      await sleep(2000);
    }

    // Generate report
    const { reportPath, csvPath } = generateReport(results, outputDir);

    console.log('\n🎉 Benchmark completed!');
    console.log(`📊 Report: ${reportPath}`);
    console.log(`📈 CSV: ${csvPath}`);

    // Show quick summary
    const byImpl = {};
    results.filter(r => !r.error).forEach(r => {
      if (!byImpl[r.implementation]) byImpl[r.implementation] = [];
      byImpl[r.implementation].push(r.rps);
    });

    console.log('\n🏆 Overall Performance Summary:');
    Object.entries(byImpl)
      .map(([impl, rpsList]) => ({
        impl,
        avgRps: rpsList.reduce((a, b) => a + b, 0) / rpsList.length
      }))
      .sort((a, b) => b.avgRps - a.avgRps)
      .forEach((entry, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
        console.log(`${medal} ${entry.impl}: ${Math.round(entry.avgRps).toLocaleString()} avg RPS`);
      });

  } catch (error) {
    console.error('❌ Benchmark failed:', error);
    process.exit(1);
  } finally {
    // Clean up any running processes
    runningProcs.forEach(proc => {
      try {
        proc.kill('SIGTERM');
      } catch (e) {
        // Process might already be dead
      }
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
