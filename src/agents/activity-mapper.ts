import type { AgentActivity } from '../runtime/types.js';

export interface MappedActivity {
    type: string;
    message: string;
    agentId: string;
    jobId?: string;
    details?: string;
    file?: string;
}

export type ToolCategoryFn = (toolName: string) => string | null;

function defaultToolCategory(toolName: string): string | null {
    const lower = toolName.toLowerCase();
    if (lower.includes('askuserquestion')) return null;
    if (lower.includes('read') || lower.includes('glob') || lower.includes('grep')) return 'reading';
    if (lower.includes('write') || lower.includes('edit')) return 'writing';
    if (lower.includes('bash') || lower.includes('exec') || lower.includes('run')) return 'running';
    return 'tool_use';
}

export class ActivityMapper {
    private categorize: ToolCategoryFn;

    constructor(
        private agentId: string,
        private agentName?: string,
        toolCategory?: ToolCategoryFn,
    ) {
        this.categorize = toolCategory ?? defaultToolCategory;
    }

    map(activity: AgentActivity, jobId?: string): MappedActivity | null {
        switch (activity.type) {
            case 'tool_start': {
                const toolName = activity.toolName ?? '';
                const type = this.categorize(toolName);
                if (type === null) return null;
                if (!activity.displayInput) return null;

                const details = JSON.stringify({
                    toolName: activity.toolName,
                    displayInput: activity.displayInput,
                });

                return {
                    type,
                    message: `${activity.toolName} ${activity.displayInput}`,
                    agentId: this.agentId,
                    jobId,
                    details,
                    file: activity.toolName,
                };
            }

            case 'tool_progress': {
                const details = JSON.stringify({
                    toolName: activity.toolName,
                    elapsedSeconds: activity.elapsedSeconds,
                });
                return {
                    type: 'reading',
                    message: activity.content || `${activity.toolName} (${activity.elapsedSeconds}s)`,
                    agentId: this.agentId,
                    jobId,
                    details,
                };
            }

            case 'tool_summary': {
                const details = JSON.stringify({
                    toolName: activity.toolName,
                    stat: activity.stat,
                });
                return {
                    type: 'reading',
                    message: activity.stat || activity.content,
                    agentId: this.agentId,
                    jobId,
                    details,
                };
            }

            case 'text':
                if (activity.content.length > 10) {
                    return {
                        type: 'thinking',
                        message: activity.content,
                        agentId: this.agentId,
                        jobId,
                    };
                }
                return null;

            case 'thinking':
                return {
                    type: 'thinking',
                    message: activity.content,
                    agentId: this.agentId,
                    jobId,
                };

            case 'error':
                return {
                    type: 'error',
                    message: `Error: ${activity.content}`,
                    agentId: this.agentId,
                    jobId,
                };

            case 'result':
                return {
                    type: 'complete',
                    message: activity.content,
                    agentId: this.agentId,
                    jobId,
                };

            default:
                return null;
        }
    }
}
