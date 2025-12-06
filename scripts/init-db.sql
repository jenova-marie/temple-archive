-- RecoverySky Agent - PostgreSQL Schema Initialization
-- This script runs automatically when the postgres container starts

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Conversations table (relational core)
CREATE TABLE IF NOT EXISTS conversations (
    conversation_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT DEFAULT 'active',
    summary TEXT,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_updated
    ON conversations(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_status
    ON conversations(status);

-- Messages table with embeddings
CREATE TABLE IF NOT EXISTS messages (
    message_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID REFERENCES conversations(conversation_id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    embedding vector(1536),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
    ON messages(conversation_id, created_at DESC);

-- HNSW index for fast ANN search (vector similarity)
CREATE INDEX IF NOT EXISTS idx_messages_embedding
    ON messages USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Session summaries (compressed context)
CREATE TABLE IF NOT EXISTS session_summaries (
    summary_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID REFERENCES conversations(conversation_id) ON DELETE CASCADE,
    time_window TSTZRANGE NOT NULL,
    summary_text TEXT NOT NULL,
    summary_embedding vector(1536),
    key_topics TEXT[] DEFAULT '{}',
    entities_mentioned JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_summaries_conversation
    ON session_summaries(conversation_id, created_at DESC);

-- User memory (long-term profile)
CREATE TABLE IF NOT EXISTS user_memory (
    user_id UUID PRIMARY KEY,
    recovery_phase TEXT,
    sobriety_date DATE,
    triggers TEXT[] DEFAULT '{}',
    coping_strategies TEXT[] DEFAULT '{}',
    preferences JSONB DEFAULT '{}'::jsonb,
    milestones JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Crisis events log (for monitoring and review)
CREATE TABLE IF NOT EXISTS crisis_events (
    event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID REFERENCES conversations(conversation_id) ON DELETE SET NULL,
    user_id UUID NOT NULL,
    crisis_level INTEGER NOT NULL CHECK (crisis_level BETWEEN 1 AND 10),
    patterns JSONB NOT NULL,
    action_taken TEXT NOT NULL,
    handled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes TEXT
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

-- Trigger for conversations table
DROP TRIGGER IF EXISTS update_conversations_updated_at ON conversations;
CREATE TRIGGER update_conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger for user_memory table
DROP TRIGGER IF EXISTS update_user_memory_updated_at ON user_memory;
CREATE TRIGGER update_user_memory_updated_at
    BEFORE UPDATE ON user_memory
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions (adjust as needed for your setup)
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres;

-- Verify setup
DO $$
BEGIN
    RAISE NOTICE 'RecoverySky database initialized successfully!';
    RAISE NOTICE 'Tables created: conversations, messages, session_summaries, user_memory, crisis_events';
    RAISE NOTICE 'Extensions enabled: vector, uuid-ossp';
END $$;
