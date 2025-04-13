#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { processDirectory } from './src/directoryProcessor.js'; // Import the processor

// --- Argument Parsing ---
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const targetDirArg = args.find(arg => !arg.startsWith('--'));
const targetDirectory = path.resolve(targetDirArg || '.');

// --- Initial Logging ---
console.log(`Starting WebM conversion in: ${targetDirectory}`);
if (dryRun) {
  console.log('--- DRY RUN MODE ---');
}

// --- Environment Validation ---
if (!fs.existsSync(targetDirectory)) {
  console.error(`Error: Directory not found - ${targetDirectory}`);
  process.exit(1);
}

if (!fs.statSync(targetDirectory).isDirectory()) {
    console.error(`Error: Provided path is not a directory - ${targetDirectory}`);
    process.exit(1);
}

// --- FFmpeg/FFprobe Check ---
function checkCommand(command) {
    console.log(`Checking for ${command}...`);
    try {
        const check = spawnSync(command, ['-version'], { stdio: 'ignore', shell: true }); // Added shell: true for Windows potentially
        if (check.error || check.status !== 0) {
            console.error(`ERROR: Could not execute ${command}. Please ensure it's installed and in your system's PATH.`);
            if (check.error) console.error(`${command} spawn error:`, check.error.message);
            return false;
        }
        console.log(`${command} found.`);
        return true;
    } catch (e) {
         console.error(`ERROR: Failed during ${command} check:`, e.message);
         return false;
    }
}

if (!checkCommand('ffmpeg') || !checkCommand('ffprobe')) {
    process.exit(1);
}


// --- Main Execution ---
(async () => {
  try {
    await processDirectory(targetDirectory, dryRun); // Call the main processing function
    console.log('Conversion process finished.');
  } catch (error) {
    console.error("An unexpected error occurred during processing:", error);
    process.exit(1);
  }
})(); // Immediately invoke the async function
