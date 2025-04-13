import path from 'node:path';
import chalk from 'chalk';
import { getMediaInfo, convertToWebm } from './ffmpegUtils.js';
import { determineCrf } from './crfUtils.js';

// Tracks progress and manages updates to the console
class ProgressManager {
    constructor(totalFiles, rootDir) {
        this.totalFiles = totalFiles;
        this.processedCount = 0;
        this.rootDirName = path.basename(rootDir);
        this.lastMessageLength = 0; // To clear previous line
    }

    // Updates the progress line - must be called sequentially (or with external locking)
    update(filePath, status) {
        this.processedCount++;
        const percentage = this.totalFiles > 0 ? Math.round((this.processedCount / this.totalFiles) * 100) : 0;
        const relativePath = path.relative(path.dirname(this.rootDirName), filePath); // Adjust relative path calculation if needed

        const statusIndicator = status === 'converted' ? chalk.green('✓') :
                                status === 'skipped_exists' ? chalk.blue('-') :
                                status === 'skipped_dry_run' ? chalk.gray('DRY') :
                                chalk.red('✗'); // Failed (error_*)

        const message = `${chalk.blue(this.rootDirName)}: [${chalk.cyan(this.processedCount)}/${chalk.cyan(this.totalFiles)}] ${chalk.yellow(percentage + '%')} ${statusIndicator} ${chalk.gray(relativePath)}`;

        // Clear previous line and write new one
        process.stdout.write(`\r${' '.repeat(this.lastMessageLength)}\r`);
        process.stdout.write(message);
        this.lastMessageLength = message.replace(/\x1B\[[0-9;]*m/g, '').length; // Store length without ANSI codes

        // If it was an error, print a newline *after* updating the progress bar
        // so the error message appears below but the progress bar remains correct.
        if (status.startsWith('error_')) {
           process.stdout.write('\n');
        }
    }
}


async function processFile(filePath, dryRun, rootDir, progressManager) {
    let status = 'error_unknown';
    try {
        const mediaInfo = await getMediaInfo(filePath); // Can return null
        const crf = determineCrf(mediaInfo); // Handles null mediaInfo
        status = convertToWebm(filePath, dryRun, crf, rootDir); // Returns status string
    } catch (error) {
        // Catch unexpected errors during the processFile flow itself
        process.stdout.write('\n');
        console.error(chalk.red(`Unexpected error processing file ${path.basename(filePath)}:`), error);
        status = 'error_unexpected';
        // Potentially move the file here too if it wasn't moved by convertToWebm
        // moveFailedFile(filePath, rootDir); // Consider adding this call here if needed
    } finally {
        // Ensure progress is updated even if unexpected errors occur
        progressManager.update(filePath, status);
    }
}

export async function runParallelProcessing(files, parallelCount, dryRun, rootDir) {
    const progressManager = new ProgressManager(files.length, rootDir);
    const queue = [...files]; // Copy the array to treat as a queue
    const activeTasks = [];

    const runNext = async () => {
        while (activeTasks.length < parallelCount && queue.length > 0) {
            const filePath = queue.shift(); // Get the next file
            if (filePath) {
                // Create the promise, push it to activeTasks, and add error handling
                 const taskPromise = processFile(filePath, dryRun, rootDir, progressManager)
                     .catch(err => {
                         // This catch is mainly for programmer errors in processFile,
                         // as operational errors should be handled inside processFile.
                         process.stdout.write('\n');
                         console.error(chalk.magenta(`Internal error during task for ${path.basename(filePath)}:`), err);
                         // Update progress even for these errors if not already done
                         if (!progressManager.processedCount < progressManager.totalFiles) { // Avoid double count if finally block ran
                             progressManager.update(filePath, 'error_internal');
                         }
                     })
                     .finally(() => {
                         // Remove the completed task from the active list
                         const index = activeTasks.indexOf(taskPromise);
                         if (index > -1) {
                             activeTasks.splice(index, 1);
                         }
                         // Immediately try to run the next task if slots are available
                         runNext();
                     });
                 activeTasks.push(taskPromise);
            }
        }

        // If the queue is empty and all active tasks are finished, we are done.
        if (queue.length === 0 && activeTasks.length === 0) {
             // All tasks initiated and completed
             return Promise.resolve(); // Signal completion
        }
    };

    // Start the initial batch of tasks
    runNext();

    // Need a way to wait until everything is truly finished.
    // We can poll or use a master promise. Let's use polling for simplicity here.
    return new Promise(resolve => {
        const checkCompletion = setInterval(() => {
            if (queue.length === 0 && activeTasks.length === 0) {
                clearInterval(checkCompletion);
                resolve();
            }
        }, 100); // Check every 100ms
    });
} 