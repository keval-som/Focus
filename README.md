# 🎯 Focus-Aware Browsing Assistant

An **intentional browsing assistant** that keeps you aligned with your goal while working online. Built as a Manifest V3 Chrome Extension with a React popup and a FastAPI backend that uses LLM to analyze page alignment with user goals.

---

## Project Architecture

This project consists of two main components:
- **Frontend**: Chrome Extension (Manifest V3) with React popup
- **Backend**: FastAPI server with SQLite database and Featherless.ai LLM integration

---

## Directory Structure

```
Focus/
├── backend/                  # Python FastAPI backend
│   ├── database.py          # SQLite database setup and helper functions
│   ├── models.py            # Pydantic request/response schemas
│   ├── main.py              # FastAPI app with 3 endpoints
│   ├── requirements.txt     # Python dependencies
│   ├── focus.db             # SQLite database (auto-generated)
│   └── .env                 # Environment variables (create from .env.example)
├── frontend/                # Chrome Extension
│   ├── assets/              # Extension icons (16×16, 48×48, 128×128 PNGs)
│   ├── background/
│   │   └── background.js    # Service worker — listens for tab events
│   ├── content/
│   │   └── content.js       # Injected into every page — floating goal bar
│   ├── popup/
│   │   ├── App.jsx          # React root component
│   │   ├── index.html       # Popup HTML shell
│   │   ├── index.js         # React entry point
│   │   └── style.css        # Popup styles
│   ├── manifest.json        # Chrome Extension Manifest V3
│   ├── package.json         # Node dependencies & build scripts
│   └── webpack.config.js    # Webpack bundler config
└── README.md                # This file
```

---

## Backend Setup

### Prerequisites
- Python 3.8+
- pip

### Installation

1. **Navigate to backend directory:**
   ```bash
   cd backend
   ```

2. **Install Python dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Create `.env` file:**
   ```bash
   # Copy the example and add your API key
   cp .env.example .env
   ```
   
   Edit `.env` and add:
   ```env
   FEATHERLESS_API_KEY=your_api_key_here
   EXTENSION_SECRET_KEY=hackathon-focus-123
   ```

4. **Run the FastAPI server:**
   ```bash
   # Development mode with auto-reload
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   
   # Or using Python directly
   python main.py
   ```

   The API will be available at `http://localhost:8000`
   - API Documentation: `http://localhost:8000/docs`
   - Health Check: `http://localhost:8000/health`

### Backend API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/session/start` | POST | Start a new browsing session with a goal |
| `/api/v1/session/analyze` | POST | Analyze if a URL aligns with the session goal |
| `/api/v1/session/end` | POST | End an active browsing session |
| `/health` | GET | Health check endpoint |

**Security**: All endpoints require the `X-Extension-Key` header matching `EXTENSION_SECRET_KEY` from `.env`.

### Backend Features

- **SQLite Database**: Stores sessions and analysis logs (acts as both analytics and cache)
- **LLM Integration**: Uses Featherless.ai API (OpenAI SDK compatible) with Qwen/Qwen2.5-7B-Instruct model
- **Caching**: Automatically caches URL analyses to reduce API calls
- **Error Handling**: Robust error handling with proper HTTP status codes
- **SQL Injection Protection**: All queries use parameterized statements

### Backend Tech Stack

- **FastAPI** — Modern, fast web framework
- **Pydantic** — Data validation and serialization
- **SQLite3** — Local database for sessions and logs
- **OpenAI SDK** — Compatible with Featherless.ai API
- **python-dotenv** — Environment variable management
- **Uvicorn** — ASGI server

---

## Frontend Setup

### Prerequisites
- Node.js 16+
- npm

### Installation

1. **Navigate to frontend directory:**
   ```bash
   cd frontend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build the popup bundle:**
   ```bash
   # One-time production build
   npm run build
   
   # Or watch mode during development
   npm run dev
   ```

4. **Load into Chrome:**
   1. Open `chrome://extensions`
   2. Enable **Developer Mode** (top-right toggle)
   3. Click **Load unpacked**
   4. Select the `frontend/` folder
   5. Pin the extension and click the icon to open the popup

### Frontend Features

| Feature | Status |
|---------|--------|
| React popup with goal input | ✅ |
| Start Session / End Session buttons | ✅ |
| Floating goal bar on every page | ✅ |
| Tab activation / update logging | ✅ |
| Goal persistence (chrome.storage) | 🔜 |
| AI goal-alignment check | ✅ (via backend) |
| Distraction nudges | 🔜 |
| Session summary | 🔜 |

### Frontend Tech Stack

- **Chrome Manifest V3** — Modern extension platform
- **React 18** — Popup UI
- **Webpack 5 + Babel** — JSX bundling
- **Vanilla JS** — Content and background scripts (no framework overhead)

---

## How It Works

1. **User starts a session** via the Chrome Extension popup, setting a focus goal
2. **Extension sends requests** to the FastAPI backend when analyzing pages
3. **Backend checks cache** first (SQLite database) for previously analyzed URLs
4. **If cache miss**, backend calls Featherless.ai LLM to analyze page alignment
5. **Result is cached** in SQLite for future requests and analytics
6. **Extension displays** alignment status and confidence to the user

---

## Development

### Backend Development
- The backend uses SQLite for simplicity (no separate database server needed)
- Database file `focus.db` is created automatically on first run
- API documentation is available at `/docs` when server is running
- All endpoints are protected by extension key authentication

### Frontend Development
- Use `npm run dev` for watch mode during development
- Extension hot-reloads when you rebuild (reload extension in Chrome)
- Background and content scripts use vanilla JS for performance

---

## Environment Variables

### Backend `.env` file:
```env
# Featherless.ai API Key for LLM integration
FEATHERLESS_API_KEY=your_api_key_here

# Secret key for Chrome Extension authentication
EXTENSION_SECRET_KEY=hackathon-focus-123
```

---

## Permissions Used

| Permission | Reason |
|------------|--------|
| `activeTab` | Read the currently active tab's URL |
| `storage` | Persist session goal across tabs |
| `scripting` | Programmatically inject scripts if needed |

---

## Future Enhancements

- **Session Analytics**: View browsing patterns and alignment statistics
- **Distraction Nudges**: Proactive warnings when off-goal browsing detected
- **Goal Templates**: Pre-defined goals for common tasks
- **Multi-session Support**: Track multiple concurrent goals
- **Export Data**: Download session summaries and analytics

---

## License

Built for QuackHack 2026 - 24-hour hackathon project.
