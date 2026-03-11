export interface SessionInfo {
  id: number;
  start_time: string;
  end_time?: string;
  duration_minutes?: number;
  location?: string;
  summary?: string;
  files_changed?: number;
  commits_made?: number;
}

export interface Task {
  id: number;
  description: string;
  status: string;
  priority: number;
  category?: string;
  created_at: string;
  completed_at?: string;
}

export interface Decision {
  id: number;
  date: string;
  description: string;
  reason?: string;
  related_files?: string;
  status?: string;
}

export interface ContextEntry {
  id: number;
  key: string;
  value: string;
  category: string;
  created_at: string;
  updated_at: string;
}

export interface ErrorEntry {
  id: number;
  session_id?: number;
  tool_name?: string;
  error_type?: string;
  file_path?: string;
  resolution?: string;
  timestamp: string;
}

export interface DBStats {
  sessions: number;
  tasks: number;
  decisions: number;
  errors: number;
  tool_usage: number;
  live_context: number;
}
