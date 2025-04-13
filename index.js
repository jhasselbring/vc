#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// ANSI Colors
const colors = {
    reset: "\x1b[0m",
    cyan: "\x1b[36m",
    yellow: "\x1b[33m",
    green: "\x1b[32m",
    red: "\x1b[31m"
};

const DEFAULT_CRF = 24; // Default CRF if media info cannot be obtained

async function getMediaInfo(filePath) {
  console.log(`\nProbing: ${filePath}`);
  const ffprobeArgs = [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    '-select_streams', 'v:0', // Select only the first video stream
    filePath,
  ];

  try {
    const result = spawnSync('ffprobe', ffprobeArgs, { encoding: 'utf8' });

    if (result.status !== 0 || result.error) {
      console.error(`\nffprobe failed for ${filePath}: Status ${result.status}`);
      if (result.stderr) console.error('ffprobe stderr:', result.stderr);
      if (result.error) console.error('ffprobe spawn error:', result.error);
      return null;
    }

    const output = JSON.parse(result.stdout);
    const stream = output.streams && output.streams[0];

    if (!stream) {
      console.warn(`\nNo video stream found in ${filePath}`);
      return null;
    }

    const width = parseInt(stream.width, 10);
    const height = parseInt(stream.height, 10);
    // bit_rate might be missing or invalid, handle gracefully
    const bitRate = stream.bit_rate ? parseInt(stream.bit_rate, 10) : NaN;

    if (isNaN(width) || isNaN(height)) {
       console.warn(`\nCould not parse width/height for ${filePath}`);
       return null; // Essential info missing
    }

    return { width, height, bitRate }; // bitRate might be NaN

  } catch (error) {
    console.error(`\nError running or parsing ffprobe for ${filePath}:`, error.message);
    if (error.stderr) {
        console.error('ffprobe stderr:', error.stderr.toString());
    }
    return null;
  }
}

function determineCrf(mediaInfo) {
    if (!mediaInfo) {
        console.warn(`\nUsing default CRF ${DEFAULT_CRF} due to missing media info.`);
        return DEFAULT_CRF;
    }

    const { width, height, bitRate } = mediaInfo;
    const bitRateMbps = !isNaN(bitRate) ? bitRate / 1_000_000 : 0;

    let crf;
    // Apply updated logic based on user request
    if (bitRateMbps > 20 || height >= 2160) {
        crf = 18; // Highest quality for 4K+ or >20Mbps
    } else if (bitRateMbps > 10 || height >= 1440) {
        crf = 20; // Higher quality for 1440p+ or >10Mbps
    } else if (bitRateMbps > 5 || height >= 1080) {
        crf = 22; // Good quality for 1080p+ or >5Mbps
    } else {
        crf = 24; // Default for lower resolutions/bitrates
    }
    console.log(`Determined CRF: ${crf} (Resolution: ${width}x${height}, Bitrate: ${bitRateMbps > 0 ? bitRateMbps.toFixed(2) + ' Mbps' : 'N/A'})`);
    return crf;
}

function convertToWebm(filePath, dryRun, crf, fileIndex, totalFiles, targetDirectory) {
  const parsedPath = path.parse(filePath);
  const outputFilePath = path.join(parsedPath.dir, `${parsedPath.name}.webm`);

  if (dryRun) {
    console.log(`\n[DRY RUN] Would convert: ${filePath} with CRF ${crf}`);
    console.log(`[DRY RUN] Would delete: ${filePath} on success`);
    return true;
  }

  const ffmpegArgs = [
    '-i', filePath,
    '-c:v', 'libvpx-vp9',
    '-crf', crf.toString(),
    '-b:v', '0',
    '-tile-columns', '4',
    '-frame-parallel', '1',
    '-row-mt', '1',
    '-c:a', 'libopus',
    '-cpu-used', '0',
    outputFilePath,
  ];

  try {
    if (fs.existsSync(outputFilePath)) {
        console.log(`\nSkipping: Output file already exists - ${outputFilePath}`);
        return true;
    }

    ffmpegArgs.splice(1, 0, '-loglevel', 'error');
    const result = spawnSync('ffmpeg', ffmpegArgs, { stdio: 'pipe' });

    if (result.status === 0) {
      console.log(`\n${colors.green}Successfully converted${colors.reset}: ${filePath} → ${outputFilePath}`);
      try {
        fs.unlinkSync(filePath);
        console.log(`Deleted original file: ${filePath}`);
      } catch (deleteError) {
        console.error(`\nError deleting original file ${filePath}:`, deleteError.message);
      }
      return true;
    } else {
      console.error(`\n${colors.red}FFmpeg conversion failed${colors.reset} for ${filePath} (maybe not a valid video file?):`);
      console.error(`Status: ${result.status}`);
      if (result.stderr && result.stderr.toString().trim()) {
        console.error('FFmpeg stderr:', result.stderr.toString());
      }
       if (result.error) {
           console.error('Spawn error:', result.error);
       }

      try {
        const parentDir = path.dirname(targetDirectory);
        const targetBaseName = path.basename(targetDirectory);
        const failureDirName = `@failed_conversion_${targetBaseName}`;
        const failureDirPath = path.join(parentDir, failureDirName);
        const destinationPath = path.join(failureDirPath, path.basename(filePath));

        console.log(`\nAttempting to move failed file to: ${destinationPath}`);

        try {
          fs.mkdirSync(failureDirPath, { recursive: true });
        } catch (mkdirError) {
          console.error(`\nError creating failure directory ${failureDirPath}:`, mkdirError.message);
        }

        try {
            if (fs.existsSync(filePath)) {
                fs.renameSync(filePath, destinationPath);
                console.log(`Successfully moved failed file to: ${destinationPath}`);
            } else {
                 console.warn(`\nSource file ${filePath} not found for moving.`);
            }
        } catch (moveError) {
             if (moveError.code === 'EEXIST') {
                 console.error(`\nError moving file: Destination ${destinationPath} already exists.`);
             } else {
                 console.error(`\nError moving failed file ${filePath} to ${destinationPath}:`, moveError.message);
             }
        }

      } catch (pathError) {
          console.error(`\nError determining path for moving failed file ${filePath}:`, pathError.message);
      }

      if (fs.existsSync(outputFilePath)) {
          try {
              fs.unlinkSync(outputFilePath);
              console.log(`\nDeleted incomplete output file: ${outputFilePath}`);
          } catch (cleanupError) {
              console.error(`\nError deleting incomplete output file ${outputFilePath}:`, cleanupError.message);
          }
      }
      return false;
    }
  } catch (spawnError) {
    console.error(`\nError spawning FFmpeg for ${filePath}:`, spawnError.message);
    return false;
  }
}

