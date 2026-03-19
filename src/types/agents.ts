
export interface RavenReviewOutput {

    done: boolean;

    assessment: string;

    improvements: string[];

    nextPrompt?: string;

    summary: string;
}
