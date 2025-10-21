Run the Express server mirroring the FastAPI app

Requirements:
- Node.js 18+

Install deps:
```bash
npm install express pg jsonwebtoken bcryptjs
```

Run:
```bash
node src/main.js
```

Environment variables (optional):
- `DATABASE_URL` (default: `postgresql://apibench:apibench_password@localhost:15432/apibench`)
- `JWT_SECRET` (default: `dev-secret`)
- `JWT_EXPIRE_MINUTES` (default: `60`)
- `QUERIES_DIR` (override SQL directory if needed)