function findFilesToProcess(dirPath, fileList = [], rootDir = dirPath) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        findFilesToProcess(fullPath, fileList, rootDir);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext !== '.webm') {
          const relativeDir = path.relative(rootDir, dirPath) || '.';
          fileList.push({ path: fullPath, dir: relativeDir });
        }
      }
    }
  } catch (err) {
    console.error(`\nError reading directory ${dirPath} during scan:`, err.message);
  }
  return fileList;
}

// --- Main Execution ---
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const targetDirArg = args.find(arg => !arg.startsWith('--'));
const targetDirectory = path.resolve(targetDirArg || '.');

console.log(`Starting WebM conversion scan in: ${targetDirectory}`);
if (dryRun) {
  console.log('--- DRY RUN MODE ---');
}

if (!fs.existsSync(targetDirectory)) {
  console.error(`Error: Directory not found - ${targetDirectory}`);
  process.exit(1);
}
if (!fs.statSync(targetDirectory).isDirectory()) {
    console.error(`Error: Provided path is not a directory - ${targetDirectory}`);
    process.exit(1);
}

// Basic check for ffmpeg and ffprobe command existence
try {
    console.log('Checking for ffmpeg...');
    const ffmpegCheck = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    if (ffmpegCheck.error || ffmpegCheck.status !== 0) {
        console.error("ERROR: Could not execute ffmpeg. Please ensure ffmpeg is installed and in your system's PATH.");
        if (ffmpegCheck.error) console.error("ffmpeg spawn error:", ffmpegCheck.error.message);
        process.exit(1); // Exit if ffmpeg isn't found
    } else {
        console.log('ffmpeg found.')
    }

    console.log('Checking for ffprobe...');
    const ffprobeCheck = spawnSync('ffprobe', ['-version'], { stdio: 'ignore' });
    if (ffprobeCheck.error || ffprobeCheck.status !== 0) {
        console.error("ERROR: Could not execute ffprobe. Please ensure ffprobe is installed and in your system's PATH.");
         if (ffprobeCheck.error) console.error("ffprobe spawn error:", ffprobeCheck.error.message);
        process.exit(1); // Exit if ffprobe isn't found
    } else {
        console.log('ffprobe found.')
    }
} catch (e) {
     console.error("ERROR: Failed during ffmpeg/ffprobe check:", e.message);
     process.exit(1);
}

// Scan for files first
console.log('\nScanning for files to process...');
const filesToProcess = findFilesToProcess(targetDirectory);
const totalFiles = filesToProcess.length;
console.log(`Found ${totalFiles} file(s) to process.`);

if (totalFiles === 0) {
    console.log('No files found requiring conversion.');
    process.exit(0);
}

let filesProcessedCount = 0;
let successCount = 0;
let failureCount = 0;
let currentStatusLine = '';

console.log('Starting conversion process...');

for (const fileInfo of filesToProcess) {
    filesProcessedCount++;
    const overallPercent = totalFiles > 0 ? ((filesProcessedCount / totalFiles) * 100).toFixed(1) : '0.0';
    const filePath = fileInfo.path;
    const fileDir = fileInfo.dir;

    const status = `Dir: ${colors.cyan}${fileDir}${colors.reset} | Overall: ${colors.yellow}[${filesProcessedCount}/${totalFiles}] (${overallPercent}%)${colors.reset} | File: ${colors.cyan}${path.basename(filePath)}${colors.reset} | ${colors.green}Processing...${colors.reset}`;
    const clearLength = Math.max(0, currentStatusLine.length - status.length);
    process.stdout.write('\r' + status + ' '.repeat(clearLength));
    currentStatusLine = status;

    const mediaInfo = getMediaInfo(filePath);
    const crf = determineCrf(mediaInfo);
    const success = convertToWebm(filePath, dryRun, crf, filesProcessedCount, totalFiles, targetDirectory);
    if (success) {
        successCount++;
    } else {
        failureCount++;
    }
}

process.stdout.write('\r' + ' '.repeat(currentStatusLine.length) + '\r');
console.log('\n--- Conversion process finished ---');
console.log(`Total files scanned: ${totalFiles}`);
console.log(`Successfully processed/skipped: ${successCount}`);
console.log(`Failed conversions (attempted move): ${failureCount}`);
