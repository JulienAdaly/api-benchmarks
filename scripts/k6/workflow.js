import http from 'k6/http';
import { check, sleep } from 'k6';

// Base URL defaults to go-fiber (can be overridden via BASE_URL env var)
// Available backends in docker-compose:
// - go-fiber: http://localhost:8080
// - js-effect: http://localhost:3000
// - js-express: http://localhost:3001
// - python-fastapi: http://localhost:8000
// - rust-axum: http://localhost:8081
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

// Admin credentials (used to create/delete the per-VU user)
const ADMIN_EMAIL = __ENV.ADMIN_EMAIL || __ENV.EMAIL || 'john.doe@example.com';
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD || __ENV.PASSWORD || 's3cureP@ssw0rd';

// Execution model
const VUS = Number(__ENV.VUS || 1);
const DURATION = __ENV.DURATION; // e.g. '5m' for continuous run
const ITERATIONS = __ENV.ITERATIONS !== undefined ? Number(__ENV.ITERATIONS) : 1;

export const options = DURATION
  ? {
      scenarios: {
        workflow: {
          executor: 'constant-vus',
          vus: VUS,
          duration: DURATION,
          exec: 'default',
        },
      },
      thresholds: {
        http_req_failed: ['rate<0.05'],
        http_req_duration: ['p(95)<800'],
      },
    }
  : {
      vus: VUS,
      iterations: ITERATIONS,
      thresholds: {
        http_req_failed: ['rate<0.05'],
        http_req_duration: ['p(95)<800'],
      },
    };

function safeJson(res) {
  try { return res.json(); } catch { return null; }
}

function authHeaders(token) {
  return { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } };
}

export default function () {
  // 1) Admin login
  const adminLogin = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  check(adminLogin, { '1 admin login 200': (r) => r.status === 200 });
  if (adminLogin.status !== 200) { sleep(1); return; }
  const adminToken = adminLogin.json('accessToken');
  const adminAh = authHeaders(adminToken);

  // 2) Admin get me
  const adminMe = http.get(`${BASE_URL}/auth/me`, adminAh);
  check(adminMe, { '2 admin GET /auth/me 200': (r) => r.status === 200 });
  if (adminMe.status !== 200) { sleep(1); return; }

  // 3) Admin create user with empty bio
  const unique = `${Date.now()}_${__VU}_${__ITER}`;
  const newUser = {
    username: `k6_user_${unique}`,
    email: `k6_${unique}@example.com`,
    password: `P@ss-${unique}`,
  };
  const createUser = http.post(`${BASE_URL}/users`, JSON.stringify(newUser), adminAh);
  check(createUser, { '3 POST /users 201': (r) => r.status === 201 });
  if (createUser.status !== 201) { sleep(1); return; }
  const createdUser = safeJson(createUser);
  const userId = createdUser && createdUser.id;
  if (!userId) { sleep(1); return; }

  // 4) Admin list users
  const listUsers = http.get(`${BASE_URL}/users?limit=10&offset=0`, adminAh);
  check(listUsers, { '4 GET /users 200': (r) => r.status === 200 });

  // 5) Admin get user by id
  const getUser = http.get(`${BASE_URL}/users/${userId}`, adminAh);
  check(getUser, { '5 GET /users/{id} 200': (r) => r.status === 200 });

  // 6) Admin update user bio to "updated by k6 at {date}"
  const bio = `updated by k6 at ${new Date().toISOString()}`;
  const updateUser = http.put(`${BASE_URL}/users/${userId}`, JSON.stringify({ bio }), adminAh);
  check(updateUser, { '6 PUT /users/{id} 200': (r) => r.status === 200 });

  // 7) User login (with user created above)
  const userLogin = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: newUser.email, password: newUser.password }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  check(userLogin, { '7 user login 200': (r) => r.status === 200 });
  if (userLogin.status !== 200) { sleep(1); return; }
  const userToken = userLogin.json('accessToken');
  const userAh = authHeaders(userToken);

  // 8) User get me
  const userMe = http.get(`${BASE_URL}/auth/me`, userAh);
  check(userMe, { '8 user GET /auth/me 200': (r) => r.status === 200 });

  // 9) User create post
  const createPost = http.post(`${BASE_URL}/posts`, JSON.stringify({ content: 'k6 post' }), userAh);
  check(createPost, { '9 POST /posts 201': (r) => r.status === 201 });
  if (createPost.status !== 201) { sleep(1); return; }
  const createdPost = safeJson(createPost);
  const postId = createdPost && createdPost.id;
  if (!postId) { sleep(1); return; }

  // 10) User list posts
  const listPosts = http.get(`${BASE_URL}/posts?limit=5&offset=0`, userAh);
  check(listPosts, { '10 GET /posts 200': (r) => r.status === 200 });

  // 11) User get post created previously
  const getPost = http.get(`${BASE_URL}/posts/${postId}`, userAh);
  check(getPost, { '11 GET /posts/{id} 200': (r) => r.status === 200 });

  // 12) User create comment on that post
  const addComment = http.post(
    `${BASE_URL}/posts/${postId}/comments`,
    JSON.stringify({ content: 'Nice!' }),
    userAh
  );
  check(addComment, { '12 POST /posts/{id}/comments 201': (r) => r.status === 201 });

  // 13) User list comments on that post
  const listComments = http.get(`${BASE_URL}/posts/${postId}/comments`, userAh);
  check(listComments, { '13 GET /posts/{id}/comments 200': (r) => r.status === 200 });

  // 14) User like post
  const like = http.post(`${BASE_URL}/posts/${postId}/like`, null, userAh);
  check(like, { '14 POST /posts/{id}/like 204/409': (r) => r.status === 204 || r.status === 409 });

  // 15) User unlike post
  const unlike = http.del(`${BASE_URL}/posts/${postId}/like`, null, userAh);
  check(unlike, { '15 DELETE /posts/{id}/like 204/404': (r) => r.status === 204 || r.status === 404 });

  // 16) User delete post
  const delPost = http.del(`${BASE_URL}/posts/${postId}`, null, userAh);
  check(delPost, { '16 DELETE /posts/{id} 204': (r) => r.status === 204 });

  // 17) Admin delete user
  const delUser = http.del(`${BASE_URL}/users/${userId}`, null, adminAh);
  check(delUser, { '17 DELETE /users/{id} 204': (r) => r.status === 204 });

  // sleep(0.5);
}


