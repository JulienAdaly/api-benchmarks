#!/usr/bin/env python3
"""
FastAPI server startup script with optimized configuration for performance.
"""

import os
import multiprocessing
import uvicorn


def main():
    
    cpu_count = 4
    workers = min(cpu_count, 11)
    
    max_total_connections = 40
    
    # Always recalculate pool size based on actual worker count
    # This ensures we don't exceed PostgreSQL limits even if DB_POOL_MAX was set
    pool_max_per_worker = max(1, max_total_connections // workers)
    
    # Always override DB_POOL_MAX to ensure optimal pool size
    # The .env file might have a value that's too small (e.g., 4)
    # We need at least 5-10 connections per worker for good performance
    existing_pool_max = os.getenv("DB_POOL_MAX")
    if not existing_pool_max or int(existing_pool_max) < pool_max_per_worker:
        os.environ["DB_POOL_MAX"] = str(pool_max_per_worker)
        print(f"⚠ Overriding DB_POOL_MAX from {existing_pool_max} to {pool_max_per_worker} for optimal performance")
    else:
        pool_max_per_worker = int(existing_pool_max)
    
    if not os.getenv("DB_POOL_MIN"):
        # Use smaller min to avoid holding too many idle connections
        os.environ["DB_POOL_MIN"] = str(max(1, pool_max_per_worker // 2))

    print(f"Starting FastAPI server with {workers} workers...")
    print(f"DB pool configuration: min={os.getenv('DB_POOL_MIN')}, max={os.getenv('DB_POOL_MAX')} per worker")
    print(f"Total max connections: {workers * int(os.getenv('DB_POOL_MAX'))}")

    uvicorn.run(
        "src.main:app",
        host="0.0.0.0",
        port=8000,
        workers=workers,
        # Additional performance optimizations
        loop="uvloop",  # Use uvloop for better async performance
        http="httptools",  # Use httptools for faster HTTP parsing
        access_log=False,  # Disable access logs for better performance
    )


if __name__ == "__main__":
    main()
