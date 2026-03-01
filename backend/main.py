"""
FastAPI Main Application for Focus-Aware Browsing Assistant

This module implements the core FastAPI application with three endpoints:
1. POST /api/v1/session/start - Initialize a new browsing session
2. POST /api/v1/session/analyze - Analyze URL alignment with user goal
3. POST /api/v1/session/end - End a browsing session

The application acts as an intermediary between the Chrome Extension and
the Featherless.ai LLM API, with SQLite serving as both analytics logger
and response cache.
"""

import os
import json
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from openai import AsyncOpenAI
from dotenv import load_dotenv

from database import (
    init_db,
    create_session,
    end_session,
    get_session_goal,
    get_cached_log,
    save_log
)
from models import (
    StartRequest,
    StartResponse,
    AnalyzeRequest,
    AnalyzeResponse,
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


@app.post("/api/v1/session/analyze", response_model=AnalyzeResponse)
async def analyze_url(
    request: AnalyzeRequest,
    _: str = Depends(verify_extension_key)
) -> AnalyzeResponse:
    """
    Analyze whether a URL aligns with the user's session goal.
    
    This endpoint implements a two-tier strategy:
    1. Cache Check: First checks SQLite for a cached analysis
    2. LLM Call: If cache miss, calls Featherless.ai LLM API
    
    The result is always saved to the database (for analytics and future caching).
    
    Args:
        request: AnalyzeRequest containing session_id, url, title, snippet
        _: Verified extension key (from dependency)
    
    Returns:
        AnalyzeResponse: Contains aligned, confidence, reason, and cached flag
    
    Raises:
        HTTPException: 404 if session not found/inactive
        HTTPException: 500 for database or LLM API errors
    """
    # Step 1: Check cache first
    cached_result = get_cached_log(request.session_id, request.url)
    if cached_result:
        return AnalyzeResponse(
            aligned=cached_result["aligned"],
            confidence=cached_result["confidence"],
            reason=cached_result["reason"],
            cached=True
        )
    
    # Step 2: Get session goal (validates session exists and is active)
    goal = get_session_goal(request.session_id)
    if not goal:
        raise HTTPException(
            status_code=404,
            detail="Session not found or inactive. Please start a new session."
        )
    
    # Step 3: Construct LLM prompt and call API
    if not featherless_client:
        raise HTTPException(
            status_code=500,
            detail="LLM API not configured. Please set FEATHERLESS_API_KEY in .env file."
        )
    
    system_prompt = (
        "You are an objective productivity classifier. "
        "Analyze whether a web page aligns with a user's stated goal. "
        "Respond ONLY in strict JSON schema: "
        '{"aligned": boolean, "confidence": float, "reason": string}'
    )
    
    user_prompt = (
        f"User's Goal: {goal}\n\n"
        f"Page Title: {request.title}\n\n"
        f"Page Content Snippet: {request.snippet}\n\n"
        f"URL: {request.url}\n\n"
        "Determine if this page aligns with the user's goal. "
        "Provide a boolean 'aligned' value, a confidence score (0.0 to 1.0), "
        "and a brief reason explaining your decision."
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
            temperature=0.3  # Lower temperature for more consistent classification
        )
        
        # Extract the JSON response from the LLM
        content = response.choices[0].message.content
        
        # Step 4: Parse JSON response
        try:
            result = json.loads(content)
        except json.JSONDecodeError as e:
            # Fallback: If JSON parsing fails, create a safe default response
            raise HTTPException(
                status_code=500,
                detail=f"LLM returned invalid JSON: {str(e)}. Content: {content}"
            )
        
        # Validate required fields exist
        if not all(key in result for key in ["aligned", "confidence", "reason"]):
            raise HTTPException(
                status_code=500,
                detail="LLM response missing required fields"
            )
        
        aligned = bool(result["aligned"])
        confidence = float(result["confidence"])
        reason = str(result["reason"])
        
        # Ensure confidence is in valid range
        confidence = max(0.0, min(1.0, confidence))
        
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        # Handle any other errors (network, API, etc.)
        raise HTTPException(
            status_code=500,
            detail=f"LLM API error: {str(e)}"
        )
    
    # Step 5: Save to database (for analytics and future caching)
    try:
        save_log(
            session_id=request.session_id,
            url=request.url,
            title=request.title,
            snippet=request.snippet,
            aligned=aligned,
            confidence=confidence,
            reason=reason
        )
    except Exception as e:
        # Log error but don't fail the request - we still have the LLM result
        print(f"Warning: Failed to save log to database: {str(e)}")
    
    # Step 6: Return the analysis result
    return AnalyzeResponse(
        aligned=aligned,
        confidence=confidence,
        reason=reason,
        cached=False
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
