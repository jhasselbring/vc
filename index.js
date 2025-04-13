#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import chalk from 'chalk'; // Import chalk
import { processDirectory, countFiles } from './src/directoryProcessor.js'; // Import countFiles

// --- Argument Parsing ---
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const targetDirArg = args.find(arg => !arg.startsWith('--'));
const targetDirectory = path.resolve(targetDirArg || '.');

// --- Initial Logging ---
// console.log(`Starting WebM conversion in: ${targetDirectory}`); // Removed
if (dryRun) {
  console.log(chalk.yellow('--- DRY RUN MODE ---'));
}

// --- Environment Validation ---
if (!fs.existsSync(targetDirectory)) {
  console.error(chalk.red(`Error: Directory not found - ${targetDirectory}`));
  process.exit(1);
}

if (!fs.statSync(targetDirectory).isDirectory()) {
    console.error(chalk.red(`Error: Provided path is not a directory - ${targetDirectory}`));
    process.exit(1);
}

// --- FFmpeg/FFprobe Check ---
function checkCommand(command) {
    // Keep these logs as they are setup checks
    console.log(`Checking for ${command}...`);
    try {
        const check = spawnSync(command, ['-version'], { stdio: 'ignore', shell: true });
        if (check.error || check.status !== 0) {
            console.error(chalk.red(`ERROR: Could not execute ${command}. Please ensure it's installed and in your system's PATH.`));
            if (check.error) console.error(`${command} spawn error:`, check.error.message);
            return false;
        }
        console.log(chalk.green(`${command} found.`));
        return true;
    } catch (e) {
         console.error(chalk.red(`ERROR: Failed during ${command} check:`), e.message);
         return false;
    }
}

if (!checkCommand('ffmpeg') || !checkCommand('ffprobe')) {
    process.exit(1);
}

// --- Main Execution ---
(async () => {
  try {
    console.log(chalk.blue(`Scanning directory: ${targetDirectory}...`));
    const totalFiles = countFiles(targetDirectory); // Count files first
    console.log(chalk.blue(`Found ${totalFiles} file(s) to process.`));

    if (totalFiles === 0 && !dryRun) { // Added !dryRun check
        console.log(chalk.green("No files need conversion."));
        process.exit(0);
    }


    const progress = { count: 0 }; // Shared progress state object
    await processDirectory(targetDirectory, dryRun, progress, totalFiles, targetDirectory); // Pass state and total

    process.stdout.write('\n'); // Ensure the final message is on a new line

    console.log(chalk.green('Conversion process finished.'));
  } catch (error) {
    process.stdout.write('\n'); // Ensure errors start on a new line
    console.error(chalk.red("An unexpected error occurred during processing:"), error);
    process.exit(1);
  }
})();
