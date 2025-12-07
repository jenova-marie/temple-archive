-- RecoverySky Agent - PostgreSQL Schema Initialization
-- This script runs automatically when the postgres container starts

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Users table (identity)
CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    display_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Conversations table (relational core)
CREATE TABLE IF NOT EXISTS conversations (
    conversation_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT DEFAULT 'active',
    summary TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    CONSTRAINT conversations_user_id_fk FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_updated
    ON conversations(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_status
    ON conversations(status);

-- Messages table with embeddings
CREATE TABLE IF NOT EXISTS messages (
    message_id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    embedding vector(1536),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb,
    CONSTRAINT messages_conversation_id_fk FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE,
    CONSTRAINT messages_user_id_fk FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
    ON messages(conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_user
    ON messages(user_id, created_at DESC);

-- HNSW index for fast ANN search (vector similarity)
CREATE INDEX IF NOT EXISTS idx_messages_embedding
    ON messages USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Session summaries (compressed context)
CREATE TABLE IF NOT EXISTS session_summaries (
    summary_id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    time_window_start TIMESTAMPTZ NOT NULL,
    time_window_end TIMESTAMPTZ NOT NULL,
    summary_text TEXT NOT NULL,
    summary_embedding vector(1536),
    key_topics TEXT[] DEFAULT '{}',
    entities_mentioned JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT summaries_conversation_id_fk FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_summaries_conversation
    ON session_summaries(conversation_id, created_at DESC);

-- HNSW index for summary embeddings
CREATE INDEX IF NOT EXISTS idx_summaries_embedding
    ON session_summaries USING hnsw (summary_embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- User profiles (long-term profile)
CREATE TABLE IF NOT EXISTS user_profiles (
    user_id TEXT PRIMARY KEY,
    recovery_phase TEXT,
    sobriety_date DATE,
    triggers TEXT[] DEFAULT '{}',
    coping_strategies TEXT[] DEFAULT '{}',
    preferences JSONB DEFAULT '{}'::jsonb,
    milestones JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT user_profiles_user_id_fk FOREIGN KEY (user_id) REFERENCES users(user_id)
);

-- Crisis events log (for monitoring and review)
CREATE TABLE IF NOT EXISTS crisis_events (
    event_id TEXT PRIMARY KEY,
    conversation_id TEXT,
    user_id TEXT NOT NULL,
    crisis_level INTEGER NOT NULL CHECK (crisis_level BETWEEN 1 AND 10),
    patterns JSONB NOT NULL,
    action_taken TEXT NOT NULL,
    handled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes TEXT,
    CONSTRAINT crisis_conversation_id_fk FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE SET NULL,
    CONSTRAINT crisis_user_id_fk FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE INDEX IF NOT EXISTS idx_crisis_events_user
    ON crisis_events(user_id, handled_at DESC);

CREATE INDEX IF NOT EXISTS idx_crisis_events_level
    ON crisis_events(crisis_level);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for users table
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger for conversations table
DROP TRIGGER IF EXISTS update_conversations_updated_at ON conversations;
CREATE TRIGGER update_conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger for user_profiles table
DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER update_user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Verify setup
DO $$
BEGIN
    RAISE NOTICE 'RecoverySky database initialized successfully!';
    RAISE NOTICE 'Tables created: users, conversations, messages, session_summaries, user_profiles, crisis_events';
    RAISE NOTICE 'Extensions enabled: vector';
END $$;
