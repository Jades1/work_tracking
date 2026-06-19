-- Supabase setup for Time Tracker + Pomodoro
-- Run this in the Supabase SQL editor at https://supabase.com/dashboard/project/[project-id]/sql

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create tasks table (a "task" is a category in the UI)
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL DEFAULT auth.uid(),
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#2563eb',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    deleted BOOLEAN DEFAULT FALSE
);

-- Add color column for databases created before categories had colors (safe to re-run)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '#2563eb';

-- Create time_entries table
CREATE TABLE IF NOT EXISTS time_entries (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL DEFAULT auth.uid(),
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    "start" TIMESTAMP NOT NULL,
    "end" TIMESTAMP NOT NULL,
    duration_sec INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'tracked', -- 'tracked' or 'pomodoro-work'
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create settings table
CREATE TABLE IF NOT EXISTS settings (
    user_id UUID PRIMARY KEY DEFAULT auth.uid(),
    work_minutes INTEGER DEFAULT 30,
    break_minutes INTEGER DEFAULT 5,
    alarm_sound TEXT DEFAULT 'default',
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for faster queries (IF NOT EXISTS = safe to re-run)
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_user_id ON time_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_task_id ON time_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_start ON time_entries("start");

-- Row-Level Security (RLS) Policies

-- Enable RLS on all tables
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Tasks RLS: Users can only see their own tasks
DROP POLICY IF EXISTS "Users can view their own tasks" ON tasks;
CREATE POLICY "Users can view their own tasks"
    ON tasks FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own tasks" ON tasks;
CREATE POLICY "Users can insert their own tasks"
    ON tasks FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own tasks" ON tasks;
CREATE POLICY "Users can update their own tasks"
    ON tasks FOR UPDATE
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own tasks" ON tasks;
CREATE POLICY "Users can delete their own tasks"
    ON tasks FOR DELETE
    USING (auth.uid() = user_id);

-- Time entries RLS: Users can only see their own entries
DROP POLICY IF EXISTS "Users can view their own time entries" ON time_entries;
CREATE POLICY "Users can view their own time entries"
    ON time_entries FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own time entries" ON time_entries;
CREATE POLICY "Users can insert their own time entries"
    ON time_entries FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own time entries" ON time_entries;
CREATE POLICY "Users can update their own time entries"
    ON time_entries FOR UPDATE
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own time entries" ON time_entries;
CREATE POLICY "Users can delete their own time entries"
    ON time_entries FOR DELETE
    USING (auth.uid() = user_id);

-- Settings RLS: Users can only see their own settings
DROP POLICY IF EXISTS "Users can view their own settings" ON settings;
CREATE POLICY "Users can view their own settings"
    ON settings FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own settings" ON settings;
CREATE POLICY "Users can insert their own settings"
    ON settings FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own settings" ON settings;
CREATE POLICY "Users can update their own settings"
    ON settings FOR UPDATE
    USING (auth.uid() = user_id);

-- Grant necessary permissions to anon role (for auth.uid() to work)
GRANT USAGE ON SCHEMA public TO anon;
GRANT ALL ON tasks TO anon;
GRANT ALL ON time_entries TO anon;
GRANT ALL ON settings TO anon;
