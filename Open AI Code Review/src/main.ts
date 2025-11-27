import tl = require('azure-pipelines-task-lib/task');
import { OpenAI } from 'openai';
import { ChatGPT } from './chatgpt';
import { Repository } from './repository';
import { PullRequest } from './pullrequest';

export class Main {
    private static _chatGpt: ChatGPT;
    private static _repository: Repository;
    private static _pullRequest: PullRequest;

    public static async Main(): Promise<void> {
        tl.setProgress(1, 'Performing Code Review');
        
        if (tl.getVariable('Build.Reason') !== 'PullRequest') {
            tl.setResult(tl.TaskResult.Skipped, "This task must only be used when triggered by a Pull Request.");
            return;
        }

        if(!tl.getVariable('System.AccessToken')) {
            tl.setResult(tl.TaskResult.Failed, "'Allow Scripts to Access OAuth Token' must be enabled. See https://learn.microsoft.com/en-us/azure/devops/pipelines/build/options?view=azure-devops#allow-scripts-to-access-the-oauth-token for more information");
            return;
        }
        
        const apiKey = tl.getInput('api_key', true)!;
        const fileExtensions = tl.getInput('file_extensions', false);
        const filesToExclude = tl.getInput('file_excludes', false);
        const additionalPrompts = tl.getInput('additional_prompts', false)?.split(',')
        const baseUrl = tl.getInput('base_url', false) || "https://api.fuelix.ai/v1";
        const diffScopeLines = tl.getInput('diff_scope_lines',false) || "3";
        
        this._chatGpt = new ChatGPT(new OpenAI({ apiKey: apiKey, baseURL: baseUrl  }), tl.getBoolInput('bugs', true), tl.getBoolInput('performance', true), tl.getBoolInput('best_practices', true), additionalPrompts);
        this._repository = new Repository();
        this._pullRequest = new PullRequest();

        //await this._pullRequest.DeleteComments();

        tl.setProgress(5, 'Starting Code Review');
        let filesToReview = await this._repository.GetChangedFiles(fileExtensions, filesToExclude);
        
        tl.setProgress(10, 'Starting Code Review for each file');

        for (let index = 0; index < filesToReview.length; index++) {
            const fileToReview = filesToReview[index];
            const fileProgress = 10 + ((index / filesToReview.length) * 90);
            
            console.info(`Starting review for file ${fileToReview}`);

            tl.setProgress(Math.round(fileProgress), `Reviewing ${fileToReview} (${index + 1}/${filesToReview.length})`);
            
            let diff = await this._repository.GetDiff(fileToReview, parseInt(diffScopeLines));
            console.info(`Diff for file ${fileToReview}: ${diff}`);

            let review = await this._chatGpt.PerformCodeReview(diff, fileToReview);
            console.info(`Review for file ${fileToReview}: ${review}`);

            if (
                review.trim().length > 0 &&
                review.indexOf('NO_COMMENT') < 0
            ) {
                await this._pullRequest.AddComment(fileToReview, review);
            }

            console.info(`Completed review of file ${fileToReview}`)
        }

        tl.setResult(tl.TaskResult.Succeeded, "Pull Request reviewed.");
    }
}

Main.Main();