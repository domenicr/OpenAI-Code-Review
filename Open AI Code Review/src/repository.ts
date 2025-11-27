import * as tl from "azure-pipelines-task-lib/task";
import { SimpleGit, SimpleGitOptions, simpleGit } from "simple-git";
import binaryExtensions from "./binaryExtensions.json";

export class Repository {

    private gitOptions: Partial<SimpleGitOptions> = {
        baseDir: `${tl.getVariable('System.DefaultWorkingDirectory')}`,
        binary: 'git'
    };

    private readonly _repository: SimpleGit;

    constructor() {
        this._repository = simpleGit(this.gitOptions);
        this._repository.addConfig('core.pager', 'cat');
        this._repository.addConfig('core.quotepath', 'false');
    }

    public async GetChangedFiles(fileExtensions: string | undefined, filesToExclude: string | undefined): Promise<string[]> {
        await this._repository.fetch();

        let targetBranch = this.GetTargetBranch();
        let sourceBranch = this.GetSourceBranch();

        let diffs = await this._repository.diff([targetBranch + '...' + sourceBranch, '--name-only', '--diff-filter=AM']);
        let files = diffs.split('\n').filter(line => line.trim().length > 0);

        console.info(`Files in the diff: ${files}`);

        // Helper function to extract file extension
        const getFileExtension = (file: string): string => {
            const lastDotIndex = file.lastIndexOf(".");
            return lastDotIndex === -1 ? "" : file.slice(lastDotIndex + 1);
        };

        // Utility function for file pattern matching
        const matchesPattern = (file: string, patterns: string[]): boolean => {
            const fileName = file.split('/').pop()!;
            const fileExt = file.substring(file.lastIndexOf('.'));
            return patterns.some(pattern => {
                // Exact file name match
                if (pattern === fileName) return true;

                // Extension match (e.g., ".ts", ".js")
                if (pattern.startsWith('.') && pattern === fileExt) return true;

                // Wildcard patterns
                const regexPattern = pattern
                    .replace(/\./g, '\\.')
                    .replace(/\*/g, '.*')
                    .replace(/\?/g, '.');

                return new RegExp(`^${regexPattern}$`).test(fileName);
            });
        };

        // Start with non-binary files
        let filesToReviewNoBin = files.filter(file => !binaryExtensions.includes(getFileExtension(file)));
        // Log differences between all files and filtered files if any filtering occurred
        if (files.length !== filesToReviewNoBin.length) {
            const filteredOutFilesNoBin = files.filter(file => !filesToReviewNoBin.includes(file));
            console.info(`Binary files filtered out: ${filteredOutFilesNoBin}`);
        }

        let filesToReview = filesToReviewNoBin;
        // Exclude files matching filesToExclude pattern, except those in fileExtensions
        if (filesToExclude) {
            let excludePatterns = filesToExclude.trim().split(',').map(p => p.trim());
            let includePatterns = fileExtensions ? fileExtensions.trim().split(',').map(p => p.trim()) : [];
            
            filesToReview = filesToReviewNoBin.filter(file => {
                const matchesExclude = matchesPattern(file, excludePatterns);
                const matchesInclude = includePatterns.length > 0 && matchesPattern(file, includePatterns);
                
                // Exclude if matches exclude pattern, unless it also matches include pattern
                return !matchesExclude || matchesInclude;
            });

                // Log differences between all files and filtered files if any filtering occurred
            if (files.length !== filesToReview.length) {
                const filteredOutFiles = files.filter(file => !filesToReview.includes(file));
                console.info(`Excluded files filtered out: ${filteredOutFiles}`);
            }
        }

        return filesToReview;
    }

    public async GetDiff(fileName: string, diffScopeLines: number = 3): Promise<string> {
        let targetBranch = this.GetTargetBranch();
                
        let diff = await this._repository.diff([targetBranch, '--', fileName, `-U${diffScopeLines}`]);

        return diff;
    }

    private GetTargetBranch(): string {
        let targetBranchName = tl.getVariable('System.PullRequest.TargetBranchName');

        if (!targetBranchName) {
            targetBranchName = tl.getVariable('System.PullRequest.TargetBranch')?.replace('refs/heads/', '');
        }

        if (!targetBranchName) {
            throw new Error(`Could not find target branch`)
        }

        return `origin/${targetBranchName}`;
    }

    private GetSourceBranch(): string {
        let sourceBranchName = tl.getVariable('System.PullRequest.SourceBranchName');

        if (!sourceBranchName) {
            sourceBranchName = tl.getVariable('System.PullRequest.SourceBranch')?.replace('refs/heads/', '');
        }

        if (!sourceBranchName) {
            throw new Error(`Could not find source branch`)
        }

        return `origin/${sourceBranchName}`;
    }
}