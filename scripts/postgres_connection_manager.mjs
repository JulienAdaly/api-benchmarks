#!/usr/bin/env node

/**
 * PostgreSQL Connection Manager Utility
 * 
 * This utility helps manage PostgreSQL connections during API benchmark testing.
 * It can check active connections, force close connections, and monitor connection cleanup.
 */

import { spawn } from 'child_process';

const DEFAULT_DATABASE_URL = 'postgresql://apibench:apibench_password@localhost:15432/apibench';

// Utility functions
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Check active PostgreSQL connections
async function checkPostgresConnections(databaseUrl = DEFAULT_DATABASE_URL) {
  try {
    // Use pg client from the js-express implementation
    const pg = await import('../src/js-express/node_modules/pg/esm/index.mjs');
    const { Client } = pg;
    const client = new Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 5000
    });
    
    await client.connect();
    const result = await client.query(`
      SELECT 
        count(*) as active_connections,
        count(CASE WHEN state = 'active' THEN 1 END) as active_queries,
        count(CASE WHEN state = 'idle' THEN 1 END) as idle_connections
      FROM pg_stat_activity 
      WHERE datname = current_database()
    `);
    await client.end();
    
    return {
      total: parseInt(result.rows[0].active_connections) || 0,
      active: parseInt(result.rows[0].active_queries) || 0,
      idle: parseInt(result.rows[0].idle_connections) || 0
    };
  } catch (error) {
    console.warn('Could not check PostgreSQL connections:', error.message);
    return { total: 0, active: 0, idle: 0 };
  }
}

// Force close all connections except system connections
async function forceCloseConnections(databaseUrl = DEFAULT_DATABASE_URL) {
  try {
    // Use pg client from the js-express implementation
    const pg = await import('../src/js-express/node_modules/pg/esm/index.mjs');
    const { Client } = pg;
    // Use a very small connection timeout and single connection to avoid adding to the problem
    const client = new Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 2000,
      // Don't use connection pooling - we need a direct connection
    });
    
    await client.connect();
    
    // First, try to terminate idle connections (less disruptive)
    const idleResult = await client.query(`
      SELECT pg_terminate_backend(pid) 
      FROM pg_stat_activity 
      WHERE datname = current_database() 
      AND pid <> pg_backend_pid() 
      AND state IN ('idle', 'idle in transaction')
    `);
    
    // If we still have too many connections, terminate active ones too
    // (this is more aggressive but necessary when hitting connection limits)
    const activeResult = await client.query(`
      SELECT pg_terminate_backend(pid) 
      FROM pg_stat_activity 
      WHERE datname = current_database() 
      AND pid <> pg_backend_pid() 
      AND state = 'active'
      AND application_name NOT LIKE '%postgres%'
    `);
    
    await client.end();
    
    const totalClosed = (idleResult.rowCount || 0) + (activeResult.rowCount || 0);
    console.log(`Force closed ${totalClosed} connections (${idleResult.rowCount || 0} idle, ${activeResult.rowCount || 0} active)`);
    return true;
  } catch (error) {
    // If we can't connect due to too many clients, that's expected
    if (error.message && error.message.includes('too many clients')) {
      console.warn('Could not connect to force close connections: too many clients already');
      return false;
    }
    console.warn('Could not force close connections:', error.message);
    return false;
  }
}

// Wait for connections to close with monitoring
async function waitForConnectionsToClose(maxWaitMs = 30000, checkIntervalMs = 1000, databaseUrl = DEFAULT_DATABASE_URL) {
  const startTime = Date.now();
  console.log('Checking PostgreSQL connections...');
  
  while (Date.now() - startTime < maxWaitMs) {
    const connections = await checkPostgresConnections(databaseUrl);
    console.log(`Active connections: ${connections.total} (${connections.active} active, ${connections.idle} idle)`);
    
    if (connections.total <= 1) { // 1 is usually the system connection
      console.log('✓ PostgreSQL connections cleared');
      return true;
    }
    
    await sleep(checkIntervalMs);
  }
  
  console.warn(`⚠ Timeout waiting for connections to close (waited ${maxWaitMs}ms)`);
  return false;
}

