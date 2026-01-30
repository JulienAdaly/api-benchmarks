import http from 'k6/http';
import { check } from 'k6';

// Simple random string generator as fallback
function generateRandomString(length = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Configuration
// Available backends in docker-compose:
// - go-fiber: http://localhost:8080
// - js-effect: http://localhost:3000
// - js-express: http://localhost:3001
// - python-fastapi: http://localhost:8000
// - rust-axum: http://localhost:8081
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const EMAIL = __ENV.EMAIL || 'john.doe@example.com';
const PASSWORD = __ENV.PASSWORD || 's3cureP@ssw0rd';

// Test configuration - optimized for throughput
const VUS = Number(__ENV.VUS || 50);
const DURATION = __ENV.DURATION || '2m';
const TEST_TYPE = __ENV.TEST_TYPE || 'read'; // 'read', 'write', 'mixed'

export const options = {
  scenarios: {
    throughput_test: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
      exec: 'throughputTest',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'], // Very strict for throughput testing
    http_req_duration: ['p(95)<200'], // Aggressive latency target
  },
  // Disable default metrics to reduce overhead
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(95)', 'p(99)', 'count'],
};

// Global token storage (shared across VUs)
let authToken = null;
let postIds = [];

export function setup() {
  console.log(`Starting throughput test: ${TEST_TYPE} mode with ${VUS} VUs for ${DURATION}`);

  // Single login for all VUs to share
  const loginRes = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (loginRes.status !== 200) {
    throw new Error(`Login failed: ${loginRes.status}`);
  }

  const token = loginRes.json('accessToken');
  if (!token) {
    throw new Error('No access token received');
  }

  // Pre-create some posts for read tests
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };

  const seedPostIds = [];
  if (TEST_TYPE === 'read' || TEST_TYPE === 'mixed') {
    console.log('Seeding posts for read tests...');
    for (let i = 0; i < 100; i++) {
      const postRes = http.post(
        `${BASE_URL}/posts`,
        JSON.stringify({ content: `Seed post ${i} ${Date.now()}` }),
        { headers }
      );
      if (postRes.status === 201) {
        const post = postRes.json();
        if (post && post.id) {

          // Add some comments to increase read complexity
          for (let j = 0; j < 5; j++) {
            http.post(
              `${BASE_URL}/posts/${post.id}/comments`,
              JSON.stringify({ content: `Comment ${j} on post ${i}` }),
              { headers }
            );
          }

          // Add some likes to increase read complexity
          for (let j = 0; j < 5; j++) {
            http.post(`${BASE_URL}/posts/${post.id}/like`, null, { headers });
          }

          seedPostIds.push(post.id);
        }
      }
    }
    console.log(`Seeded ${seedPostIds.length} posts`);
  }

  return { token, seedPostIds };
}

export function throughputTest(data) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${data.token}`
  };

  switch (TEST_TYPE) {
    case 'read':
      performReadTest(data, headers);
      break;
    case 'write':
      performWriteTest(headers);
      break;
    case 'mixed':
      // 70% reads, 30% writes for realistic mixed workload
      if (Math.random() < 0.7) {
        performReadTest(data, headers);
      } else {
        performWriteTest(headers);
      }
      break;
    default:
      throw new Error(`Unknown test type: ${TEST_TYPE}`);
  }
}

export function teardown(data) {
  // Delete seeded posts created during setup to keep the database clean
  if (!data || !data.token) {
    return;
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${data.token}`
  };

  if (data.seedPostIds && data.seedPostIds.length > 0) {
    console.log(`Cleaning up ${data.seedPostIds.length} seeded posts...`);
    for (const postId of data.seedPostIds) {
      const res = http.del(`${BASE_URL}/posts/${postId}`, null, { headers });
      // Best-effort cleanup; API typically returns 204 on successful deletion
      check(res, { 'teardown_delete_post_2xx': (r) => r.status >= 200 && r.status < 300 });
    }
  }
}

function performReadTest(data, headers) {
  // Fast read operations - no sleep, minimal processing

  // 1. List posts (most common operation)
  const listRes = http.get(`${BASE_URL}/posts?limit=20&offset=0`);
  check(listRes, { 'list_posts_200': (r) => r.status === 200 });

  // 2. Get specific post if we have seeded data
  if (data.seedPostIds && data.seedPostIds.length > 0) {
    const randomPostId = data.seedPostIds[Math.floor(Math.random() * data.seedPostIds.length)];
    const getRes = http.get(`${BASE_URL}/posts/${randomPostId}`);
    check(getRes, { 'get_post_200': (r) => r.status === 200 });

    // 3. Get comments for the post
    const commentsRes = http.get(`${BASE_URL}/posts/${randomPostId}/comments`);
    check(commentsRes, { 'get_comments_200': (r) => r.status === 200 });
  }

  // 4. Auth check (common in real apps)
  const meRes = http.get(`${BASE_URL}/auth/me`, { headers });
  check(meRes, { 'auth_me_200': (r) => r.status === 200 });
}

function performWriteTest(headers) {
  // Fast write operations - create and immediately clean up

  const content = `Throughput test ${generateRandomString(8)}`;

  // 1. Create post
  const createRes = http.post(
    `${BASE_URL}/posts`,
    JSON.stringify({ content }),
    { headers }
  );
  check(createRes, { 'create_post_201': (r) => r.status === 201 });

  if (createRes.status === 201) {
    const post = createRes.json();
    if (post && post.id) {
      const postId = post.id;

      // 2. Add comment (fast write)
      const commentRes = http.post(
        `${BASE_URL}/posts/${postId}/comments`,
        JSON.stringify({ content: 'Fast comment' }),
        { headers }
      );
      check(commentRes, { 'create_comment_201': (r) => r.status === 201 });

      // 3. Like post (fast write)
      const likeRes = http.post(`${BASE_URL}/posts/${postId}/like`, null, { headers });
      check(likeRes, { 'like_post_204': (r) => r.status === 204 });

      // 4. Clean up - delete post (prevents DB bloat during long tests)
      const deleteRes = http.del(`${BASE_URL}/posts/${postId}`, null, { headers });
      check(deleteRes, { 'delete_post_204': (r) => r.status === 204 });
    }
  }
}

/*
Usage Examples:

# Pure read throughput test
k6 run -e BASE_URL=http://localhost:8000 \
       -e EMAIL=john.doe@example.com -e PASSWORD=s3cureP@ssw0rd \
       -e TEST_TYPE=read -e VUS=100 -e DURATION=5m \
       scripts/k6/throughput_test.js

# Pure write throughput test  
k6 run -e TEST_TYPE=write -e VUS=50 -e DURATION=2m \
       scripts/k6/throughput_test.js

# Mixed workload (70% reads, 30% writes)
k6 run -e TEST_TYPE=mixed -e VUS=75 -e DURATION=3m \
       scripts/k6/throughput_test.js

Environment Variables:
- BASE_URL: API endpoint (default: http://localhost:8080)
  Available backends: go-fiber:8080, js-effect:3000, js-express:3001, python-fastapi:8000, rust-axum:8081
- EMAIL/PASSWORD: User credentials
- TEST_TYPE: 'read', 'write', or 'mixed' (default: 'read')
- VUS: Number of virtual users (default: 50)
- DURATION: Test duration (default: '2m')
*/
