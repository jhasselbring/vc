#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_CRF = 24; // Default CRF if media info cannot be obtained

async function getMediaInfo(filePath) {
  console.log(`Probing: ${filePath}`);
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
      console.error(`ffprobe failed for ${filePath}: Status ${result.status}`);
      if (result.stderr) console.error('ffprobe stderr:', result.stderr);
      if (result.error) console.error('ffprobe spawn error:', result.error);
      return null;
    }

    const output = JSON.parse(result.stdout);
    const stream = output.streams && output.streams[0];

    if (!stream) {
      console.warn(`No video stream found in ${filePath}`);
      return null;
    }

    const width = parseInt(stream.width, 10);
    const height = parseInt(stream.height, 10);
    // bit_rate might be missing or invalid, handle gracefully
    const bitRate = stream.bit_rate ? parseInt(stream.bit_rate, 10) : NaN;

    if (isNaN(width) || isNaN(height)) {
       console.warn(`Could not parse width/height for ${filePath}`);
       return null; // Essential info missing
    }

    return { width, height, bitRate }; // bitRate might be NaN

  } catch (error) {
    console.error(`Error running or parsing ffprobe for ${filePath}:`, error.message);
    if (error.stderr) {
        console.error('ffprobe stderr:', error.stderr.toString());
    }
    return null;
  }
}

function determineCrf(mediaInfo) {
    if (!mediaInfo) {
        console.warn(`Using default CRF ${DEFAULT_CRF} due to missing media info.`);
        return DEFAULT_CRF;
    }

    const { width, height, bitRate } = mediaInfo;
    const bitRateMbps = !isNaN(bitRate) ? bitRate / 1_000_000 : 0;

    let crf;
    // Apply logic based on user request
    if (bitRateMbps > 8 || height >= 1080) {
        crf = 24;
    } else if (height >= 720) {
        crf = 22;
    } else {
        crf = 20;
    }
    console.log(`Determined CRF: ${crf} (Resolution: ${width}x${height}, Bitrate: ${bitRateMbps > 0 ? bitRateMbps.toFixed(2) + ' Mbps' : 'N/A'})`);
    return crf;
}

function convertToWebm(filePath, dryRun, crf) {
  const parsedPath = path.parse(filePath);
  const outputFilePath = path.join(parsedPath.dir, `${parsedPath.name}.webm`);

  console.log(`Attempting conversion: ${filePath} -> ${outputFilePath} (CRF: ${crf})`);

  if (dryRun) {
    console.log(`[DRY RUN] Would convert: ${filePath} with CRF ${crf}`);
    console.log(`[DRY RUN] Would delete: ${filePath} on success`);
    return;
  }

  const ffmpegArgs = [
    '-i', filePath,
    '-c:v', 'libvpx-vp9',
    '-crf', crf.toString(), // Use the determined CRF
    '-b:v', '0',
    '-c:a', 'libopus',
    '-cpu-used', '0',
    outputFilePath,
  ];

  try {
    // Check if output already exists; skip if it does to avoid errors/re-conversion
    if (fs.existsSync(outputFilePath)) {
        console.log(`Skipping: Output file already exists - ${outputFilePath}`);
        return;
    }

    console.log(`Running: ffmpeg ${ffmpegArgs.join(' ')}`);
    const result = spawnSync('ffmpeg', ffmpegArgs, { stdio: 'pipe' }); // 'pipe' captures stdout/stderr

    if (result.status === 0) {
      console.log(`Successfully converted: ${filePath} → ${outputFilePath}`);
      try {
        fs.unlinkSync(filePath);
        console.log(`Deleted original file: ${filePath}`);
      } catch (deleteError) {
        console.error(`Error deleting original file ${filePath}:`, deleteError.message);
      }
    } else {
      console.error(`FFmpeg conversion failed for ${filePath} (maybe not a valid video file?):`);
      console.error(`Status: ${result.status}`);
      if (result.stderr) {
        console.error('FFmpeg stderr:', result.stderr.toString());
      }
       if (result.error) {
           console.error('Spawn error:', result.error);
       }
      // Optional: Delete potentially incomplete output file
      if (fs.existsSync(outputFilePath)) {
          try {
              fs.unlinkSync(outputFilePath);
              console.log(`Deleted incomplete output file: ${outputFilePath}`);
          } catch (cleanupError) {
              console.error(`Error deleting incomplete output file ${outputFilePath}:`, cleanupError.message);
          }
      }
    }
  } catch (spawnError) {
    console.error(`Error spawning FFmpeg for ${filePath}:`, spawnError.message);
  }
}

function processDirectory(dirPath, dryRun) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        processDirectory(fullPath, dryRun); // Recurse into subdirectories
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext !== '.webm') {
          // Get media info and determine CRF before converting
          const mediaInfo = getMediaInfo(fullPath);
          const crf = determineCrf(mediaInfo); // Determine CRF based on info or default
          convertToWebm(fullPath, dryRun, crf); // Pass CRF to converter
        }
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${dirPath}:`, err.message);
  }
}

// --- Main Execution ---
const args = process.argv.slice(2); // Skip 'node' and script path
const dryRun = args.includes('--dry-run');
const targetDirArg = args.find(arg => !arg.startsWith('--')); // Find first arg not starting with --

const targetDirectory = path.resolve(targetDirArg || '.'); // Default to '.'

console.log(`Starting WebM conversion in: ${targetDirectory}`);
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

processDirectory(targetDirectory, dryRun);

console.log('Conversion process finished.');
