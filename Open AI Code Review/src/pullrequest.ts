import * as tl from "azure-pipelines-task-lib/task";
import { Agent } from "https";
import fetch from 'node-fetch';

export class PullRequest {
    private _httpsAgent: Agent;

    private _collectionUri: string = tl.getVariable('System.TeamFoundationCollectionUri')!;
    private _teamProjectId: string = tl.getVariable('System.TeamProjectId')!;
    private _repositoryName: string = tl.getVariable('Build.Repository.Name')!;
    private _pullRequestId: string = tl.getVariable('System.PullRequest.PullRequestId')!;

    constructor() {
        this._httpsAgent = new Agent({
            rejectUnauthorized: false
        });
    }

    public async AddComment(fileName: string, comment: string): Promise<boolean> {

        console.info(`Comment added to ${fileName}`);

        if (!fileName.startsWith('/')) {
            fileName = `/${fileName}`;
        }
        
        let body = {
            comments: [
                {
                    content: comment,
                    commentType: 2
                }
            ],
            status: 1,
            threadContext: {
                filePath: fileName,
            },
            pullRequestThreadContext: {
                changeTrackingId: 1,
                iterationContext: {
                    firstComparingIteration: 1,
                    secondComparingIteration: 2
                }
            }
        }

        let endpoint = `${this._collectionUri}${this._teamProjectId}/_apis/git/repositories/${this._repositoryName}/pullRequests/${this._pullRequestId}/threads?api-version=7.0`

        var response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${tl.getVariable('SYSTEM.ACCESSTOKEN')}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            agent: this._httpsAgent
        });

        if (response.ok == false) {
            if(response.status == 401) {
                tl.setResult(tl.TaskResult.Failed, "The Build Service must have 'Contribute to pull requests' access to the repository. See https://stackoverflow.com/a/57985733 for more information");
            }

            tl.warning(response.statusText)
        }

        return response.ok;
    }

    public async ApplyCodeReview(reviewJson: string, fileName: string): Promise<void> {
        try {
            const reviewData = JSON.parse(reviewJson);
            
            if (!reviewData.reviews || !Array.isArray(reviewData.reviews)) {
                tl.warning('Invalid review JSON format: missing or invalid reviews array');
                await this.AddComment(fileName, `**JSON Parsing Error**\n\nThe AI response was not in the expected format. Missing or invalid 'reviews' array.\n\n**Raw Response:**\n\`\`\`\n${reviewJson}\n\`\`\``);
                return;
            }

            // Get current iteration for all reviews
            const currentIteration = parseInt(tl.getVariable('System.PullRequest.PullRequestNumber') || '1');

            for (const review of reviewData.reviews) {
                const { filePath, lineStart, lineEnd, title, description, severity, suggestion, category, codeSuggestion } = review;
                
                // Build the comment content
                // Determine emoji based on severity
                let severityEmoji = '';
                switch (severity.toLowerCase()) {
                    case 'critical':
                        severityEmoji = '🚨';
                        break;
                    case 'warning':
                        severityEmoji = '⚠️';
                        break;
                    case 'info':
                        severityEmoji = 'ℹ️';
                        break;
                    case 'suggestion':
                        severityEmoji = '💡';
                        break;
                    default:
                        severityEmoji = '📝';
                }
                
                let commentContent = `${severityEmoji} **${severity.toUpperCase()}**: ${title}\n\n`;
                // Add category with appropriate emoji
                let categoryEmoji = '';
                switch (category?.toLowerCase()) {
                    case 'security':
                        categoryEmoji = '🔒';
                        break;
                    case 'performance':
                        categoryEmoji = '⏱️';
                        break;
                    case 'maintainability':
                        categoryEmoji = '🔧';
                        break;
                    case 'style':
                        categoryEmoji = '🎨';
                        break;
                    case 'bug':
                        categoryEmoji = '🐞';
                        break;
                    default:
                        categoryEmoji = '📋';
                }
                
                commentContent += `${categoryEmoji} **Category**: ${category}\n\n`;
                commentContent += `${description}\n\n`;
                if (suggestion) {
                    commentContent += `**Suggestion**: ${suggestion}\n\n`;
                }

                if (codeSuggestion && codeSuggestion.trim()) {
                    commentContent += `\`\`\`suggestion\n${codeSuggestion}\n\`\`\``;
                }
                // Ensure file path starts with /
                let normalizedFilePath = filePath.startsWith('/') ? filePath : `/${filePath}`;

                // Build the body with line location if present
                let body: any = {
                    comments: [
                        {
                            content: commentContent,
                            commentType: 2
                        }
                    ],
                    status: 1,
                    threadContext: {
                        filePath: normalizedFilePath,
                    },
                    pullRequestThreadContext: {
                        changeTrackingId: 1,
                        iterationContext: {
                            firstComparingIteration: 1,
                            secondComparingIteration: currentIteration
                        }
                    }
                };

                // Add line position if available
                if (lineStart !== undefined && lineStart !== null) {
                    body.threadContext.rightFileStart = {
                        line: lineStart,
                        offset: 1
                    };
                    
                    if (lineEnd !== undefined && lineEnd !== null && lineEnd >= lineStart) {
                        body.threadContext.rightFileEnd = {
                            line: lineEnd,
                            offset: 1
                        };
                    } else {
                        body.threadContext.rightFileEnd = {
                            line: lineStart,
                            offset: 1
                        };
                    }
                }

                let endpoint = `${this._collectionUri}${this._teamProjectId}/_apis/git/repositories/${this._repositoryName}/pullRequests/${this._pullRequestId}/threads?api-version=7.0`;

                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${tl.getVariable('SYSTEM.ACCESSTOKEN')}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    agent: this._httpsAgent
                });

                if (response.ok) {
                    console.info(`Review comment added to ${normalizedFilePath} (lines ${lineStart}-${lineEnd || lineStart})`);
                } else {
                    if (response.status == 401) {
                        tl.setResult(tl.TaskResult.Failed, "The Build Service must have 'Contribute to pull requests' access to the repository. See https://stackoverflow.com/a/57985733 for more information");
                    }
                    tl.warning(`Failed to add comment: ${response.statusText}`);
                }
            }
        } catch (error) {
            tl.warning(`Failed to apply code review: ${error}`);
            await this.AddComment(fileName, `**JSON Parsing Error**\n\nFailed to parse AI response as JSON.\n\n**Error:** ${error}\n\n**Raw Response:**\n\`\`\`\n${reviewJson}\n\`\`\``);
        }
    }

    public async DeleteComment(thread: any, comment: any): Promise<boolean> {
        let removeCommentUrl = `${this._collectionUri}${this._teamProjectId}/_apis/git/repositories/${this._repositoryName}/pullRequests/${this._pullRequestId}/threads/${thread.id}/comments/${comment.id}?api-version=5.1`;

        let response = await fetch(removeCommentUrl, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${tl.getVariable('System.AccessToken')}`, 'Content-Type': 'application/json' },
            agent: this._httpsAgent
        });

        if (response.ok == false) {
            tl.warning(`Failed to delete comment from url ${removeCommentUrl} the response was ${response.statusText}`);
        }

        return response.ok;
    }

    public async DeleteComments() {
        let collectionName = this._collectionUri.replace('https://', '').replace('http://', '').split('/')[1];
        let buildServiceName = `${tl.getVariable('SYSTEM.TEAMPROJECT')} Build Service (${collectionName})`;

        let threads = await this.GetThreads();

        for (let thread of threads as any[]) {
            let comments = await this.GetComments(thread);

            for (let comment of comments.value.filter((comment: any) => comment.author.displayName === buildServiceName) as any[]) {
                await this.DeleteComment(thread, comment);
            }
        }
    }

    public async GetThreads(): Promise<never[]> {
        let threadsEndpoint = `${this._collectionUri}${this._teamProjectId}/_apis/git/repositories/${this._repositoryName}/pullRequests/${this._pullRequestId}/threads?api-version=5.1`;
        let threadsResponse = await fetch(threadsEndpoint, {
            headers: { 'Authorization': `Bearer ${tl.getVariable('System.AccessToken')}`, 'Content-Type': 'application/json' },
            agent: this._httpsAgent
        });

        if (threadsResponse.ok == false) {
            tl.warning(`Failed to retrieve threads from url ${threadsEndpoint} the response was ${threadsResponse.statusText}`);
        }

        let threads = await threadsResponse.json();
        return threads.value.filter((thread: any) => thread.threadContext !== null);
    }

    public async GetComments(thread: any): Promise<any> {
        let commentsEndpoint = `${this._collectionUri}${this._teamProjectId}/_apis/git/repositories/${this._repositoryName}/pullRequests/${this._pullRequestId}/threads/${thread.id}/comments?api-version=5.1`;
        let commentsResponse = await fetch(commentsEndpoint, {
            headers: { 'Authorization': `Bearer ${tl.getVariable('System.AccessToken')}`, 'Content-Type': 'application/json' },
            agent: this._httpsAgent
        });

        if (commentsResponse.ok == false) {
            tl.warning(`Failed to retrieve comments from url ${commentsEndpoint} the response was ${commentsResponse.statusText}`);
        }

        return await commentsResponse.json();
    }
}