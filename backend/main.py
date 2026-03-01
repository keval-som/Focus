"""
FastAPI Main Application for Focus-Aware Browsing Assistant

This module implements the core FastAPI application with batch processing endpoints:
1. POST /api/v1/session/start - Initialize a new browsing session
2. POST /api/v1/session/log - Log a tab visit (fast, no LLM)
3. POST /api/v1/session/analyze_batch - Batch analyze recent activity (every 4 minutes)
4. POST /api/v1/session/end - End a browsing session

The application uses a batch processing model to save API costs and improve context.
The frontend constantly logs tab visits, and every 4 minutes requests a batch analysis.
"""

import os
import json
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from openai import AsyncOpenAI
from dotenv import load_dotenv

from config import BATCH_ANALYSIS_MINUTES
from database import (
    init_db,
    create_session,
    end_session,
    get_session_goal,
    log_tab_visit,
    get_recent_logs,
    save_batch_analysis
)
from models import (
    StartRequest,
    StartResponse,
    LogRequest,
    LogResponse,
    AnalyzeBatchRequest,
    AnalyzeBatchResponse,
    EndRequest
)

# Load environment variables from .env file
load_dotenv()

# Initialize AsyncOpenAI client for Featherless.ai
# Featherless.ai is OpenAI SDK compatible, so we use the standard OpenAI client
# Note: We're using OpenAI SDK but connecting to Featherless.ai API endpoint
featherless_api_key = os.getenv("FEATHERLESS_API_KEY")
featherless_client = None

if featherless_api_key:
    try:
        # Initialize the client only if API key is provided
        # Using OpenAI SDK with Featherless.ai base URL
        featherless_client = AsyncOpenAI(
            api_key=featherless_api_key,
            base_url="https://api.featherless.ai/v1"
        )
    except Exception as e:
        print(f"Warning: Failed to initialize Featherless.ai client: {str(e)}")
        print("LLM features will not work. Please check your API key and dependencies.")
else:
    print("Warning: FEATHERLESS_API_KEY not set. LLM features will not work.")
    print("Please create a .env file with: FEATHERLESS_API_KEY=your_api_key_here")

