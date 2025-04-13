import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export async function getMediaInfo(filePath) {
  console.log(`Probing: ${filePath}`);
  const ffprobeArgs = [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    '-select_streams', 'v:0', // Select only the first video stream
    filePath,
  ];

  try {
    // Use async spawn when possible, but for simplicity keeping sync
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
    const bitRate = stream.bit_rate ? parseInt(stream.bit_rate, 10) : NaN;

    if (isNaN(width) || isNaN(height)) {
       console.warn(`Could not parse width/height for ${filePath}`);
       return null;
    }

    return { width, height, bitRate };

  } catch (error) {
    console.error(`Error running or parsing ffprobe for ${filePath}:`, error.message);
    if (error.stderr) {
        console.error('ffprobe stderr:', error.stderr.toString());
    }
    return null;
  }
}

export function convertToWebm(filePath, dryRun, crf) {
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
    '-crf', crf.toString(),
    '-b:v', '0',
    '-c:a', 'libopus',
    '-cpu-used', '0', // Consider making this configurable or adaptive
    outputFilePath,
  ];

  try {
    if (fs.existsSync(outputFilePath)) {
        console.log(`Skipping: Output file already exists - ${outputFilePath}`);
        return;
    }

    console.log(`Running: ffmpeg ${ffmpegArgs.join(' ')}`);
    const result = spawnSync('ffmpeg', ffmpegArgs, { stdio: 'pipe' });

    if (result.status === 0) {
      console.log(`Successfully converted: ${filePath} → ${outputFilePath}`);
      try {
        fs.unlinkSync(filePath);
        console.log(`Deleted original file: ${filePath}`);
      } catch (deleteError) {
        console.error(`Error deleting original file ${filePath}:`, deleteError.message);
      }
    } else {
      console.error(`FFmpeg conversion failed for ${filePath}:`);
      console.error(`Status: ${result.status}`);
      if (result.stderr) {
        console.error('FFmpeg stderr:', result.stderr.toString());
      }
       if (result.error) {
           console.error('Spawn error:', result.error);
       }
      // Clean up incomplete output file
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