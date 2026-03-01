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


class AnalyzeRequest(BaseModel):
    """
    Request model for analyzing a URL's alignment with the session goal.
    
    Attributes:
        session_id: The UUID of the active browsing session
        url: The URL of the page to analyze
        title: The page title (for context)
        snippet: A text snippet or preview of the page content
    """
    session_id: str = Field(
        ...,
        description="The session ID from the start endpoint"
    )
    url: str = Field(
        ...,
        min_length=1,
        max_length=2048,
        description="The URL of the page to analyze"
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


class AnalyzeResponse(BaseModel):
    """
    Response model for URL analysis endpoint.
    
    Attributes:
        aligned: Boolean indicating if the page aligns with the user's goal
        confidence: Confidence score between 0.0 and 1.0
        reason: Human-readable explanation for the alignment decision
        cached: True if this result was served from cache, False if from LLM
    """
    aligned: bool = Field(
        ...,
        description="Whether the page aligns with the user's goal"
    )
    confidence: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Confidence score (0.0 to 1.0)"
    )
    reason: str = Field(
        ...,
        min_length=1,
        description="Explanation for the alignment decision"
    )
    cached: bool = Field(
        ...,
        description="True if result from cache, False if from LLM"
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