# Get the extension secret key from environment
EXTENSION_SECRET_KEY = os.getenv("EXTENSION_SECRET_KEY", "hackathon-focus-123")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for FastAPI application.
    
    This function runs on application startup and shutdown.
    - Startup: Initialize the SQLite database
    - Shutdown: Cleanup (if needed in future)
    
    Args:
        app: The FastAPI application instance
    """
    # Startup: Initialize database
    init_db()
    print("FastAPI application started. Database initialized.")
    yield
    # Shutdown: Add any cleanup logic here if needed
    print("FastAPI application shutting down.")


# Create FastAPI application instance
app = FastAPI(
    title="Focus-Aware Browsing Assistant API",
    description="Backend API for analyzing web page alignment with user focus goals",
    version="1.0.0",
    lifespan=lifespan
)

# Configure CORS middleware
# Allow all origins for hackathon development (restrict in production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def verify_extension_key(x_extension_key: Annotated[str, Header()]) -> str:
    """
    Dependency function to verify the Chrome Extension secret key.
    
    This security check ensures only requests from the authorized
    Chrome Extension can access the API endpoints.
    
    Args:
        x_extension_key: The X-Extension-Key header value
    
    Returns:
        str: The verified extension key
    
    Raises:
        HTTPException: 401 Unauthorized if key doesn't match
    """
    if x_extension_key != EXTENSION_SECRET_KEY:
        raise HTTPException(
            status_code=401,
            detail="Invalid extension key. Unauthorized access."
        )
    return x_extension_key


@app.post("/api/v1/session/start", response_model=StartResponse)
async def start_session(
    request: StartRequest,
    _: str = Depends(verify_extension_key)
) -> StartResponse:
    """
    Start a new browsing session with a user-defined focus goal.
    
    This endpoint creates a new session in the database and returns
    a unique session_id that must be used in subsequent requests.
    
    Args:
        request: StartRequest containing the user's goal
        _: Verified extension key (from dependency)
    
    Returns:
        StartResponse: Contains the generated session_id
    
    Raises:
        HTTPException: 500 if database operation fails
    """
    try:
        session_id = create_session(request.goal)
        return StartResponse(session_id=session_id)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create session: {str(e)}"
        )


@app.post("/api/v1/session/log", response_model=LogResponse)
async def log_visit(
    request: LogRequest,
    _: str = Depends(verify_extension_key)
) -> LogResponse:
    """
    Log a tab visit to the database.
    
    This endpoint is designed to be extremely fast - it only writes raw data
    without any AI analysis. The analysis happens later in batch processing.
    NO LLM calls are made here.
    
    Args:
        request: LogRequest containing session_id, url, title, snippet, duration_seconds
        _: Verified extension key (from dependency)
    
    Returns:
        LogResponse: Contains success status
    
    Raises:
        HTTPException: 500 if database operation fails
    """
    try:
        log_tab_visit(
            session_id=request.session_id,
            url=request.url,
            title=request.title,
            snippet=request.snippet,
            duration_seconds=request.duration_seconds
        )
        return LogResponse(success=True)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to log visit: {str(e)}"
        )


@app.post("/api/v1/session/analyze_batch", response_model=AnalyzeBatchResponse)
async def analyze_batch(
    request: AnalyzeBatchRequest,
    _: str = Depends(verify_extension_key)
) -> AnalyzeBatchResponse:
    """
    Batch analyze recent browsing activity for a session.
    
    This endpoint fetches the last 4 minutes of activity and analyzes it together
    to provide better context and save API costs. The logs are sorted by duration
    (longest first) and token optimization is applied (snippets omitted for logs 6+).
    
    Args:
        request: AnalyzeBatchRequest containing session_id
        _: Verified extension key (from dependency)
    
    Returns:
        AnalyzeBatchResponse: Contains focus_score, is_on_track, and coaching_nudge
    
    Raises:
        HTTPException: 404 if session not found/inactive
        HTTPException: 500 for database or LLM API errors
    """
    # Step 1: Get session goal (validates session exists and is active)
    goal = get_session_goal(request.session_id)
    if not goal:
        raise HTTPException(
            status_code=404,
            detail="Session not found or inactive. Please start a new session."
        )
    
    # Step 2: Fetch recent activity
    recent_logs = get_recent_logs(request.session_id, minutes=BATCH_ANALYSIS_MINUTES)
    
    if not recent_logs:
        # No recent activity - return default response
        return AnalyzeBatchResponse(
            focus_score=100,
            is_on_track=True,
            coaching_nudge="No recent activity detected.",
            url_breakdown=[]
        )
    
    # Step 3: Sort logs by duration_seconds in descending order (longest first)
    sorted_logs = sorted(recent_logs, key=lambda x: x["duration_seconds"], reverse=True)
    
    # Step 4: Build combined_logs string with token optimization
    combined_logs_parts = []
    for idx, log in enumerate(sorted_logs):
        url = log.get("url", "")
        title = log.get("title", "")
        duration = log.get("duration_seconds", 0)
        snippet = log.get("snippet", "")
        
        if idx < 5:
            # Top 5 logs: include full context with snippet
            combined_logs_parts.append(
                f"URL: {url} | Title: {title} | Time Spent: {duration}s | Snippet: {snippet}"
            )
        else:
            # Log 6 and beyond: omit snippet to save tokens
            combined_logs_parts.append(
                f"URL: {url} | Title: {title} | Time Spent: {duration}s | (Snippet omitted to save tokens)"
            )
    
    combined_logs = "\n".join(combined_logs_parts)
    
    # Step 5: Construct LLM payload
    if not featherless_client:
        raise HTTPException(
            status_code=500,
            detail="LLM API not configured. Please set FEATHERLESS_API_KEY in .env file."
        )
    
    system_prompt = (
        "You are an AI Focus Coach. Your job is to analyze a user's recent web browsing history "
        "and determine if they are staying focused on their stated goal. Calculate a focus score "
        "from 0-100 based on how much time was spent on goal-aligned vs distracting sites. "
        "You must return a strict JSON object with 4 keys: "
        "`focus_score` (integer 0-100), "
        "`is_on_track` (boolean), "
        "`coaching_nudge` (1-sentence string), and "
        "`url_breakdown` (an array of objects, where each object has `url` (string), "
        "`aligned` (boolean), and `confidence` (float 0.0-1.0) for every unique URL evaluated in this batch)."
    )
    
    user_prompt = (
        f"User Goal: {goal}\n\n"
        f"Recent Activity (Sorted by Time Spent):\n{combined_logs}\n\n"
        "Instructions: Analyze the activity and output the exact JSON format."
    )
    
    try:
        # Call Featherless.ai LLM API
        response = await featherless_client.chat.completions.create(
            model="Qwen/Qwen2.5-7B-Instruct",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.1  # Lower temperature for more consistent analysis
        )
        
        # Extract the JSON response from the LLM
        content = response.choices[0].message.content
        
        # Step 6: Parse JSON response with error handling
        try:
            result = json.loads(content)
        except json.JSONDecodeError as e:
            # Fallback: If JSON parsing fails, provide a safe default response
            print(f"Warning: LLM returned invalid JSON: {str(e)}. Content: {content}")
            return AnalyzeBatchResponse(
                focus_score=50,
                is_on_track=False,
                coaching_nudge="Unable to analyze activity. Please try again.",
                url_breakdown=[]
            )
        
        # Validate required fields exist
        required_fields = ["focus_score", "is_on_track", "coaching_nudge", "url_breakdown"]
        if not all(key in result for key in required_fields):
            # Fallback if fields are missing
            missing = [f for f in required_fields if f not in result]
            print(f"Warning: LLM response missing fields: {missing}")
            return AnalyzeBatchResponse(
                focus_score=50,
                is_on_track=False,
                coaching_nudge="Analysis incomplete. Please try again.",
                url_breakdown=[]
            )
        
        focus_score = int(result["focus_score"])
        is_on_track = bool(result["is_on_track"])
        coaching_nudge = str(result["coaching_nudge"])
        url_breakdown = result.get("url_breakdown", [])
        
        # Validate url_breakdown is a list
        if not isinstance(url_breakdown, list):
            print(f"Warning: url_breakdown is not a list, got {type(url_breakdown)}")
            url_breakdown = []
        
        # Ensure focus_score is in valid range
        focus_score = max(0, min(100, focus_score))
        
        # Step 7: Save batch analysis to database
        try:
            save_batch_analysis(
                session_id=request.session_id,
                focus_score=focus_score,
                is_on_track=is_on_track,
                coaching_nudge=coaching_nudge,
                url_breakdown=url_breakdown
            )
        except Exception as e:
            # Log error but don't fail the request - we still have the LLM result
            print(f"Warning: Failed to save batch analysis to database: {str(e)}")
        
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        # Handle any other errors (network, API, etc.)
        raise HTTPException(
            status_code=500,
            detail=f"LLM API error: {str(e)}"
        )
    
    # Step 8: Return the analysis result
    return AnalyzeBatchResponse(
        focus_score=focus_score,
        is_on_track=is_on_track,
        coaching_nudge=coaching_nudge,
        url_breakdown=url_breakdown
    )


@app.post("/api/v1/session/end")
async def end_session_endpoint(
    request: EndRequest,
    _: str = Depends(verify_extension_key)
) -> dict:
    """
    End an active browsing session.
    
    This endpoint marks the session as inactive in the database.
    The session data and logs remain for analytics purposes.
    
    Args:
        request: EndRequest containing the session_id
        _: Verified extension key (from dependency)
    
    Returns:
        dict: {"success": True} on successful completion
    
    Raises:
        HTTPException: 500 if database operation fails
    """
    try:
        end_session(request.session_id)
        return {"success": True}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to end session: {str(e)}"
        )


# Health check endpoint (optional, useful for monitoring)
@app.get("/health")
async def health_check() -> dict:
    """
    Health check endpoint for monitoring and deployment verification.
    
    Returns:
        dict: Status information
    """
    return {
        "status": "healthy",
        "service": "Focus-Aware Browsing Assistant API"
    }


if __name__ == "__main__":
    import uvicorn
    # Run the server (for development)
    # In production, use: uvicorn main:app --host 0.0.0.0 --port 8000
    uvicorn.run(app, host="0.0.0.0", port=8000)
