"""
Pydantic Models for Focus-Aware Browsing Assistant API

This module defines all request and response schemas using Pydantic v2.
These models provide:
- Automatic request validation
- Type safety
- Clear API documentation (OpenAPI/Swagger)
- Serialization/deserialization
"""

from pydantic import BaseModel, Field
from typing import List


class StartRequest(BaseModel):
    """
    Request model for starting a new browsing session.
    
    Attributes:
        goal: The user's focus goal for this browsing session.
              Example: "Research Python async programming best practices"
    """
    goal: str = Field(
        ...,
        min_length=1,
        max_length=500,
        description="The user's focus goal for this browsing session"
    )


class StartResponse(BaseModel):
    """
    Response model for session start endpoint.
    
    Attributes:
        session_id: Unique UUID string identifying this browsing session.
                    This ID must be used in all subsequent analyze and end requests.
    """
    session_id: str = Field(
        ...,
        description="Unique session identifier (UUID)"
    )


class LogRequest(BaseModel):
    """
    Request model for logging a tab visit.
    
    Attributes:
        session_id: The UUID of the active browsing session
        url: The URL of the visited page
        title: The page title
        snippet: A text snippet or preview of the page content
        duration_seconds: Time spent on the page in seconds
    """
    session_id: str = Field(
        ...,
        description="The session ID from the start endpoint"
    )
    url: str = Field(
        ...,
        min_length=1,
        max_length=2048,
        description="The URL of the visited page"
    )
    title: str = Field(
        ...,
        min_length=0,
        max_length=500,
        description="The page title"
    )
    snippet: str = Field(
        ...,
        min_length=0,
        max_length=2000,
        description="Text snippet or preview of the page content"
    )
    duration_seconds: int = Field(
        ...,
        ge=0,
        description="Time spent on the page in seconds"
    )


class LogResponse(BaseModel):
    """
    Response model for tab visit logging endpoint.
    
    Attributes:
        success: Boolean indicating if the log was saved successfully
    """
    success: bool = Field(
        ...,
        description="Whether the log was saved successfully"
    )


class AnalyzeBatchRequest(BaseModel):
    """
    Request model for batch analysis of recent browsing activity.
    
    Attributes:
        session_id: The UUID of the active browsing session
    """
    session_id: str = Field(
        ...,
        description="The session ID from the start endpoint"
    )


class AnalyzeBatchResponse(BaseModel):
    """
    Response model for batch analysis endpoint.
    
    Attributes:
        focus_score: Focus score from 0-100 based on goal alignment
        is_on_track: Boolean indicating if user is staying focused
        coaching_nudge: Encouraging or corrective message (1 sentence)
        url_breakdown: List of URL analysis results with alignment and confidence
    """
    focus_score: int = Field(
        ...,
        ge=0,
        le=100,
        description="Focus score from 0-100 based on goal alignment"
    )
    is_on_track: bool = Field(
        ...,
        description="Whether the user is staying focused on their goal"
    )
    coaching_nudge: str = Field(
        ...,
        min_length=1,
        description="Encouraging or corrective message (1 sentence)"
    )
    url_breakdown: List[dict] = Field(
        ...,
        description="List of URL analysis results. Each dict contains 'url' (str), 'aligned' (bool), and 'confidence' (float)"
    )


class EndRequest(BaseModel):
    """
    Request model for ending a browsing session.
    
    Attributes:
        session_id: The UUID of the session to end
    """
    session_id: str = Field(
        ...,
        description="The session ID to end"
    )
