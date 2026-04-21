
# Chapter 7 — Deployment

Three deployment paths are supported, from simplest to most production-grade:

1. **Local development** — two shells, one each for backend and frontend
2. **Docker Compose** — a single command, two containers on one host
3. **AWS ECS Fargate** — CloudFormation-provisioned two-container task
   behind an ALB

## 7.1 Local development

### 7.1.1 Backend

```bash
cd backend
python3 -m venv venv           # optional but recommended
source venv/bin/activate
pip install -r requirements.txt

# (Optional) download the MediaPipe model for the new Tasks API:
curl -sL -o hand_landmarker.task \
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"

python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

The backend will log which MediaPipe API it picked:

```
[INFO] Using MediaPipe Tasks API (new)
```

### 7.1.2 Frontend

```bash
cd frontend
npm install
npx vite --host
```

Open http://localhost:5173.

### 7.1.3 Environment variables

Copy [`.env.example`](../frontend/.env.example) to `.env.local` and set:

```dotenv
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000
```

For backend, export:

```bash
export CORS_ORIGINS="http://localhost:5173"
export DB_PATH="./scores.db"
```

## 7.2 Docker Compose

The provided [`docker-compose.yml`](../docker-compose.yml) builds both
services and wires them together on a private network:

```bash
docker compose up --build
```

| Service | Image | Port (host → container) | Notes |
|---------|-------|-------------------------|-------|
| `tetris-backend` | built from `backend/Dockerfile.backend` | 8000 → 8000 | Mounts a Docker volume at `/data` for the SQLite file |
| `tetris-frontend` | built from `frontend/Dockerfile.frontend` | 8080 → 80 | Nginx-served static build |

Open: http://localhost:8080.

### Health check

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 15s
```

The frontend service has `depends_on: { tetris-backend: { condition:
service_healthy } }` so it won't start serving until the backend passes
its first health-check. This avoids the race where users load the SPA
and immediately get a connection error.

### Persistent volume

```yaml
volumes:
  tetris-data:
    driver: local
```

Scores live in the `tetris-data` named volume → file at `/data/scores.db`.
Destroy and recreate the container all you like; the leaderboard survives.

## 7.3 AWS ECS Fargate

Template: [`aws/cf/tetris.yaml`](../aws/cf/tetris.yaml) (~200 lines).

### 7.3.1 Resources provisioned

```
┌──── VPC (10.0.0.0/16) ────────────────────────────────────┐
│                                                           │
│   ┌── Subnet1 (10.0.1.0/28, AZa) ─┐ ┌─ Subnet2 (AZb) ─┐   │
│   │                                │ │                 │   │
│   │    ┌── ECS Fargate Task ──┐    │ │                 │   │
│   │    │ backend :8000        │    │ │  (symmetric)    │   │
│   │    │ frontend :80         │    │ │                 │   │
│   │    └──────────────────────┘    │ │                 │   │
│   └────────────────────────────────┘ └─────────────────┘   │
│                   │                          │             │
│                   ▼                          ▼             │
│   ┌─────────────── ALB (port 80) ─────────────────┐        │
│   │ forward * → frontend TG → :80 container       │        │
│   └───────────────────────────────────────────────┘        │
│                          ▲                                 │
│                          │ HTTP                            │
└──────────────────────────┼─────────────────────────────────┘
                           │
                       Internet
```

- **2 subnets** across different AZs for ALB high-availability (AWS
  requires at least 2 AZs for an ALB).
- **Task definition** runs both containers (frontend + backend) in one
  task; they share localhost networking, which means the frontend's
  Nginx doesn't technically need to know the backend URL (if we
  eventually front-end-route `/api` to `localhost:8000` inside the
  task, which is a future enhancement).
- **CPU/Memory** — 512 / 1024 Fargate units.

### 7.3.2 Deploy

```bash
# 1. Create ECR repositories (one-time)
aws ecr create-repository --repository-name tetris-backend
aws ecr create-repository --repository-name tetris-frontend

# 2. Authenticate Docker to ECR
aws ecr get-login-password --region <REGION> \
  | docker login --username AWS --password-stdin \
      <ACCOUNT>.dkr.ecr.<REGION>.amazonaws.com

# 3. Build + push
docker build -t tetris-backend  -f backend/Dockerfile.backend   ./backend
docker build -t tetris-frontend -f frontend/Dockerfile.frontend ./frontend

docker tag tetris-backend:latest  <ACCOUNT>.dkr.ecr.<REGION>.amazonaws.com/tetris-backend:latest
docker tag tetris-frontend:latest <ACCOUNT>.dkr.ecr.<REGION>.amazonaws.com/tetris-frontend:latest
docker push                      <ACCOUNT>.dkr.ecr.<REGION>.amazonaws.com/tetris-backend:latest
docker push                      <ACCOUNT>.dkr.ecr.<REGION>.amazonaws.com/tetris-frontend:latest

# 4. Deploy the stack
aws cloudformation create-stack \
  --stack-name tetris \
  --template-body file://aws/cf/tetris.yaml \
  --parameters \
    ParameterKey=TetrisBackendImage,ParameterValue=<ACCOUNT>.dkr.ecr.<REGION>.amazonaws.com/tetris-backend:latest \
    ParameterKey=TetrisFrontendImage,ParameterValue=<ACCOUNT>.dkr.ecr.<REGION>.amazonaws.com/tetris-frontend:latest \
  --capabilities CAPABILITY_IAM
```

After ~5 minutes, grab the `ALBPublicDNS` output:

```bash
aws cloudformation describe-stacks --stack-name tetris \
  --query "Stacks[0].Outputs[?OutputKey=='ALBPublicDNS'].OutputValue" --output text
```

Browse to `http://<that-dns>`.

### 7.3.3 Known limitations of the provided template

The template is a **starting point**, not a production-hardened one.
Things you'd change for real prod:

| Concern | Current | Improvement |
|---------|---------|-------------|
| HTTPS | HTTP-only ALB | Add an ACM certificate + HTTPS listener + redirect |
| Secrets | `ExecutionRoleArn` hard-coded to `123456789012:…` | Parameterize |
| Stateful scores | In-memory / task-local SQLite = lost on redeploy | Mount EFS or migrate to RDS/DynamoDB |
| Horizontal scaling | `DesiredCount: 1` | Autoscaling policy; move rate limiter to Redis |
| WAF | none | Add AWS WAF to the ALB |
| Logging | none | Add a CloudWatch log driver to the task def |

## 7.4 Frontend Dockerfile walkthrough

```Dockerfile
# Dockerfile.frontend
FROM node:18-alpine as build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

- **Multi-stage build** so the final image is tiny (~25 MB).
- Nginx's default config serves `dist/` as static files. Works fine
  for a single-page React app with client-side routing because the
  default Nginx `try_files` is `index.html` for unmatched paths via
  the default config.

## 7.5 Backend Dockerfile walkthrough

```Dockerfile
FROM python:3.10-slim
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx libglib2.0-0 libsm6 libxext6 libxrender-dev curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install 'uvicorn[standard]'
COPY . .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- `libgl1-mesa-glx` + X-render libs — OpenCV needs them even headless
  for its image codec paths.
- `curl` is here so the docker-compose healthcheck can actually run
  the `curl -f` command.
- Uses **Python 3.10-slim** as a stable base. If you want to try 3.13+,
  the pinned pydantic v2 / fastapi 0.115 combo still works (see
  [chapter 9 §1](./09-bugfix-history.md)).

---

Next: [**Chapter 8 — Testing**](./08-testing.md).
