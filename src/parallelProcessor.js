import path from 'node:path';
import chalk from 'chalk';
import { getMediaInfo, convertToWebm } from './ffmpegUtils.js';
import { determineCrf } from './crfUtils.js';

// Tracks progress and manages updates to the console
class ProgressManager {
    constructor(totalFiles, rootDir) {
        this.totalFiles = totalFiles;
        this.processedCount = 0;
        this.rootDir = path.resolve(rootDir);
        this.rootDirName = path.basename(this.rootDir);
        this.lastMessageLength = 0; // To clear previous line
    }

    // Updates the progress line - must be called sequentially (or with external locking)
    update(filePath, status) {
        this.processedCount++;
        const percentage = this.totalFiles > 0 ? Math.round((this.processedCount / this.totalFiles) * 100) : 0;
        const relativePath = path.relative(this.rootDir, filePath);

        const statusIndicator = status === 'converted' ? chalk.green('✓') :
                                status === 'skipped_exists' ? chalk.blue('-') :
                                status === 'skipped_dry_run' ? chalk.gray('DRY') :
                                chalk.red('✗'); // Failed (error_*)

        const message = `${chalk.blue(this.rootDirName)}: [${chalk.cyan(this.processedCount)}/${chalk.cyan(this.totalFiles)}] ${chalk.yellow(percentage + '%')} ${statusIndicator} ${chalk.gray(relativePath)}`;

        // Clear previous line and write new one
        process.stdout.write(`\r${' '.repeat(this.lastMessageLength)}\r`);
        process.stdout.write(message);
        this.lastMessageLength = message.replace(/\x1B\[[0-9;]*m/g, '').length; // Store length without ANSI codes

        if (status.startsWith('error_') || status === 'error_deleting') {
           // Don't write newline here, let the error logging handle it if necessary
           // This prevents double newlines if error logs already added one.
        }
    }
}


async function processFile(filePath, dryRun, rootDir, progressManager) {
    let status = 'error_unknown';
    try {
        const mediaInfo = await getMediaInfo(filePath);
        const crf = determineCrf(mediaInfo);
        status = await convertToWebm(filePath, dryRun, crf, rootDir);
    } catch (error) {
        // This catch block handles unexpected errors *within* the processFile logic itself,
        // not errors from ffmpeg/ffprobe which are handled inside those utils now.
        process.stdout.write('\n'); // Ensure newline before this specific error
        console.error(chalk.red(`Unexpected error during file processing task for ${path.basename(filePath)}:`), error);
        status = 'error_task_internal'; // Assign a specific status
        // Consider moving the file even for these errors? Depends on the cause.
        // moveFailedFile(filePath, rootDir); // Maybe
    } finally {
        // Crucial: Update progress regardless of how the try block exited.
        progressManager.update(filePath, status);
    }
}

export async function runParallelProcessing(files, parallelCount, dryRun, rootDir) {
    const progressManager = new ProgressManager(files.length, rootDir);
    const queue = [...files];
    const activeTasks = [];
    let processingComplete = false; // Flag to signal completion

    const runNext = () => {
        // Check if processing is already marked as complete
        if (processingComplete) return;

        while (activeTasks.length < parallelCount && queue.length > 0) {
            const filePath = queue.shift();
            if (filePath) {
                const taskPromise = processFile(filePath, dryRun, rootDir, progressManager)
                    .catch(err => {
                         // Catch should ideally not happen if processFile handles its errors
                         process.stdout.write('\n');
                         console.error(chalk.magenta(`Internal error caught in task runner for ${path.basename(filePath)}:`), err);
                         // Ensure progress reflects an error state if it wasn't already updated
                         progressManager.update(filePath, 'error_runner_internal');
                    })
                    .finally(() => {
                         const index = activeTasks.indexOf(taskPromise);
                         if (index > -1) {
                             activeTasks.splice(index, 1);
                         }
                         // Check if we are done after this task finishes
                         if (queue.length === 0 && activeTasks.length === 0) {
                             processingComplete = true;
                         } else {
                            // Otherwise, try to run the next task immediately
                            runNext();
                         }
                    });
                activeTasks.push(taskPromise);
            }
        }
         // If the queue is empty and all active tasks are finished, signal completion
        if (queue.length === 0 && activeTasks.length === 0) {
            processingComplete = true;
        }
    };

    // Start initial tasks
    runNext();

    // Use a promise-based wait instead of polling
    return new Promise(resolve => {
        const checkCompletion = () => {
            if (processingComplete) {
                resolve();
            } else {
                setTimeout(checkCompletion, 100); // Check again shortly
            }
        };
        checkCompletion(); // Start the check loop
    });
} 