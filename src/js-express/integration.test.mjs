/**
 * Integration test suite for Express and Effect.js implementations
 *
 * Usage:
 * - Test Express: BASE_URL=http://localhost:3000 bun run test
 * - Test js-effect: BASE_URL=http://localhost:3001 bun run test
 */

import http from 'node:http';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@admin.fr';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'admin';

// Test configuration
const TIMEOUT = 10000; // 10 seconds timeout for each test

// Helper functions
function makeRequest(method, path, data = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, res => {
      let body = '';
      res.on('data', chunk => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const parsedBody = body ? JSON.parse(body) : null;
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: parsedBody,
            rawBody: body,
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: body,
            rawBody: body,
          });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

function login() {
  return makeRequest('POST', '/auth/login', {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Timeout after ${timeoutMs}ms`)),
        timeoutMs
      )
    ),
  ]);
}

// Test assertion helper with debug information
function assert(condition, message, debug = {}) {
  if (!condition) {
    let errorMessage = message;
    if (debug.response) {
      errorMessage += `\n   Response Status: ${debug.response.status}`;
      if (debug.response.body) {
        errorMessage += `\n   Response Body: ${JSON.stringify(
          debug.response.body,
          null,
          2
        )}`;
      } else if (debug.response.rawBody) {
        errorMessage += `\n   Response Body: ${debug.response.rawBody}`;
      }
    }
    if (debug.request) {
      errorMessage += `\n   Request: ${debug.request.method} ${debug.request.url}`;
      if (debug.request.data) {
        errorMessage += `\n   Request Data: ${JSON.stringify(
          debug.request.data,
          null,
          2
        )}`;
      }
    }
    throw new Error(errorMessage);
  }
}

// Test Suite
async function runTests() {
  console.log(`\n🧪 Starting integration tests against ${BASE_URL}\n`);

  const results = { passed: 0, failed: 0, errors: [] };

  async function test(name, fn) {
    console.log(`\n📝 Test: ${name}`);
    try {
      await withTimeout(fn(), TIMEOUT);
      console.log(`✅ PASSED: ${name}`);
      results.passed++;
    } catch (err) {
      console.error(`❌ FAILED: ${name}`);
      console.error(`   Error: ${err.message}`);

      // Show stack trace for debugging
      if (err.stack) {
        const stackLines = err.stack.split('\n').slice(1, 4);
        if (stackLines.length > 0) {
          console.error(`   Stack trace:`);
          stackLines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed) {
              console.error(`     ${trimmed}`);
            }
          });
        }
      }

      results.failed++;
      results.errors.push({ test: name, error: err.message });
    }
  }

  // Auth Tests
  await test('POST /auth/login - successful login', async () => {
    const response = await login();
    assert(response.status === 200, `Expected 200, got ${response.status}`, {
      response,
    });
    assert(response.body?.accessToken, 'Expected accessToken in response', {
      response,
    });
  });

  await test('POST /auth/login - invalid credentials', async () => {
    const response = await makeRequest('POST', '/auth/login', {
      email: 'invalid@example.com',
      password: 'wrong',
    });
    assert(response.status === 401, `Expected 401, got ${response.status}`);
  });

  await test('GET /auth/me - authorized access', async () => {
    const loginResponse = await login();
    const token = loginResponse.body?.accessToken;
    assert(token, 'Should have token', { response: loginResponse });

    const response = await makeRequest('GET', '/auth/me', null, token);
    assert(response.status === 200, `Expected 200, got ${response.status}`, {
      response,
    });
    assert(response.body?.id, 'Expected user id in response', { response });
    assert(response.body?.email, 'Expected email in response', { response });
  });

  await test('GET /auth/me - unauthorized access', async () => {
    const response = await makeRequest('GET', '/auth/me');
    assert(response.status === 401, `Expected 401, got ${response.status}`);
  });

  // Posts Tests
  await test('POST /posts - create post (authenticated)', async () => {
    const loginResponse = await login();
    const token = loginResponse.body?.accessToken;
    assert(token, 'Should have token', { response: loginResponse });

    const requestData = { content: 'Test post content' };
    const response = await makeRequest('POST', '/posts', requestData, token);
    assert(response.status === 201, `Expected 201, got ${response.status}`, {
      response,
      request: { method: 'POST', url: '/posts', data: requestData },
    });
    assert(response.body?.id, 'Expected post id', { response });
    assert(response.body?.content === 'Test post content', 'Content mismatch', {
      response,
    });
  });

  await test('POST /posts - create post (unauthenticated)', async () => {
    const response = await makeRequest('POST', '/posts', {
      content: 'Test post',
    });
    assert(response.status === 401, `Expected 401, got ${response.status}`);
  });

  await test('GET /posts - list posts', async () => {
    const response = await makeRequest('GET', '/posts?limit=10');
    assert(response.status === 200, `Expected 200, got ${response.status}`);
    assert(Array.isArray(response.body), 'Expected array of posts');
  });

  await test('GET /posts/:postId - get specific post', async () => {
    // First create a post
    const loginResponse = await login();
    const token = loginResponse.body?.accessToken;

    const createResponse = await makeRequest(
      'POST',
      '/posts',
      { content: 'Post for retrieval test' },
      token
    );
    assert(createResponse.status === 201, 'Failed to create test post', {
      response: createResponse,
      request: { method: 'POST', url: '/posts' },
    });

    // Then get it
    const postId = createResponse.body?.id;
    assert(postId, 'Post ID should be defined', { response: createResponse });
    const response = await makeRequest('GET', `/posts/${postId}`);
    assert(response.status === 200, `Expected 200, got ${response.status}`, {
      response,
      request: { method: 'GET', url: `/posts/${postId}` },
    });
    assert(response.body?.id === postId, 'Post ID mismatch', {
      response,
      debug: { postId, responseId: response.body?.id },
    });
  });

  await test('GET /posts/:postId - get non-existent post', async () => {
    // Use a valid UUID format for non-existent post
    const response = await makeRequest(
      'GET',
      '/posts/01234567-89ab-cdef-0123-456789abcdef'
    );
    assert(response.status === 404, `Expected 404, got ${response.status}`);
  });

  await test('DELETE /posts/:postId - delete own post', async () => {
    const loginResponse = await login();
    const token = loginResponse.body?.accessToken;

    // Create a post
    const createResponse = await makeRequest(
      'POST',
      '/posts',
      { content: 'Post to be deleted' },
      token
    );
    assert(createResponse.status === 201, 'Failed to create test post');
    const postId = createResponse.body?.id;
    assert(postId, 'Post ID should be defined');

    // Delete it
    const response = await makeRequest(
      'DELETE',
      `/posts/${postId}`,
      null,
      token
    );
    assert(response.status === 204, `Expected 204, got ${response.status}`);

    // Verify it's deleted
    const getResponse = await makeRequest('GET', `/posts/${postId}`);
    assert(getResponse.status === 404, 'Post should not exist anymore');
  });

  // Comments Tests
  await test('POST /posts/:postId/comments - create comment', async () => {
    const loginResponse = await login();
    const token = loginResponse.body?.accessToken;

    // Create a post first
    const createResponse = await makeRequest(
      'POST',
      '/posts',
      { content: 'Post for comment test' },
      token
    );
    assert(createResponse.status === 201, 'Failed to create test post');
    const postId = createResponse.body?.id;
    assert(postId, 'Post ID should be defined');

    // Add a comment
    const response = await makeRequest(
      'POST',
      `/posts/${postId}/comments`,
      { content: 'Test comment' },
      token
    );
    assert(response.status === 201, `Expected 201, got ${response.status}`);
    assert(
      response.body?.content === 'Test comment',
      'Comment content mismatch'
    );
  });

  await test('GET /posts/:postId/comments - list comments', async () => {
    const loginResponse = await login();
    const token = loginResponse.body?.accessToken;

    // Create a post
    const createResponse = await makeRequest(
      'POST',
      '/posts',
      { content: 'Post for comment list test' },
      token
    );
    const postId = createResponse.body?.id;
    assert(postId, 'Post ID should be defined');

    // Add a comment
    await makeRequest(
      'POST',
      `/posts/${postId}/comments`,
      { content: 'Comment 1' },
      token
    );

    // List comments
    const response = await makeRequest('GET', `/posts/${postId}/comments`);
    assert(response.status === 200, `Expected 200, got ${response.status}`);
    assert(Array.isArray(response.body), 'Expected array of comments');
    assert(response.body.length >= 1, 'Should have at least one comment');
  });

  // Likes Tests
  await test('POST /posts/:postId/like - like a post', async () => {
    const loginResponse = await login();
    const token = loginResponse.body?.accessToken;

    // Create a post
    const createResponse = await makeRequest(
      'POST',
      '/posts',
      { content: 'Post to like' },
      token
    );
    const postId = createResponse.body?.id;
    assert(postId, 'Post ID should be defined');

    // Like it
    const response = await makeRequest(
      'POST',
      `/posts/${postId}/like`,
      null,
      token
    );
    assert(response.status === 204, `Expected 204, got ${response.status}`);
  });

  await test('POST /posts/:postId/like - like already liked post (conflict)', async () => {
    const loginResponse = await login();
    const token = loginResponse.body?.accessToken;

    // Create a post
    const createResponse = await makeRequest(
      'POST',
      '/posts',
      { content: 'Post for double like test' },
      token
    );
    const postId = createResponse.body?.id;
    assert(postId, 'Post ID should be defined');

    // Like it
    await makeRequest('POST', `/posts/${postId}/like`, null, token);

    // Try to like again
    const response = await makeRequest(
      'POST',
      `/posts/${postId}/like`,
      null,
      token
    );
    assert(
      response.status === 409,
      `Expected 409 conflict, got ${response.status}`
    );
  });

  await test('DELETE /posts/:postId/like - unlike a post', async () => {
    const loginResponse = await login();
    const token = loginResponse.body?.accessToken;

    // Create a post
    const createResponse = await makeRequest(
      'POST',
      '/posts',
      { content: 'Post to unlike' },
      token
    );
    const postId = createResponse.body?.id;
    assert(postId, 'Post ID should be defined');

    // Like it
    await makeRequest('POST', `/posts/${postId}/like`, null, token);

    // Unlike it
    const response = await makeRequest(
      'DELETE',
      `/posts/${postId}/like`,
      null,
      token
    );
    assert(response.status === 204, `Expected 204, got ${response.status}`);

    // Verify we can like again
    const likeAgainResponse = await makeRequest(
      'POST',
      `/posts/${postId}/like`,
      null,
      token
    );
    assert(likeAgainResponse.status === 204, 'Should be able to like again');
  });

  // Admin-only tests (users endpoints)
  await test('GET /users - admin can access', async () => {
    const loginResponse = await login();
    const token = loginResponse.body?.accessToken;

    // Since we're using admin@admin.fr which is an admin user, should return 200
    const response = await makeRequest('GET', '/users', null, token);
    assert(
      response.status === 200,
      `Expected 200 (admin user), got ${response.status}`
    );
  });

  console.log('\n' + '='.repeat(50));
  console.log(`\n📊 Test Results Summary:`);
  console.log(`   ✅ Passed: ${results.passed}`);
  console.log(`   ❌ Failed: ${results.failed}`);
  console.log(`   📝 Total:  ${results.passed + results.failed}`);

  if (results.errors.length > 0) {
    console.log(`\n❌ Errors:`);
    results.errors.forEach(err => {
      console.log(`   - ${err.test}: ${err.error}`);
    });
  }

  console.log('\n' + '='.repeat(50) + '\n');

  // Exit with appropriate code
  process.exit(results.failed > 0 ? 1 : 0);
}

// Run the tests
runTests();
