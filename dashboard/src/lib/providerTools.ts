export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  provider: string;
}

export const PROVIDER_TOOLS: Record<string, ToolDefinition[]> = {
  'claude-code': [
    { id: 'bash', name: 'Bash', description: 'Execute shell commands', provider: 'Claude Code' },
    { id: 'file_read', name: 'File Read', description: 'Read files from the filesystem', provider: 'Claude Code' },
    { id: 'file_write', name: 'File Write', description: 'Create or overwrite files', provider: 'Claude Code' },
    { id: 'file_edit', name: 'File Edit', description: 'Make targeted edits to files', provider: 'Claude Code' },
    { id: 'web_search', name: 'Web Search', description: 'Search the web for information', provider: 'Claude Code' },
    { id: 'web_fetch', name: 'Web Fetch', description: 'Fetch content from URLs', provider: 'Claude Code' },
    { id: 'glob', name: 'Glob', description: 'Find files by pattern', provider: 'Claude Code' },
    { id: 'grep', name: 'Grep', description: 'Search file contents with regex', provider: 'Claude Code' },
    { id: 'notebook_edit', name: 'Notebook Edit', description: 'Edit Jupyter notebook cells', provider: 'Claude Code' },
    { id: 'mcp', name: 'MCP Tools', description: 'Access Model Context Protocol servers', provider: 'Claude Code' },
  ],
  anthropic: [
    { id: 'computer_use', name: 'Computer Use', description: 'Control mouse, keyboard, and screen', provider: 'Anthropic' },
    { id: 'text_editor', name: 'Text Editor', description: 'View and edit text files', provider: 'Anthropic' },
    { id: 'bash_tool', name: 'Bash', description: 'Execute shell commands', provider: 'Anthropic' },
    { id: 'web_search_anthropic', name: 'Web Search', description: 'Search the web', provider: 'Anthropic' },
  ],
  openai: [
    { id: 'code_interpreter', name: 'Code Interpreter', description: 'Execute Python in a sandbox', provider: 'OpenAI' },
    { id: 'file_search', name: 'File Search', description: 'Search across uploaded files', provider: 'OpenAI' },
    { id: 'function_calling', name: 'Function Calling', description: 'Call custom-defined functions', provider: 'OpenAI' },
    { id: 'web_search_openai', name: 'Web Search', description: 'Search the web for information', provider: 'OpenAI' },
  ],
  gemini: [
    { id: 'google_search', name: 'Google Search', description: 'Search Google for information', provider: 'Google Gemini' },
    { id: 'code_execution', name: 'Code Execution', description: 'Execute Python code', provider: 'Google Gemini' },
    { id: 'function_calling_gemini', name: 'Function Calling', description: 'Call custom-defined functions', provider: 'Google Gemini' },
  ],
  mistral: [
    { id: 'function_calling_mistral', name: 'Function Calling', description: 'Call custom-defined functions', provider: 'Mistral' },
    { id: 'web_search_mistral', name: 'Web Search', description: 'Search the web', provider: 'Mistral' },
  ],
  xai: [
    { id: 'function_calling_xai', name: 'Function Calling', description: 'Call custom-defined functions', provider: 'xAI' },
    { id: 'web_search_xai', name: 'Web Search', description: 'Search the web via Grok', provider: 'xAI' },
  ],
  groq: [
    { id: 'function_calling_groq', name: 'Function Calling', description: 'Call custom-defined functions', provider: 'Groq' },
  ],
  bedrock: [
    { id: 'function_calling_bedrock', name: 'Function Calling', description: 'Call custom-defined functions', provider: 'AWS Bedrock' },
  ],
};

