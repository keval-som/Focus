"""
SQLite Database Module for Focus-Aware Browsing Assistant

This module handles all database operations including:
- Database initialization and table creation
- Session management (create, end, retrieve)
- Tab visit logging for batch processing (raw telemetry)
- AI batch analysis storage (inference results)

The database uses a normalized design:
- logs: Raw telemetry data from frontend
- ai_batches: AI inference results from batch analysis
"""

import sqlite3
import uuid
import json
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
import os

from config import BATCH_ANALYSIS_MINUTES

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
    It creates three tables:
    - sessions: Stores user browsing sessions with goals
    - logs: Stores raw telemetry data (tab visits)
    - ai_batches: Stores AI inference results from batch analysis
    
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
    # Stores raw tab visit telemetry data (frontend logs)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            url TEXT NOT NULL,
            title TEXT,
            snippet TEXT,
            duration_seconds INTEGER NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES sessions(session_id)
        )
    """)
    
    # Create ai_batches table
    # Stores AI inference results from batch analysis
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS ai_batches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            focus_score INTEGER NOT NULL,
            is_on_track BOOLEAN NOT NULL,
            coaching_nudge TEXT NOT NULL,
            url_breakdown_json TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES sessions(session_id)
        )
    """)
    
    # Create indexes for better query performance
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_sessions_active 
        ON sessions(session_id, is_active)
    """)
    
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_logs_session_created 
        ON logs(session_id, created_at)
    """)
    
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_ai_batches_session_created 
        ON ai_batches(session_id, created_at)
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


def log_tab_visit(
    session_id: str,
    url: str,
    title: str,
    snippet: str,
    duration_seconds: int
) -> None:
    """
    Logs a tab visit to the database for batch processing.
    
    This function is designed to be extremely fast - it only writes raw data
    without any AI analysis. The analysis happens later in batch processing.
    
    Args:
        session_id: The UUID of the session
        url: The visited URL
        title: The page title
        snippet: The page snippet/content preview
        duration_seconds: Time spent on the page in seconds
    
    Raises:
        sqlite3.Error: If database operation fails
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            INSERT INTO logs 
            (session_id, url, title, snippet, duration_seconds, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (session_id, url, title, snippet, duration_seconds, datetime.now()))
        
        conn.commit()
    except sqlite3.Error as e:
        conn.rollback()
        raise e
    finally:
        conn.close()


def get_recent_logs(session_id: str, minutes: int = None) -> list:
    """
    Retrieves all logs for a session from the last N minutes.

    This function is used for batch processing to get recent browsing activity
    that needs to be analyzed together for better context.

    Args:
        session_id: The UUID of the session
        minutes: Number of minutes to look back (default from config)
    
    Returns:
        list: List of dictionaries, each containing log data with keys:
              'id', 'session_id', 'url', 'title', 'snippet', 'duration_seconds', 'created_at'
    
    Raises:
        sqlite3.Error: If database operation fails
    """
    if minutes is None:
        minutes = BATCH_ANALYSIS_MINUTES

    conn = get_connection()
    cursor = conn.cursor()

    try:
        # Calculate the timestamp for N minutes ago
        cutoff_time = datetime.now() - timedelta(minutes=minutes)
        
        cursor.execute("""
            SELECT id, session_id, url, title, snippet, duration_seconds, created_at
            FROM logs
            WHERE session_id = ? AND created_at >= ?
            ORDER BY created_at DESC
        """, (session_id, cutoff_time))
        
        rows = cursor.fetchall()
        return [dict(row) for row in rows]
    except sqlite3.Error as e:
        raise e
    finally:
        conn.close()


def save_batch_analysis(
    session_id: str,
    focus_score: int,
    is_on_track: bool,
    coaching_nudge: str,
    url_breakdown: List[Dict[str, Any]]
) -> None:
    """
    Saves a batch analysis result to the ai_batches table.
    
    This function stores AI inference results separately from raw telemetry data,
    following proper database normalization principles.
    
    Args:
        session_id: The UUID of the session
        focus_score: Focus score from 0-100
        is_on_track: Boolean indicating if user is staying focused
        coaching_nudge: Encouraging or corrective message
        url_breakdown: List of dictionaries, each containing 'url', 'aligned', 'confidence'
    
    Raises:
        sqlite3.Error: If database operation fails
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        # Convert url_breakdown list to JSON string
        url_breakdown_json = json.dumps(url_breakdown)
        
        cursor.execute("""
            INSERT INTO ai_batches 
            (session_id, focus_score, is_on_track, coaching_nudge, url_breakdown_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (session_id, focus_score, is_on_track, coaching_nudge, url_breakdown_json, datetime.now()))
        
        conn.commit()
    except sqlite3.Error as e:
        conn.rollback()
        raise e
    finally:
        conn.close()
