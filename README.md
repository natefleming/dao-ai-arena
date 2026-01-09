# ⚔️ DAO AI Arena

**Modern React application to compare AI agents from Databricks Model Serving and Databricks Apps**

[![React](https://img.shields.io/badge/React-18-blue.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue.svg)](https://www.typescriptlang.org/)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![Databricks](https://img.shields.io/badge/Databricks-Apps-orange.svg)](https://docs.databricks.com/en/dev-tools/databricks-apps/)

---

## 🎯 Overview

A modern web application built with React + Flask that lets you dynamically compare multiple AI model endpoints side-by-side.

### Key Features

- 🎨 **Modern React UI** - Beautiful, responsive interface built with TypeScript and TailwindCSS
- ➕ **Dynamic Model Addition** - Add unlimited models to compare (not limited to 2!)
- 🔍 **Real Endpoint Discovery** - Automatically discovers Model Serving endpoints and Databricks Apps
- ⚡ **Side-by-Side Comparison** - View responses from multiple models simultaneously
- 📊 **Latency Tracking** - Measure and compare response times
- 🎭 **No Hardcoded Models** - All endpoints fetched dynamically from your workspace

### Why This Exists

The standard Databricks Playground only supports Model Serving endpoints. This application:

- ✅ Supports **both** Model Serving endpoints AND Databricks Apps
- ✅ Allows comparison of **unlimited** models (not just 2)
- ✅ Modern, professional UI with better UX
- ✅ Real-time endpoint discovery

| Deployment Method | Description |
|-------------------|-------------|
| **Model Serving** | REST API endpoints with autoscaling, low-latency inference |
| **Databricks Apps** | Interactive applications with custom UI/UX |

---

## 🚀 Quick Start

### Prerequisites

- **Python 3.11+** for backend
- **Node.js 18+** and npm for frontend
- **Databricks CLI** configured with authentication
- Access to a Databricks workspace with Model Serving and/or Databricks Apps

### Deploy to Databricks Apps

The deployment script handles everything - building React, uploading files, and deploying:

```bash
# One-command deployment
./deploy.sh

# Deploy to specific workspace
./deploy.sh --profile my-workspace

# Clean deployment (delete and recreate)
./deploy.sh --force
```

**What the script does:**
1. ✅ Checks prerequisites
2. ✅ Builds React frontend
3. ✅ Uploads backend + frontend to workspace
4. ✅ Deploys to Databricks Apps
5. ✅ Provides app URL

### Local Development

#### Backend (Flask API)

```bash
cd backend
pip install -r requirements.txt

# Set environment variables
export DATABRICKS_HOST="https://your-workspace.databricks.com"
export DATABRICKS_TOKEN="your-token"

# Run backend
python main.py
```

Backend runs on `http://localhost:8080`

#### Frontend (React)

```bash
cd frontend
npm install

# Run development server
npm run dev
```

Frontend runs on `http://localhost:3000` (proxies API calls to backend)

#### Full Stack

Open two terminals:

**Terminal 1 - Backend:**
```bash
cd backend && python main.py
```

**Terminal 2 - Frontend:**
```bash
cd frontend && npm run dev
```

Visit `http://localhost:3000`

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    DAO AI Arena (Gradio)                   │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ Battle Mode │  │ Single Mode │  │ Custom Endpoints        │  │
│  │ (Side-by-   │  │ (Test one   │  │ (Add external           │  │
│  │  side)      │  │  endpoint)  │  │  endpoints)             │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────────┘
                            │
        ┌───────────────────┴───────────────────┐
        │           Endpoint Manager            │
        │  (Discovery + Invocation)             │
        └───────────────────┬───────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ Model Serving │   │ Databricks    │   │ Custom        │
│ Endpoints     │   │ Apps          │   │ Endpoints     │
│ (REST API)    │   │ (Web Apps)    │   │ (External)    │
└───────────────┘   └───────────────┘   └───────────────┘
        │                   │                   │
        └───────────────────┼───────────────────┘
                            │
                    ┌───────┴───────┐
                    │ MLFlow        │
                    │ Tracing       │
                    └───────────────┘
```

---

## 📁 Project Structure

```
dao-ai-arena/
├── app.py                    # Main Gradio application
├── databricks.yml            # Databricks Asset Bundle config
├── pyproject.toml            # Python project configuration
├── requirements.txt          # Python dependencies
├── README.md                 # This file
├── src/
│   ├── __init__.py
│   ├── config.py             # Application configuration
│   ├── endpoints.py          # Endpoint discovery & invocation
│   ├── tracing.py            # MLFlow tracing integration
│   └── battle.py             # Battle mode logic
└── resources/                # Static resources
```

---

## ⚔️ Battle Mode

Battle Mode mimics the LM Arena experience:

1. **Select Two Endpoints**: Choose any combination of Model Serving endpoints and Databricks Apps
2. **Anonymous Mode**: Models are randomly assigned to "Model A" and "Model B" to prevent bias
3. **Send a Prompt**: Both endpoints receive the same input simultaneously
4. **Stream Responses**: Watch responses stream in side-by-side
5. **Vote**: Choose the better response (or tie/both bad)
6. **Reveal**: See which model was which after voting

### Voting Options

| Vote | Description |
|------|-------------|
| 🅰️ Model A is Better | First response was higher quality |
| 🅱️ Model B is Better | Second response was higher quality |
| 🤝 Tie | Both responses equally good |
| 👎 Both Bad | Neither response was satisfactory |

---

## 📊 MLFlow Tracing

Every inference request is automatically traced with MLFlow:

- **Span Visualization**: See the waterfall view of execution spans
- **Latency Breakdown**: Identify bottlenecks in the inference pipeline
- **Input/Output Capture**: View exactly what was sent and received
- **Direct Links**: Click through to the full MLFlow UI

### Trace Visualization

The embedded trace viewer shows:

```
📊 MLFlow Trace
├── [✓] inference_my-model (1,234ms)
│   ├── [✓] preprocessing (45ms)
│   ├── [✓] model_inference (1,150ms)
│   └── [✓] postprocessing (39ms)
```

---

## 🔧 Custom Inputs (Databricks Agent Format)

For agents that support the Databricks Responses Agent input signature:

```json
{
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Hello!"}
  ],
  "context": {
    "user_id": "user123",
    "session_id": "session456"
  },
  "custom_inputs": {
    "retrieval_config": {
      "max_documents": 5,
      "filter": {"category": "technical"}
    }
  },
  "databricks_options": {
    "timeout": 60,
    "return_trace": true
  }
}
```

---

## 🎛️ Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABRICKS_HOST` | Databricks workspace URL | Required |
| `DATABRICKS_TOKEN` | Personal access token or OAuth token | Required |
| `MLFLOW_TRACKING_URI` | MLFlow tracking server | `databricks` |
| `MLFLOW_EXPERIMENT_NAME` | Experiment for traces | `/Shared/dao-ai-arena` |

### Bundle Variables

Configure in `databricks.yml`:

```yaml
variables:
  databricks_host:
    default: "https://your-workspace.databricks.com"
  mlflow_experiment_name:
    default: "/Shared/dao-ai-arena"
  app_name:
    default: "dao-ai-arena"
```

---

## 🚢 Deployment

### Configure Authentication

```bash
# Option A: Default profile
databricks configure --token

# Option B: Named profile for multiple workspaces
databricks configure --profile my-workspace --token
```

### Deploy

```bash
# Deploy to default workspace
./deploy.sh

# Deploy to specific workspace
./deploy.sh --profile my-workspace

# Clean deployment (delete and recreate)
./deploy.sh --force
```

The deployment script will:
1. ✅ Check prerequisites and authentication
2. ✅ Create the app (if it doesn't exist)
3. ✅ Upload source code to workspace
4. ✅ Deploy the app
5. ✅ Provide the app URL

Your app will be available at:
```
https://<workspace>.databricks.com/apps/dao-ai-arena
```

### Multi-Workspace Deployment

```bash
# Configure profiles
databricks configure --profile aws-workspace
databricks configure --profile azure-workspace

# Deploy to each workspace
./deploy.sh --profile aws-workspace
./deploy.sh --profile azure-workspace
```

### CI/CD Integration

Add to your GitHub Actions workflow:

```yaml
- name: Deploy to Databricks
  run: |
    databricks bundle deploy -t prod
  env:
    DATABRICKS_HOST: ${{ secrets.DATABRICKS_HOST }}
    DATABRICKS_TOKEN: ${{ secrets.DATABRICKS_TOKEN }}
```

---

## 📈 Statistics

The Statistics tab shows aggregate metrics:

- **Total Battles**: Number of completed comparisons
- **Win Rates**: Model Serving vs Databricks Apps win counts
- **Average Latency**: Per deployment type
- **Per-Endpoint Stats**: Individual endpoint performance

---

## 🧪 Development

### Running Tests

```bash
pytest tests/ -v
```

### Code Formatting

```bash
ruff format .
ruff check --fix .
```

### Type Checking

```bash
mypy src/ app.py
```

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

Apache 2.0 - See [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

- [LM Arena / Chatbot Arena](https://lmarena.ai/) - Inspiration for the battle mode UX
- [Databricks](https://databricks.com/) - Platform and SDK
- [MLFlow](https://mlflow.org/) - Tracing and experiment tracking
- [Gradio](https://gradio.app/) - UI framework

---

<p align="center">
  <strong>Built with ❤️ for the Databricks community</strong>
</p>
