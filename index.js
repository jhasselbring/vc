#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import chalk from 'chalk';
import minimist from 'minimist';
import { findFilesToProcess } from './src/directoryProcessor.js';
import { runParallelProcessing } from './src/parallelProcessor.js';

// --- Argument Parsing ---
const argv = minimist(process.argv.slice(2), {
  alias: {
    p: 'parallel',
    t: 'target', // Alias -t to --target
    h: 'help',   // Add a help flag
  },
  default: {
    parallel: 1,
    // No default for target, let it default to '.' if not provided
  },
  boolean: ['help', 'dry-run'], // Specify boolean flags
});

// --- Help ---
if (argv.help) {
  console.log(`
Usage: ffmpeg-helper [options] [optional_target_directory]

Options:
  -t, --target <dir>    Directory to process (defaults to current directory if not specified)
  -p, --parallel <num>  Number of files to process in parallel (default: 1)
  --dry-run             List actions without converting or deleting files
  -h, --help            Show this help message
`);
  process.exit(0);
}


const dryRun = argv['dry-run'];
const parallelCount = parseInt(argv.parallel, 10);

// Determine target directory: Use --target first, then positional argument, then default to '.'
let targetDirInput = argv.target || argv._[0] || '.';
const targetDirectory = path.resolve(targetDirInput);


if (isNaN(parallelCount) || parallelCount < 1) {
    console.error(chalk.red('Error: --parallel (-p) value must be a positive integer.'));
    process.exit(1);
}

// --- Initial Logging ---
console.log(chalk.blue(`Target directory: ${targetDirectory}`));
console.log(chalk.blue(`Parallel processes: ${parallelCount}`));
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
    const filesToProcess = await findFilesToProcess(targetDirectory);
    const totalFiles = filesToProcess.length;
    console.log(chalk.blue(`Found ${totalFiles} file(s) potentially needing conversion.`));

    if (totalFiles === 0 && !dryRun) {
        console.log(chalk.green("No files need conversion."));
        process.exit(0);
    }

    console.clear();
    console.log(chalk.blue(`Starting conversion process for ${totalFiles} file(s)...`));

    await runParallelProcessing(filesToProcess, parallelCount, dryRun, targetDirectory);

    process.stdout.write('\n');
    console.log(chalk.green('Conversion process finished.'));

  } catch (error) {
    console.clear();
    console.error(chalk.red("An unexpected error occurred during processing:"), error);
    process.exit(1);
  }
})();
 