// Monitor connections continuously
async function monitorConnections(intervalMs = 2000, databaseUrl = DEFAULT_DATABASE_URL) {
  console.log('Starting PostgreSQL connection monitoring...');
  console.log('Press Ctrl+C to stop monitoring\n');
  
  const startTime = Date.now();
  
  const monitor = setInterval(async () => {
    const connections = await checkPostgresConnections(databaseUrl);
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`[${elapsed}s] Connections: ${connections.total} total (${connections.active} active, ${connections.idle} idle)`);
  }, intervalMs);
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    clearInterval(monitor);
    console.log('\nMonitoring stopped');
    process.exit(0);
  });
  
  // Keep the process running
  await new Promise(() => {});
}

// Cleanup function for use by other scripts
async function cleanupConnections(timeoutSeconds = 30, databaseUrl = DEFAULT_DATABASE_URL) {
  console.log('Starting connection cleanup process...');
  const initial = await checkPostgresConnections(databaseUrl);
  console.log(`Initial connections: ${initial.total}`);
  
  if (initial.total > 1) {
    console.log('Force closing idle connections...');
    await forceCloseConnections(databaseUrl);
    await sleep(2000);
    
    const success = await waitForConnectionsToClose(timeoutSeconds * 1000, 1000, databaseUrl);
    
    if (!success) {
      console.warn('⚠ Some connections may still be active');
      return false;
    }
  } else {
    console.log('✓ No connections to clean up');
  }
  
  return true;
}

// Export functions for use by other modules
export { checkPostgresConnections, forceCloseConnections, waitForConnectionsToClose, cleanupConnections };

// Main function
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  // Parse database URL from environment or use default
  const databaseUrl = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  
  switch (command) {
    case 'check':
      const connections = await checkPostgresConnections(databaseUrl);
      console.log(`PostgreSQL Connection Status:`);
      console.log(`  Total connections: ${connections.total}`);
      console.log(`  Active queries: ${connections.active}`);
      console.log(`  Idle connections: ${connections.idle}`);
      break;
      
    case 'wait':
      const waitTimeout = parseInt(args[1]) || 30; // seconds
      const waitSuccess = await waitForConnectionsToClose(waitTimeout * 1000, 1000, databaseUrl);
      process.exit(waitSuccess ? 0 : 1);
      break;
      
    case 'force-close':
      console.log('Force closing idle connections...');
      await forceCloseConnections(databaseUrl);
      await sleep(1000);
      const afterClose = await checkPostgresConnections(databaseUrl);
      console.log(`Connections after force close: ${afterClose.total}`);
      break;
      
    case 'monitor':
      const interval = parseInt(args[1]) || 2; // seconds
      await monitorConnections(interval * 1000, databaseUrl);
      break;
      
    case 'cleanup':
      const cleanupTimeout = parseInt(args[1]) || 30;
      const cleanupSuccess = await cleanupConnections(cleanupTimeout, databaseUrl);
      process.exit(cleanupSuccess ? 0 : 1);
      break;
      
    default:
      console.log(`
PostgreSQL Connection Manager

Usage: node scripts/postgres_connection_manager.mjs <command> [options]

Commands:
  check                    Check current connection status
  wait [timeout]          Wait for connections to close (default: 30s)
  force-close             Force close idle connections
  monitor [interval]      Monitor connections continuously (default: 2s)
  cleanup [timeout]       Full cleanup process (default: 30s)

Environment Variables:
  DATABASE_URL            PostgreSQL connection string (default: ${DEFAULT_DATABASE_URL})

Examples:
  # Check current connections
  node scripts/postgres_connection_manager.mjs check
  
  # Wait up to 60 seconds for connections to close
  node scripts/postgres_connection_manager.mjs wait 60
  
  # Force close idle connections
  node scripts/postgres_connection_manager.mjs force-close
  
  # Monitor connections every 5 seconds
  node scripts/postgres_connection_manager.mjs monitor 5
  
  # Full cleanup with 45 second timeout
  node scripts/postgres_connection_manager.mjs cleanup 45
`);
      break;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
