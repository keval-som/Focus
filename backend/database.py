"""
SQLite Database Module for Focus-Aware Browsing Assistant

This module handles all database operations including:
- Database initialization and table creation
- Session management (create, end, retrieve)
- Log caching and persistence (analytics + cache layer)

The database serves dual purposes:
1. Analytics: Track all browsing sessions and alignment analyses
2. Cache: Store LLM responses to reduce API calls and improve response times
"""

import sqlite3
import uuid
from datetime import datetime
from typing import Optional, Dict, Any
import os

# Database file path - stored in the project root
DB_PATH = os.path.join(os.path.dirname(__file__), "focus.db")


def get_connection() -> sqlite3.Connection:
    """
    Creates and returns a new SQLite database connection.
    
    Returns:
        sqlite3.Connection: A connection to the focus.db database
    """
    conn = sqlite3.connect(DB_PATH)
    # Enable row factory to return dict-like rows
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """
    Initializes the SQLite database and creates required tables.
    
    This function should be called once at application startup.
    It creates two tables:
    - sessions: Stores user browsing sessions with goals
    - logs: Stores URL analysis results (both as cache and analytics)
    
    Note: This function is idempotent - safe to call multiple times.
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    # Create sessions table
    # Stores active and completed browsing sessions
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            goal TEXT NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT 1,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Create logs table
    # Stores URL analysis results - serves as both cache and analytics log
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            url TEXT NOT NULL,
            title TEXT,
            snippet TEXT,
            aligned BOOLEAN NOT NULL,
            confidence REAL NOT NULL,
            reason TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES sessions(session_id),
            -- Composite unique constraint: one analysis per URL per session
            UNIQUE(session_id, url)
        )
    """)
    
    # Create indexes for better query performance
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_sessions_active 
        ON sessions(session_id, is_active)
    """)
    
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_logs_session_url 
        ON logs(session_id, url)
    """)
    
    conn.commit()
    conn.close()
    print(f"Database initialized at: {DB_PATH}")


def create_session(goal: str) -> str:
    """
    Creates a new browsing session with a unique UUID.
    
    Args:
        goal: The user's focus goal for this browsing session (e.g., "Research Python async programming")
    
    Returns:
        str: The generated session_id (UUID string)
    
    Raises:
        sqlite3.Error: If database operation fails
    """
    session_id = str(uuid.uuid4())
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            INSERT INTO sessions (session_id, goal, is_active, created_at)
            VALUES (?, ?, ?, ?)
        """, (session_id, goal, True, datetime.now()))
        
        conn.commit()
        return session_id
    except sqlite3.Error as e:
        conn.rollback()
        raise e
    finally:
        conn.close()


def end_session(session_id: str) -> None:
    """
    Marks a session as inactive (ended).
    
    Args:
        session_id: The UUID of the session to end
    
    Raises:
        sqlite3.Error: If database operation fails
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            UPDATE sessions 
            SET is_active = 0 
            WHERE session_id = ?
        """, (session_id,))
        
        conn.commit()
    except sqlite3.Error as e:
        conn.rollback()
        raise e
    finally:
        conn.close()


def get_session_goal(session_id: str) -> Optional[str]:
    """
    Retrieves the goal for an active session.
    
    Args:
        session_id: The UUID of the session
    
    Returns:
        Optional[str]: The goal string if session exists and is active, None otherwise
    
    Raises:
        sqlite3.Error: If database operation fails
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            SELECT goal 
            FROM sessions 
            WHERE session_id = ? AND is_active = 1
        """, (session_id,))
        
        row = cursor.fetchone()
        return row["goal"] if row else None
    except sqlite3.Error as e:
        raise e
    finally:
        conn.close()


def get_cached_log(session_id: str, url: str) -> Optional[Dict[str, Any]]:
    """
    Checks the cache for an existing analysis of a URL within a session.
    
    This function implements the cache layer - if we've analyzed this exact URL
    for this session before, we can return the cached result instead of calling
    the LLM API again.
    
    Args:
        session_id: The UUID of the session
        url: The URL to check for cached analysis
    
    Returns:
        Optional[Dict[str, Any]]: Dictionary with keys 'aligned', 'confidence', 'reason'
                                 if cache hit, None if cache miss
    
    Raises:
        sqlite3.Error: If database operation fails
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            SELECT aligned, confidence, reason
            FROM logs
            WHERE session_id = ? AND url = ?
        """, (session_id, url))
        
        row = cursor.fetchone()
        if row:
            return {
                "aligned": bool(row["aligned"]),
                "confidence": float(row["confidence"]),
                "reason": str(row["reason"])
            }
        return None
    except sqlite3.Error as e:
        raise e
    finally:
        conn.close()


def save_log(
    session_id: str,
    url: str,
    title: str,
    snippet: str,
    aligned: bool,
    confidence: float,
    reason: str
) -> None:
    """
    Saves an analysis result to the logs table.
    
    This function serves dual purposes:
    1. Analytics: Log all analyses for future insights
    2. Cache: Store results for future cache hits
    
    Args:
        session_id: The UUID of the session
        url: The analyzed URL
        title: The page title
        snippet: The page snippet/content preview
        aligned: Whether the page aligns with the user's goal (boolean)
        confidence: Confidence score (0.0 to 1.0)
        reason: Explanation for the alignment decision
    
    Raises:
        sqlite3.Error: If database operation fails
        sqlite3.IntegrityError: If unique constraint violation (shouldn't happen with proper flow)
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        # Use INSERT OR REPLACE to handle potential duplicates gracefully
        cursor.execute("""
            INSERT OR REPLACE INTO logs 
            (session_id, url, title, snippet, aligned, confidence, reason, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (session_id, url, title, snippet, aligned, confidence, reason, datetime.now()))
        
        conn.commit()
    except sqlite3.Error as e:
        conn.rollback()
        raise e
    finally:
        conn.close()
